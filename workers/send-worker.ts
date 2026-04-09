/**
 * IW-Gold Send Worker
 * Processes email jobs — rotates through Gmail SMTP pool
 * Run: npm run worker
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db/index.js";
import { campaigns, campaignRecipients, suppressionList, contacts } from "../lib/db/schema.js";
import { boss, QUEUES } from "../lib/queue/boss.js";
import { getAvailableAccount, sendViaAccount } from "../lib/email/smtp-pool.js";

async function start() {
  console.log("🚀 IW-Gold worker starting...");
  await boss.start();

  await boss.work(
    QUEUES.SEND_EMAIL,
    { teamSize: 3, teamConcurrency: 3 },
    async (job: any) => {
      const { campaignId, recipientId, userId, to, fromName, subject, htmlBody, textBody, trackingPixelUrl, unsubscribeUrl } = job.data;

      // Check suppression
      const suppressed = await db.query.suppressionList.findFirst({
        where: (s, { eq }) => eq(s.email, to),
      });
      if (suppressed) {
        await db.update(campaignRecipients)
          .set({ status: "skipped", error: "suppressed" })
          .where(eq(campaignRecipients.id, recipientId));
        return;
      }

      // Get next available SMTP account from pool
      const account = await getAvailableAccount(userId);
      if (!account) {
        // All accounts exhausted for today — requeue for tomorrow
        throw new Error("All SMTP accounts at daily limit");
      }

      // Send via that account
      const result = await sendViaAccount(account, {
        recipientId, campaignId, to, fromName, subject, htmlBody, textBody,
        trackingPixelUrl, unsubscribeUrl,
      });

      if (result.ok) {
        await db.update(campaignRecipients)
          .set({ status: "sent", messageId: result.messageId, sentAt: new Date(), smtpAccountId: result.accountId })
          .where(eq(campaignRecipients.id, recipientId));

        await db.update(campaigns)
          .set({ totalSent: sql`total_sent + 1`, updatedAt: new Date() })
          .where(eq(campaigns.id, campaignId));

        console.log(`✓ ${to} via ${account.username}`);
      } else {
        console.error(`✗ ${to}: ${result.error}`);
        throw new Error(result.error);
      }

      // Check campaign completion
      const pending = await db.query.campaignRecipients.findFirst({
        where: (r, { and, eq }) => and(eq(r.campaignId, campaignId), eq(r.status, "pending")),
      });
      if (!pending) {
        const camp = await db.query.campaigns.findFirst({ where: (c, { eq }) => eq(c.id, campaignId) });
        if (camp) {
          await db.update(campaigns).set({
            status: "completed",
            completedAt: new Date(),
            openRate: camp.totalSent > 0 ? camp.totalOpened / camp.totalSent : 0,
            clickRate: camp.totalSent > 0 ? camp.totalClicked / camp.totalSent : 0,
          }).where(eq(campaigns.id, campaignId));
          console.log(`✅ Campaign ${campaignId} completed`);
        }
      }
    }
  );

  // Process campaign — build recipient list and enqueue send jobs
  await boss.work(
    QUEUES.PROCESS_CAMPAIGN,
    { teamSize: 1 },
    async (job: any) => {
      const { campaignId, userId, emails } = job.data;
      const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

      const campaign = await db.query.campaigns.findFirst({ where: (c, { eq }) => eq(c.id, campaignId) });
      if (!campaign) return;

      // Insert recipients
      const BATCH = 500;
      let total = 0;
      for (let i = 0; i < emails.length; i += BATCH) {
        const batch = emails.slice(i, i + BATCH);
        const inserted = await db.insert(campaignRecipients)
          .values(batch.map((email: string) => ({ campaignId, email, status: "pending" })))
          .onConflictDoNothing()
          .returning({ id: campaignRecipients.id, email: campaignRecipients.email });

        // Enqueue individual send jobs with throttle delay
        for (let j = 0; j < inserted.length; j++) {
          const r = inserted[j];
          // Stagger sends — spread across the day based on daily capacity
          await boss.send(QUEUES.SEND_EMAIL, {
            campaignId, recipientId: r.id, userId, to: r.email,
            fromName: campaign.fromName, subject: campaign.subject,
            htmlBody: campaign.htmlBody, textBody: campaign.textBody,
            trackingPixelUrl: `${APP_URL}/api/track/open?r=${r.id}&c=${campaignId}`,
            unsubscribeUrl: `${APP_URL}/unsubscribe?r=${r.id}&c=${campaignId}`,
          }, {
            // Throttle: spread sends over time — 1 email every throttle_seconds per account
            startAfter: Math.floor((i + j) / 3), // rough spread
          });
        }
        total += inserted.length;
      }

      await db.update(campaigns)
        .set({ totalRecipients: total, startedAt: new Date() })
        .where(eq(campaigns.id, campaignId));

      console.log(`Campaign ${campaignId}: ${total} jobs queued`);
    }
  );

  console.log("✓ IW-Gold worker ready");
}

process.on("SIGTERM", async () => { await boss.stop(); process.exit(0); });
process.on("SIGINT", async () => { await boss.stop(); process.exit(0); });
start().catch(err => { console.error(err); process.exit(1); });
