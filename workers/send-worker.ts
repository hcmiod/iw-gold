/**
 * IW-Gold Send Worker
 * Run with: npm run worker
 * Processes campaign jobs and sends emails via Gmail SMTP pool
 */
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

  // Get boss instance and start it (connects to PostgreSQL queue)
  const boss = await getBoss();
  console.log("✓ Connected to PostgreSQL queue");

  // ── Process campaign jobs ────────────────────────────────────────────────
  // This builds the recipient list and enqueues individual send jobs
  await boss.work(
    QUEUES.PROCESS_CAMPAIGN,
    { teamSize: 1, teamConcurrency: 1 },
    async (job: any) => {
      const { campaignId, userId, emails } = job.data;
      console.log(`Processing campaign ${campaignId} — ${emails.length} emails`);

      const campaign = await db.query.iwgCampaigns.findFirst({
        where: (c, { eq }) => eq(c.id, campaignId),
      });

      if (!campaign) {
        console.log(`Campaign ${campaignId} not found — skipping`);
        return;
      }

      const BATCH = 100;
      let total = 0;

      for (let i = 0; i < emails.length; i += BATCH) {
        const batch = emails.slice(i, i + BATCH);

        // Insert recipient rows
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

        // Enqueue individual send jobs
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
        console.log(`  Queued ${total}/${emails.length} emails`);
      }

      // Update campaign with total recipients
      await db.update(iwgCampaigns)
        .set({ totalRecipients: total, startedAt: new Date() })
        .where(eq(iwgCampaigns.id, campaignId));

      console.log(`✓ Campaign ${campaignId}: ${total} send jobs queued`);
    }
  );

  // ── Process individual send jobs ─────────────────────────────────────────
  await boss.work(
    QUEUES.SEND_EMAIL,
    { teamSize: 5, teamConcurrency: 5 },
    async (job: any) => {
      const {
        campaignId, recipientId, userId, to,
        fromName, replyTo, subject, htmlBody, textBody,
        trackingPixelUrl, unsubscribeUrl,
      } = job.data;

      // 1. Check suppression list
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

      // 2. Get available SMTP account from pool
      const account = await getAvailableAccount(userId);
      if (!account) {
        console.log(`No SMTP accounts available for user ${userId}`);
        throw new Error("No active SMTP accounts available — add more Gmail accounts or wait for daily reset");
      }

      // 3. Send the email
      const result = await sendViaAccount(account, {
        recipientId, campaignId, to, fromName, replyTo, subject,
        htmlBody, textBody, trackingPixelUrl, unsubscribeUrl,
      });

      if (result.ok) {
        // Mark as sent
        await db.update(iwgCampaignRecipients)
          .set({
            status: "sent",
            messageId: result.messageId,
            sentAt: new Date(),
            smtpAccountId: result.accountId,
          })
          .where(eq(iwgCampaignRecipients.id, recipientId));

        // Increment campaign sent counter
        await db.update(iwgCampaigns)
          .set({ totalSent: sql`total_sent + 1`, updatedAt: new Date() })
          .where(eq(iwgCampaigns.id, campaignId));

        console.log(`✓ Sent to ${to} via ${account.username}`);
      } else {
        console.error(`✗ Failed to send to ${to}: ${result.error}`);
        // Mark as failed
        await db.update(iwgCampaignRecipients)
          .set({ status: "failed", error: result.error })
          .where(eq(iwgCampaignRecipients.id, recipientId));

        await db.update(iwgCampaigns)
          .set({ totalFailed: sql`total_failed + 1` })
          .where(eq(iwgCampaigns.id, campaignId));

        // Throw so pg-boss retries
        throw new Error(result.error);
      }

      // 4. Check if campaign is complete
      const pendingCount = await db.query.iwgCampaignRecipients.findFirst({
        where: (r, { and, eq }) =>
          and(
            eq(r.campaignId, campaignId),
            eq(r.status, "pending")
          ),
      });

      if (!pendingCount) {
        const camp = await db.query.iwgCampaigns.findFirst({
          where: (c, { eq }) => eq(c.id, campaignId),
        });
        if (camp && camp.status === "sending") {
          await db.update(iwgCampaigns)
            .set({
              status: "completed",
              completedAt: new Date(),
              openRate: camp.totalSent > 0 ? camp.totalOpened / camp.totalSent : 0,
              clickRate: camp.totalSent > 0 ? camp.totalClicked / camp.totalSent : 0,
            })
            .where(eq(iwgCampaigns.id, campaignId));
          console.log(`✅ Campaign ${campaignId} completed!`);
        }
      }
    }
  );

  console.log("✓ IW-Gold worker ready — listening for jobs...");
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Worker shutting down...");
  const boss = await getBoss();
  await boss.stop();
  process.exit(0);
});

process.on("SIGINT", async () => {
  const boss = await getBoss();
  await boss.stop();
  process.exit(0);
});

// Handle uncaught errors — log but don't crash
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception in worker:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection in worker:", reason);
});

start().catch(err => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
