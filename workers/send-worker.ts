import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local before anything else
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
  console.log("Env loaded. DATABASE_URL present:", !!process.env.DATABASE_URL);
} catch (err) {
  console.error("Could not load .env.local:", err);
}

import { eq, sql, and, inArray } from "drizzle-orm";
import { db } from "../lib/db/index.js";
import {
  iwgCampaigns,
  iwgCampaignRecipients,
  iwgSuppressionList,
} from "../lib/db/schema.js";
import { getBoss, QUEUES } from "../lib/queue/boss.js";
import { getAvailableAccount, sendViaAccount } from "../lib/email/smtp-pool.js";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

async function start() {
  console.log("IW-Gold worker starting...");
  const boss = await getBoss();
  console.log("Connected to queue");

  // Process campaign — insert recipients and queue send jobs
  await boss.work(
    QUEUES.PROCESS_CAMPAIGN,
    { teamSize: 1, teamConcurrency: 1 },
    async (job: any) => {
      const { campaignId, userId, emails } = job.data;
      console.log(`PROCESS_CAMPAIGN: ${campaignId} — ${emails.length} emails`);

      const campaign = await db.query.iwgCampaigns.findFirst({
        where: (c, { eq }) => eq(c.id, campaignId),
      });

      if (!campaign) {
        console.log(`Campaign ${campaignId} not found — skipping`);
        return;
      }

      // Check if recipients already exist for this campaign
      const existing = await db.query.iwgCampaignRecipients.findMany({
        where: (r, { eq }) => eq(r.campaignId, campaignId),
      });

      let recipients = existing;

      if (existing.length === 0) {
        // Insert recipients fresh
        console.log(`Inserting ${emails.length} recipients...`);
        const values = emails.map((email: string) => ({
          campaignId,
          email: email.toLowerCase().trim(),
          status: "pending" as const,
        }));

        // Insert in batches of 100
        const inserted: { id: string; email: string }[] = [];
        const BATCH = 100;
        for (let i = 0; i < values.length; i += BATCH) {
          const batch = values.slice(i, i + BATCH);
          const rows = await db
            .insert(iwgCampaignRecipients)
            .values(batch)
            .onConflictDoNothing()
            .returning({ id: iwgCampaignRecipients.id, email: iwgCampaignRecipients.email });
          inserted.push(...rows);
        }
        recipients = inserted as any;
        console.log(`Inserted ${inserted.length} recipients`);
      } else {
        console.log(`${existing.length} recipients already exist for campaign`);
      }

      // Queue send jobs for pending recipients only
      const pending = recipients.filter((r: any) => !r.status || r.status === "pending");
      console.log(`Queuing ${pending.length} send jobs...`);

      for (const r of pending) {
        await boss.send(QUEUES.SEND_EMAIL, {
          campaignId,
          recipientId: r.id,
          userId,
          to: r.email,
          fromName: campaign.fromName,
          replyTo: campaign.replyTo,
          subject: campaign.subject,
          htmlBody: campaign.htmlBody,
          textBody: campaign.textBody,
          trackingPixelUrl: `${APP_URL}/api/track/open?r=${r.id}&c=${campaignId}`,
          unsubscribeUrl: `${APP_URL}/unsubscribe?r=${r.id}&c=${campaignId}`,
        });
      }

      await db.update(iwgCampaigns)
        .set({ totalRecipients: recipients.length, startedAt: new Date() })
        .where(eq(iwgCampaigns.id, campaignId));

      console.log(`Campaign ${campaignId}: ${pending.length} send jobs queued`);
    }
  );

  // Send individual emails
  await boss.work(
    QUEUES.SEND_EMAIL,
    { teamSize: 3, teamConcurrency: 3 },
    async (job: any) => {
      const {
        campaignId, recipientId, userId, to,
        fromName, replyTo, subject, htmlBody, textBody,
        trackingPixelUrl, unsubscribeUrl,
      } = job.data;

      console.log(`SEND_EMAIL: sending to ${to}`);

      // Check suppression
      const suppressed = await db.query.iwgSuppressionList.findFirst({
        where: (s, { eq }) => eq(s.email, to),
      });

      if (suppressed) {
        console.log(`Skipping suppressed: ${to}`);
        await db.update(iwgCampaignRecipients)
          .set({ status: "skipped", error: "suppressed" })
          .where(eq(iwgCampaignRecipients.id, recipientId));
        return;
      }

      // Get SMTP account
      const account = await getAvailableAccount(userId);
      if (!account) {
        console.error("No SMTP accounts available for user:", userId);
        throw new Error("No active SMTP accounts available");
      }

      console.log(`Using account: ${account.username} port:${account.port} secure:${account.secure}`);

      // Send
      const result = await sendViaAccount(account, {
        recipientId, campaignId, to, fromName, replyTo,
        subject, htmlBody, textBody, trackingPixelUrl, unsubscribeUrl,
      });

      if (result.ok) {
        await db.update(iwgCampaignRecipients)
          .set({ status: "sent", messageId: result.messageId, sentAt: new Date(), smtpAccountId: result.accountId })
          .where(eq(iwgCampaignRecipients.id, recipientId));

        await db.update(iwgCampaigns)
          .set({ totalSent: sql`total_sent + 1`, updatedAt: new Date() })
          .where(eq(iwgCampaigns.id, campaignId));

        console.log(`SUCCESS: sent to ${to}`);
      } else {
        await db.update(iwgCampaignRecipients)
          .set({ status: "failed", error: result.error })
          .where(eq(iwgCampaignRecipients.id, recipientId));

        await db.update(iwgCampaigns)
          .set({ totalFailed: sql`total_failed + 1` })
          .where(eq(iwgCampaigns.id, campaignId));

        console.error(`FAILED: ${to} — ${result.error}`);
        throw new Error(result.error);
      }

      // Check completion
      const stillPending = await db.query.iwgCampaignRecipients.findFirst({
        where: (r, { and, eq }) => and(eq(r.campaignId, campaignId), eq(r.status, "pending")),
      });

      if (!stillPending) {
        await db.update(iwgCampaigns)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(iwgCampaigns.id, campaignId));
        console.log(`COMPLETED: campaign ${campaignId}`);
      }
    }
  );

  console.log("Worker ready — listening for jobs...");
}

process.on("SIGTERM", async () => { const b = await getBoss(); await b.stop(); process.exit(0); });
process.on("SIGINT", async () => { const b = await getBoss(); await b.stop(); process.exit(0); });
process.on("uncaughtException", (err) => { console.error("Uncaught:", err); });
process.on("unhandledRejection", (reason) => { console.error("Unhandled:", reason); });

start().catch(err => { console.error("Worker failed:", err); process.exit(1); });
