import nodemailer from "nodemailer";
import { db } from "../db";
import { iwgSmtpAccounts } from "../db/schema";
import { eq, sql } from "drizzle-orm";

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

export async function getAvailableAccount(userId: string) {
  const accounts = await db.query.iwgSmtpAccounts.findMany({
    where: (a, { and, eq }) => and(eq(a.userId, userId), eq(a.isActive, true)),
  });
  const now = new Date();
  for (const account of accounts) {
    const lastReset = account.lastResetAt ?? new Date(0);
    const isNewDay = now.toDateString() !== lastReset.toDateString();
    if (isNewDay) {
      await db.update(iwgSmtpAccounts).set({ sentToday: 0, lastResetAt: now }).where(eq(iwgSmtpAccounts.id, account.id));
      account.sentToday = 0;
    }
    if (account.sentToday < account.dailyLimit) return account;
  }
  return null;
}

export async function sendViaAccount(account: typeof iwgSmtpAccounts.$inferSelect, job: SendJobData): Promise<SendResult> {
  try {
    const transporter = nodemailer.createTransport({
      host: account.host, port: account.port, secure: account.secure,
      auth: { user: account.username, pass: account.password },
      connectionTimeout: 10000, greetingTimeout: 10000,
    });
    const html = job.htmlBody
      .replace(/\{\{unsubscribeUrl\}\}/g, job.unsubscribeUrl)
      .replace("</body>", `<img src="${job.trackingPixelUrl}" width="1" height="1" alt="" style="display:none"/></body>`);
    const info = await transporter.sendMail({
      from: `"${job.fromName}" <${account.username}>`,
      to: job.to, subject: job.subject, html,
      text: job.textBody ?? job.htmlBody.replace(/<[^>]+>/g, "").trim(),
      headers: { "List-Unsubscribe": `<${job.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    await db.update(iwgSmtpAccounts).set({ sentToday: sql`sent_today + 1` }).where(eq(iwgSmtpAccounts.id, account.id));
    return { ok: true, messageId: String(info.messageId).replace(/[<>]/g, ""), accountId: account.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.update(iwgSmtpAccounts).set({ lastError: error }).where(eq(iwgSmtpAccounts.id, account.id));
    return { ok: false, error };
  }
}

export async function testSmtpConnection(accountId: string, userId: string) {
  const account = await db.query.iwgSmtpAccounts.findFirst({
    where: (a, { and, eq }) => and(eq(a.id, accountId), eq(a.userId, userId)),
  });
  if (!account) return { ok: false, error: "Account not found" };
  try {
    const transporter = nodemailer.createTransport({
      host: account.host, port: account.port, secure: account.secure,
      auth: { user: account.username, pass: account.password },
      connectionTimeout: 10000,
    });
    await transporter.verify();
    await db.update(iwgSmtpAccounts).set({ lastTestedAt: new Date(), lastTestOk: true, lastError: null }).where(eq(iwgSmtpAccounts.id, account.id));
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.update(iwgSmtpAccounts).set({ lastTestedAt: new Date(), lastTestOk: false, lastError: error }).where(eq(iwgSmtpAccounts.id, account.id));
    return { ok: false, error };
  }
}
