import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db/index.js";
import { iwgCampaigns, iwgCampaignRecipients, iwgSuppressionList } from "../lib/db/schema.js";
import { boss, QUEUES } from "../lib/queue/boss.js";
import { getAvailableAccount, sendViaAccount } from "../lib/email/smtp-pool.js";

async function start() {
  console.log("IW-Gold worker starting...");
  await boss.start();

  await boss.work(QUEUES.SEND_EMAIL, { teamSize: 3, teamConcurrency: 3 }, async (job: any) => {
    const { campaignId, recipientId, userId, to, fromName, subject, htmlBody, textBody, trackingPixelUrl, unsubscribeUrl } = job.data;
    const suppressed = await db.query.iwgSuppressionList.findFirst({ where: (s, { eq }) => eq(s.email, to) });
    if (suppressed) {
      await db.update(iwgCampaignRecipients).set({ status: "skipped", error: "suppressed" }).where(eq(iwgCampaignRecipients.id, recipientId));
      return;
    }
    const account = await getAvailableAccount(userId);
    if (!account) throw new Error("All SMTP accounts at daily limit");
    const result = await sendViaAccount(account, { recipientId, campaignId, to, fromName, subject, htmlBody, textBody, trackingPixelUrl, unsubscribeUrl });
    if (result.ok) {
      await db.update(iwgCampaignRecipients).set({ status: "sent", messageId: result.messageId, sentAt: new Date(), smtpAccountId: result.accountId }).where(eq(iwgCampaignRecipients.id, recipientId));
      await db.update(iwgCampaigns).set({ totalSent: sql`total_sent + 1`, updatedAt: new Date() }).where(eq(iwgCampaigns.id, campaignId));
    } else {
      throw new Error(result.error);
    }
    const pending = await db.query.iwgCampaignRecipients.findFirst({ where: (r, { and, eq }) => and(eq(r.campaignId, campaignId), eq(r.status, "pending")) });
    if (!pending) {
      await db.update(iwgCampaigns).set({ status: "completed", completedAt: new Date() }).where(eq(iwgCampaigns.id, campaignId));
    }
  });

  await boss.work(QUEUES.PROCESS_CAMPAIGN, { teamSize: 1 }, async (job: any) => {
    const { campaignId, userId, emails } = job.data;
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const campaign = await db.query.iwgCampaigns.findFirst({ where: (c, { eq }) => eq(c.id, campaignId) });
    if (!campaign) return;
    const BATCH = 500;
    let total = 0;
    for (let i = 0; i < emails.length; i += BATCH) {
      const batch = emails.slice(i, i + BATCH);
      const inserted = await db.insert(iwgCampaignRecipients)
        .values(batch.map((email: string) => ({ campaignId, email, status: "pending" })))
        .onConflictDoNothing().returning({ id: iwgCampaignRecipients.id, email: iwgCampaignRecipients.email });
      for (const r of inserted) {
        await boss.send(QUEUES.SEND_EMAIL, {
          campaignId, recipientId: r.id, userId, to: r.email,
          fromName: campaign.fromName, subject: campaign.subject,
          htmlBody: campaign.htmlBody, textBody: campaign.textBody,
          trackingPixelUrl: `${APP_URL}/api/track/open?r=${r.id}&c=${campaignId}`,
          unsubscribeUrl: `${APP_URL}/unsubscribe?r=${r.id}&c=${campaignId}`,
        });
      }
      total += inserted.length;
    }
    await db.update(iwgCampaigns).set({ totalRecipients: total, startedAt: new Date() }).where(eq(iwgCampaigns.id, campaignId));
    console.log(`Campaign ${campaignId}: ${total} jobs queued`);
  });

  console.log("IW-Gold worker ready");
}

process.on("SIGTERM", async () => { await boss.stop(); process.exit(0); });
process.on("SIGINT", async () => { await boss.stop(); process.exit(0); });
start().catch(err => { console.error(err); process.exit(1); });
