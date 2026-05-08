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

// ─── Detect permanent bounce errors ──────────────────────────────────────────
function isPermanentBounce(error: string): boolean {
  const permanentErrors = [
    "user unknown",
    "does not exist",
    "mailbox unavailable",
    "mailbox not found",
    "invalid recipient",
    "address rejected",
    "no such user",
    "recipient rejected",
    "bad destination mailbox",
    "550 5.1.1",
    "550 5.1.2",
    "550 5.1.3",
    "550 5.4.1",
    "user not found",
    "unknown user",
    "invalid address",
    "account does not exist",
    "recipient address rejected",
  ];
  const lower = error.toLowerCase();
  return permanentErrors.some(e => lower.includes(e));
}

async function start() {
  console.log("Worker starting...");

  try {
    await db.query.iwgCampaigns.findMany({ limit: 1 });
    console.log("DB connection OK");
  } catch (err) {
    console.error("DB connection FAILED:", err);
    process.exit(1);
  }

  const boss = await getBoss();
  console.log("Queue connected");

  // ── PROCESS_CAMPAIGN ─────────────────────────────────────────────────────
  await boss.work(QUEUES.PROCESS_CAMPAIGN, { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
    const { campaignId, userId, emails } = job.data;
    console.log(`PROCESS: campaign=${campaignId} emails=${emails.length}`);

    try {
      const campaign = await db.query.iwgCampaigns.findFirst({
        where: (c, { eq }) => eq(c.id, campaignId),
      });

      if (!campaign) {
        console.error(`Campaign ${campaignId} not found`);
        return;
      }

      console.log(`Campaign found: "${campaign.subject}"`);

      let inserted = 0;
      let skippedSuppressed = 0;
      const recipientIds: { id: string; email: string }[] = [];

      for (const rawEmail of emails) {
        const email = rawEmail.toLowerCase().trim();

        // Check suppression list before inserting
        const suppressed = await db.query.iwgSuppressionList.findFirst({
          where: (s, { eq }) => eq(s.email, email),
        });

        if (suppressed) {
          skippedSuppressed++;
          console.log(`Skipped suppressed: ${email}`);
          continue;
        }

        try {
          const rows = await db.insert(iwgCampaignRecipients)
            .values({ campaignId, email, status: "pending" })
            .onConflictDoNothing()
            .returning({ id: iwgCampaignRecipients.id, email: iwgCampaignRecipients.email });

          if (rows.length > 0) {
            recipientIds.push(rows[0]);
            inserted++;
          } else {
            const existing = await db.query.iwgCampaignRecipients.findFirst({
              where: (r, { and, eq }) => and(eq(r.campaignId, campaignId), eq(r.email, email)),
            });
            if (existing && existing.status === "pending") {
              recipientIds.push({ id: existing.id, email: existing.email });
            }
          }
        } catch (err) {
          console.error(`Failed to insert recipient ${email}:`, err);
        }
      }

      console.log(`Total: ${recipientIds.length} queued, ${skippedSuppressed} suppressed`);

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
      console.error(`PROCESS_CAMPAIGN error:`, err);
      throw err;
    }
  });

  // ── SEND_EMAIL ────────────────────────────────────────────────────────────
  await boss.work(QUEUES.SEND_EMAIL, { teamSize: 3, teamConcurrency: 3 }, async (job: any) => {
    const { campaignId, recipientId, userId, to, fromName, replyTo, subject, htmlBody, textBody, trackingPixelUrl, unsubscribeUrl } = job.data;
    console.log(`SEND: to=${to} campaign=${campaignId}`);

    try {
      // Check suppression list
      const suppressed = await db.query.iwgSuppressionList.findFirst({
        where: (s, { eq }) => eq(s.email, to),
      });

      if (suppressed) {
        console.log(`Suppressed: ${to}`);
        await db.update(iwgCampaignRecipients)
          .set({ status: "skipped", error: "suppressed" })
          .where(eq(iwgCampaignRecipients.id, recipientId));
        return; // No retry
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
        const error = result.error ?? "Unknown error";
        console.error(`SEND FAILED: ${to} — ${error}`);

        if (isPermanentBounce(error)) {
          // Permanent bounce — suppress and never retry
          console.log(`PERMANENT BOUNCE — suppressing: ${to}`);
          try {
            await db.insert(iwgSuppressionList)
              .values({ email: to, reason: `bounce: ${error.slice(0, 200)}` })
              .onConflictDoNothing();
          } catch {}

          await db.update(iwgCampaignRecipients)
            .set({ status: "failed", error: `bounced: ${error.slice(0, 200)}` })
            .where(eq(iwgCampaignRecipients.id, recipientId));
          await db.update(iwgCampaigns)
            .set({
              totalFailed: sql`total_failed + 1`,
              totalBounced: sql`total_bounced + 1`,
              updatedAt: new Date()
            })
            .where(eq(iwgCampaigns.id, campaignId));
          // Do NOT throw — no retry for permanent bounces
        } else {
          // Temporary failure — mark failed but allow pg-boss retry
          await db.update(iwgCampaignRecipients)
            .set({ status: "failed", error: error.slice(0, 200) })
            .where(eq(iwgCampaignRecipients.id, recipientId));
          await db.update(iwgCampaigns)
            .set({ totalFailed: sql`total_failed + 1`, updatedAt: new Date() })
            .where(eq(iwgCampaigns.id, campaignId));
          throw new Error(error); // Retry for temporary errors
        }
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
    } catch (err: any) {
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
