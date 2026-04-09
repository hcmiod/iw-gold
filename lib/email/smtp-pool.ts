import nodemailer from "nodemailer";
import { db } from "../db";
import { smtpAccounts } from "../db/schema";
import { eq, and, lt, sql } from "drizzle-orm";

export type SendJobData = {
  recipientId: string;
  campaignId: string;
  to: string;
  fromName: string;
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
 * Get next available SMTP account from pool.
 * Resets daily counter if it's a new day.
 * Returns null if all accounts are at daily limit.
 */
export async function getAvailableAccount(userId: string) {
  const accounts = await db.query.smtpAccounts.findMany({
    where: (a, { and, eq }) => and(eq(a.userId, userId), eq(a.isActive, true)),
  });

  const now = new Date();

  for (const account of accounts) {
    // Reset counter if last reset was a different day
    const lastReset = account.lastResetAt ?? new Date(0);
    const isNewDay = now.toDateString() !== lastReset.toDateString();

    if (isNewDay) {
      await db.update(smtpAccounts)
        .set({ sentToday: 0, lastResetAt: now })
        .where(eq(smtpAccounts.id, account.id));
      account.sentToday = 0;
    }

    if (account.sentToday < account.dailyLimit) {
      return account;
    }
  }

  return null; // All accounts exhausted for today
}

/**
 * Send one email using a specific SMTP account.
 */
export async function sendViaAccount(
  account: typeof smtpAccounts.$inferSelect,
  job: SendJobData
): Promise<SendResult> {
  try {
    const transporter = nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: account.secure,
      auth: { user: account.username, pass: account.password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });

    // Inject tracking pixel + unsubscribe link
    const html = job.htmlBody
      .replace(/\{\{unsubscribeUrl\}\}/g, job.unsubscribeUrl)
      .replace("</body>", `<img src="${job.trackingPixelUrl}" width="1" height="1" alt="" style="display:none"/></body>`);

    const info = await transporter.sendMail({
      from: `"${job.fromName}" <${account.username}>`,
      to: job.to,
      subject: job.subject,
      html,
      text: job.textBody ?? job.htmlBody.replace(/<[^>]+>/g, "").trim(),
      headers: {
        "List-Unsubscribe": `<${job.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    // Increment sent counter
    await db.update(smtpAccounts)
      .set({ sentToday: sql`sent_today + 1` })
      .where(eq(smtpAccounts.id, account.id));

    return {
      ok: true,
      messageId: String(info.messageId).replace(/[<>]/g, ""),
      accountId: account.id,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    // Record the error on the account
    await db.update(smtpAccounts)
      .set({ lastError: error })
      .where(eq(smtpAccounts.id, account.id));

    return { ok: false, error };
  }
}

/**
 * Test SMTP connection — used in the SMTP Config page
 */
export async function testSmtpConnection(accountId: string, userId: string) {
  const account = await db.query.smtpAccounts.findFirst({
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

    await db.update(smtpAccounts)
      .set({ lastTestedAt: new Date(), lastTestOk: true, lastError: null })
      .where(eq(smtpAccounts.id, account.id));

    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.update(smtpAccounts)
      .set({ lastTestedAt: new Date(), lastTestOk: false, lastError: error })
      .where(eq(smtpAccounts.id, account.id));
    return { ok: false, error };
  }
}

/**
 * Get pool summary for dashboard
 */
export async function getPoolStats(userId: string) {
  const accounts = await db.query.smtpAccounts.findMany({
    where: (a, { eq }) => eq(a.userId, userId),
  });

  const active = accounts.filter(a => a.isActive);
  const totalCapacity = active.reduce((s, a) => s + a.dailyLimit, 0);
  const totalSentToday = active.reduce((s, a) => s + a.sentToday, 0);
  const remaining = totalCapacity - totalSentToday;

  return { accounts, active: active.length, totalCapacity, totalSentToday, remaining };
}
