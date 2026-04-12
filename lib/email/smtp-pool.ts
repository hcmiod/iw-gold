import nodemailer from "nodemailer";
import { db } from "../db";
import { iwgSmtpAccounts } from "../db/schema";
import { eq, sql } from "drizzle-orm";

export type SendJobData = {
  recipientId: string;
  campaignId: string;
  to: string;
  fromName: string;
  replyTo?: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  trackingPixelUrl: string;
  unsubscribeUrl: string;
};

export type SendResult =
  | { ok: true; messageId: string; accountId: string }
  | { ok: false; error: string };

/**
 * Get a random available SMTP account from the pool.
 * Resets daily counter if it's a new day.
 * Returns null if ALL accounts are at their daily limit.
 */
export async function getAvailableAccount(userId: string) {
  const accounts = await db.query.iwgSmtpAccounts.findMany({
    where: (a, { and, eq }) => and(eq(a.userId, userId), eq(a.isActive, true)),
  });

  if (accounts.length === 0) return null;

  const now = new Date();

  // Reset counters for any account that needs a new day
  for (const account of accounts) {
    const lastReset = account.lastResetAt ?? new Date(0);
    const isNewDay = now.toDateString() !== lastReset.toDateString();
    if (isNewDay) {
      await db.update(iwgSmtpAccounts)
        .set({ sentToday: 0, lastResetAt: now })
        .where(eq(iwgSmtpAccounts.id, account.id));
      account.sentToday = 0;
    }
  }

  // Filter to only accounts that haven't hit their daily limit
  const available = accounts.filter(a => a.sentToday < a.dailyLimit);
  if (available.length === 0) return null;

  // ── RANDOMIZED ROTATION ──────────────────────────────────────────
  // Pick a random account from available ones
  // This spreads load evenly and looks natural to spam filters
  const randomIndex = Math.floor(Math.random() * available.length);
  return available[randomIndex];
}

/**
 * Send one email via a specific SMTP account.
 * The reply-to address also appears as the visible sender address.
 */
export async function sendViaAccount(
  account: typeof iwgSmtpAccounts.$inferSelect,
  job: SendJobData
): Promise<SendResult> {
  try {
    const transporter = nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: account.secure,
      auth: { user: account.username, pass: account.password },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
    });

    // Reply-To: campaign reply-to > account reply-to > gmail address
    const replyToAddress = job.replyTo || account.replyTo || account.username;

    // Make reply-to visible as the sender display address
    // Format: "Name <reply@domain.com>" <actual-gmail@gmail.com>
    // This shows the reply-to address visibly in email clients
    const fromField = replyToAddress !== account.username
      ? `"${job.fromName} <${replyToAddress}>" <${account.username}>`
      : `"${job.fromName}" <${account.username}>`;

    const html = job.htmlBody
      .replace(/\{\{unsubscribeUrl\}\}/g, job.unsubscribeUrl)
      .replace("</body>",
        `<img src="${job.trackingPixelUrl}" width="1" height="1" alt="" style="display:none"/></body>`
      );

    const info = await sendWithTimeout({
      from: fromField,
      replyTo: replyToAddress,
      to: job.to,
      subject: job.subject,
      html,
      text: job.textBody ?? job.htmlBody.replace(/<[^>]+>/g, "").trim(),
      headers: {
        "List-Unsubscribe": `<${job.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    await db.update(iwgSmtpAccounts)
      .set({ sentToday: sql`sent_today + 1`, lastError: null })
      .where(eq(iwgSmtpAccounts.id, account.id));

    return {
      ok: true,
      messageId: String(info.messageId).replace(/[<>]/g, ""),
      accountId: account.id,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.update(iwgSmtpAccounts)
      .set({ lastError: error })
      .where(eq(iwgSmtpAccounts.id, account.id));
    return { ok: false, error };
  }
}

/**
 * Test SMTP connection — used in SMTP Config page
 */
export async function testSmtpConnection(accountId: string, userId: string) {
  const account = await db.query.iwgSmtpAccounts.findFirst({
    where: (a, { and, eq }) => and(eq(a.id, accountId), eq(a.userId, userId)),
  });
  if (!account) return { ok: false, error: "Account not found" };
  try {
    const transporter = nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: account.secure,
      auth: { user: account.username, pass: account.password },
      connectionTimeout: 10000,
    });
    await transporter.verify();
    await db.update(iwgSmtpAccounts)
      .set({ lastTestedAt: new Date(), lastTestOk: true, lastError: null })
      .where(eq(iwgSmtpAccounts.id, account.id));
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.update(iwgSmtpAccounts)
      .set({ lastTestedAt: new Date(), lastTestOk: false, lastError: error })
      .where(eq(iwgSmtpAccounts.id, account.id));
    return { ok: false, error };
  }
}
