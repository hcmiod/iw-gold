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
  console.log("✓ Environment loaded from .env.local");
} catch (err) {
  console.error("Could not load .env.local:", err);
}

import { eq, sql } from "drizzle-orm";
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
  console.log("✓ Connected to PostgreSQL queue");

  // Process campaign — build recipient list and queue send jobs
  await boss.work(
    QUEUES.PROCESS_CAMPAIGN,
    { teamSize: 1, teamConcurrency: 1 },
    async (job: any) => {
      const { campaignId, userId, emails } = job.data;
      console.log(`Processing campaign ${campaignId} with ${emails.length} emails`);

      const campaign = await db.query.iwgCampaigns.findFirst({
        where: (c, { eq }) => eq(c.id, campaignId),
      });

      if (!campaign) {
        console.log(`Campaign ${campaignId} not found`);
        return;
      }

      const BATCH = 100;
      let total = 0;

      for (let i = 0; i < emails.length; i += BATCH) {
        const batch = emails.slice(i, i + BATCH);
        const inserted = await db
          .insert(iwgCampaignRecipients)
          .values(batch.map((email: string) => ({
            campaignId,
            email: email.toLowerCase().trim(),
            status: "pending" as const,
          })))
          .onConflictDoNothing()
          .returning({
            id: iwgCampaignRecipients.id,
            email: iwgCampaignRecipients.email,
          });

        for (const r of inserted) {
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
        total += inserted.length;
      }

      await db.update(iwgCampaigns)
        .set({ totalRecipients: total, startedAt: new Date() })
        .where(eq(iwgCampaigns.id, campaignId));

      console.log(`Campaign ${campaignId}: ${total} jobs queued`);
    }
  );

  // Send individual emails
  await boss.work(
    QUEUES.SEND_EMAIL,
    { teamSize: 5, teamConcurrency: 5 },
    async (job: any) => {
      const {
        campaignId, recipientId, userId, to,
        fromName, replyTo, subject, htmlBody, textBody,
        trackingPixelUrl, unsubscribeUrl,
      } = job.data;

      // Check suppression list
      const suppressed = await db.query.iwgSuppressionList.findFirst({
        where: (s, { eq }) => eq(s.email, to),
      });

      if (suppressed) {
        await db.update(iwgCampaignRecipients)
          .set({ status: "skipped", error: "suppressed" })
          .where(eq(iwgCampaignRecipients.id, recipientId));
        return;
      }

      // Get SMTP account
      const account = await getAvailableAccount(userId);
      if (!account) {
        console.error("No SMTP accounts available");
        throw new Error("No active SMTP accounts — add Gmail accounts or wait for daily reset");
      }

      // Send email
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

        console.log(`Sent to ${to} via ${account.username}`);
      } else {
        await db.update(iwgCampaignRecipients)
          .set({ status: "failed", error: result.error })
          .where(eq(iwgCampaignRecipients.id, recipientId));

        await db.update(iwgCampaigns)
          .set({ totalFailed: sql`total_failed + 1` })
          .where(eq(iwgCampaigns.id, campaignId));

        console.error(`Failed to send to ${to}: ${result.error}`);
        throw new Error(result.error);
      }

      // Check if campaign is complete
      const stillPending = await db.query.iwgCampaignRecipients.findFirst({
        where: (r, { and, eq }) => and(eq(r.campaignId, campaignId), eq(r.status, "pending")),
      });

      if (!stillPending) {
        await db.update(iwgCampaigns)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(iwgCampaigns.id, campaignId));
        console.log(`Campaign ${campaignId} completed`);
      }
    }
  );

  console.log("✓ IW-Gold worker ready — listening for jobs...");
}

process.on("SIGTERM", async () => {
  const boss = await getBoss();
  await boss.stop();
  process.exit(0);
});

process.on("SIGINT", async () => {
  const boss = await getBoss();
  await boss.stop();
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

start().catch(err => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
