// ─── Load environment FIRST before any other imports ─────────────────────────
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
try {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
  console.log("Env loaded — DATABASE_URL:", process.env.DATABASE_URL ? "SET" : "MISSING");
} catch (e) {
  console.error("Failed to load .env.local:", e);
  process.exit(1);
}

// ─── Now import db and other modules ─────────────────────────────────────────
import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db/index.js";
import { iwgCampaigns, iwgCampaignRecipients, iwgSuppressionList } from "../lib/db/schema.js";
import { getBoss, QUEUES } from "../lib/queue/boss.js";
import { getAvailableAccount, sendViaAccount } from "../lib/email/smtp-pool.js";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

async function start() {
  console.log("Worker starting...");

  // Test DB connection first
  try {
    const test = await db.query.iwgCampaigns.findMany({ limit: 1 });
    console.log("DB connection OK");
  } catch (err) {
    console.error("DB connection FAILED:", err);
    process.exit(1);
  }

  const boss = await getBoss();
  console.log("Queue connected");

  // ── PROCESS_CAMPAIGN: insert recipients and queue send jobs ───────────────
  await boss.work(QUEUES.PROCESS_CAMPAIGN, { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
    const { campaignId, userId, emails } = job.data;
    console.log(`PROCESS: campaign=${campaignId} emails=${emails.length}`);

    try {
      const campaign = await db.query.iwgCampaigns.findFirst({
        where: (c, { eq }) => eq(c.id, campaignId),
      });

      if (!campaign) {
        console.error(`Campaign ${campaignId} not found in DB`);
        return;
      }

      console.log(`Campaign found: "${campaign.subject}"`);

      // Insert recipients one by one to catch errors
      let inserted = 0;
      const recipientIds: { id: string; email: string }[] = [];

      for (const rawEmail of emails) {
        const email = rawEmail.toLowerCase().trim();
        try {
          const rows = await db.insert(iwgCampaignRecipients)
            .values({ campaignId, email, status: "pending" })
            .onConflictDoNothing()
            .returning({ id: iwgCampaignRecipients.id, email: iwgCampaignRecipients.email });

          if (rows.length > 0) {
            recipientIds.push(rows[0]);
            inserted++;
            console.log(`Inserted recipient: ${email}`);
          } else {
            // Already exists — get existing
            const existing = await db.query.iwgCampaignRecipients.findFirst({
              where: (r, { and, eq }) => and(eq(r.campaignId, campaignId), eq(r.email, email)),
            });
            if (existing) {
              recipientIds.push({ id: existing.id, email: existing.email });
              console.log(`Recipient already exists: ${email} status=${existing.status}`);
            }
          }
        } catch (err) {
          console.error(`Failed to insert recipient ${email}:`, err);
        }
      }

      console.log(`Total recipients: ${recipientIds.length} (${inserted} new)`);

      // Queue send jobs for pending recipients
      for (const r of recipientIds) {
        await boss.send(QUEUES.SEND_EMAIL, {
          campaignId, recipientId: r.id, userId, to: r.email,
          fromName: campaign.fromName, replyTo: campaign.replyTo,
          subject: campaign.subject, htmlBody: campaign.htmlBody, textBody: campaign.textBody,
          trackingPixelUrl: `${APP_URL}/api/track/open?r=${r.id}&c=${campaignId}`,
          unsubscribeUrl: `${APP_URL}/unsubscribe?r=${r.id}&c=${campaignId}`,
        });
        console.log(`Queued SEND_EMAIL for ${r.email}`);
      }

      await db.update(iwgCampaigns)
        .set({ totalRecipients: recipientIds.length, startedAt: new Date() })
        .where(eq(iwgCampaigns.id, campaignId));

      console.log(`PROCESS done: ${recipientIds.length} jobs queued`);
    } catch (err) {
      console.error(`PROCESS_CAMPAIGN error for ${campaignId}:`, err);
      throw err;
    }
  });

  // ── SEND_EMAIL: send one email ────────────────────────────────────────────
  await boss.work(QUEUES.SEND_EMAIL, { teamSize: 3, teamConcurrency: 3 }, async (job: any) => {
    const { campaignId, recipientId, userId, to, fromName, replyTo, subject, htmlBody, textBody, trackingPixelUrl, unsubscribeUrl } = job.data;
    console.log(`SEND: to=${to} campaign=${campaignId}`);

    try {
      const suppressed = await db.query.iwgSuppressionList.findFirst({
        where: (s, { eq }) => eq(s.email, to),
      });

      if (suppressed) {
        console.log(`Suppressed: ${to}`);
        await db.update(iwgCampaignRecipients).set({ status: "skipped", error: "suppressed" }).where(eq(iwgCampaignRecipients.id, recipientId));
        return;
      }

      const account = await getAvailableAccount(userId);
      if (!account) {
        console.error(`No SMTP accounts for user ${userId}`);
        throw new Error("No active SMTP accounts available");
      }

      console.log(`Using SMTP: ${account.username} port=${account.port} secure=${account.secure}`);

      const result = await sendViaAccount(account, {
        recipientId, campaignId, to, fromName, replyTo,
        subject, htmlBody, textBody, trackingPixelUrl, unsubscribeUrl,
      });

      if (result.ok) {
        console.log(`SENT: ${to}`);
        await db.update(iwgCampaignRecipients)
          .set({ status: "sent", messageId: result.messageId, sentAt: new Date(), smtpAccountId: result.accountId })
          .where(eq(iwgCampaignRecipients.id, recipientId));
        await db.update(iwgCampaigns)
          .set({ totalSent: sql`total_sent + 1`, updatedAt: new Date() })
          .where(eq(iwgCampaigns.id, campaignId));
      } else {
        console.error(`SEND FAILED: ${to} — ${result.error}`);
        await db.update(iwgCampaignRecipients)
          .set({ status: "failed", error: result.error })
          .where(eq(iwgCampaignRecipients.id, recipientId));
        await db.update(iwgCampaigns)
          .set({ totalFailed: sql`total_failed + 1` })
          .where(eq(iwgCampaigns.id, campaignId));
        throw new Error(result.error);
      }

      // Mark campaign complete if no pending left
      const stillPending = await db.query.iwgCampaignRecipients.findFirst({
        where: (r, { and, eq }) => and(eq(r.campaignId, campaignId), eq(r.status, "pending")),
      });
      if (!stillPending) {
        await db.update(iwgCampaigns)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(iwgCampaigns.id, campaignId));
        console.log(`CAMPAIGN COMPLETE: ${campaignId}`);
      }
    } catch (err) {
      console.error(`SEND_EMAIL error for ${to}:`, err);
      throw err;
    }
  });

  console.log("Worker ready — listening for jobs");
}

process.on("SIGTERM", async () => { try { const b = await getBoss(); await b.stop(); } catch {} process.exit(0); });
process.on("SIGINT", async () => { try { const b = await getBoss(); await b.stop(); } catch {} process.exit(0); });
process.on("uncaughtException", (err) => { console.error("Uncaught:", err); });
process.on("unhandledRejection", (reason) => { console.error("Unhandled:", reason); });

start().catch(err => { console.error("Worker start failed:", err); process.exit(1); });
