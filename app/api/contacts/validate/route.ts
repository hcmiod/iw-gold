import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgContacts } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth";
import { sql } from "drizzle-orm";
import { promises as dns } from "dns";
import * as net from "net";

// Cache domain results to avoid repeated lookups
const mxCache = new Map<string, string[]>();
const smtpCache = new Map<string, "exists" | "notexist" | "unknown">();

// Providers that block SMTP verification — mark as unverifiable
const UNVERIFIABLE_PROVIDERS = [
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.fr", "ymail.com",
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me",
];

const DISPOSABLE = [
  "mailinator.com","guerrillamail.com","tempmail.com","throwaway.email",
  "yopmail.com","trashmail.com","10minutemail.com","sharklasers.com",
  "maildrop.cc","dispostable.com","fakeinbox.com","spam4.me",
];

async function getMxRecords(domain: string): Promise<string[]> {
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  try {
    const records = await dns.resolveMx(domain);
    const sorted = records
      .sort((a, b) => a.priority - b.priority)
      .map(r => r.exchange);
    mxCache.set(domain, sorted);
    return sorted;
  } catch {
    mxCache.set(domain, []);
    return [];
  }
}

/**
 * SMTP handshake verification
 * Connects to the mail server and checks if the mailbox exists
 * without actually sending an email
 */
async function verifySmtpMailbox(email: string, mxHost: string): Promise<"exists" | "notexist" | "unknown"> {
  const cacheKey = `${email}:${mxHost}`;
  if (smtpCache.has(cacheKey)) return smtpCache.get(cacheKey)!;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      smtpCache.set(cacheKey, "unknown");
      resolve("unknown");
    }, 8000); // 8 second timeout

    const socket = net.createConnection(25, mxHost);
    let step = 0;
    let result: "exists" | "notexist" | "unknown" = "unknown";
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.slice(0, 3));

        if (step === 0 && code === 220) {
          // Server ready — send EHLO
          socket.write("EHLO verify.check\r\n");
          step = 1;
        } else if (step === 1 && (code === 250 || code === 220)) {
          // EHLO accepted — send MAIL FROM
          socket.write("MAIL FROM:<verify@check.com>\r\n");
          step = 2;
        } else if (step === 2 && code === 250) {
          // MAIL FROM accepted — check RCPT TO
          socket.write(`RCPT TO:<${email}>\r\n`);
          step = 3;
        } else if (step === 3) {
          if (code === 250 || code === 251) {
            result = "exists";
          } else if (code === 550 || code === 551 || code === 553 || code === 450 || code === 503) {
            result = "notexist";
          } else {
            result = "unknown";
          }
          socket.write("QUIT\r\n");
          socket.destroy();
          clearTimeout(timeout);
          smtpCache.set(cacheKey, result);
          resolve(result);
        } else if (code >= 400) {
          socket.destroy();
          clearTimeout(timeout);
          smtpCache.set(cacheKey, "unknown");
          resolve("unknown");
        }
      }
    });

    socket.on("error", () => {
      clearTimeout(timeout);
      smtpCache.set(cacheKey, "unknown");
      resolve("unknown");
    });

    socket.on("close", () => {
      clearTimeout(timeout);
      if (result === "unknown") {
        smtpCache.set(cacheKey, "unknown");
        resolve("unknown");
      }
    });
  });
}

export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { rawEmails } = await req.json();
  if (!rawEmails) return NextResponse.json({ error: "No emails provided" }, { status: 400 });

  const lines = rawEmails
    .split(/[\n,;]+/)
    .map((e: string) => e.trim().toLowerCase())
    .filter((e: string) => e.length > 0);

  if (lines.length === 0) return NextResponse.json({ error: "No emails found" }, { status: 400 });
  if (lines.length > 10000) return NextResponse.json({ error: "Maximum 10,000 emails per batch" }, { status: 400 });

  const seen = new Set<string>();
  const results: {
    email: string;
    status: string;
    reason: string | null;
    verificationLevel: string;
  }[] = [];

  for (const email of lines) {
    // ── Step 1: Format check ───────────────────────────────────────
    const formatOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    if (!formatOk) {
      results.push({ email, status: "invalid", reason: "Invalid format", verificationLevel: "format" });
      continue;
    }

    // ── Step 2: Duplicate check ────────────────────────────────────
    if (seen.has(email)) {
      results.push({ email, status: "invalid", reason: "Duplicate", verificationLevel: "format" });
      continue;
    }

    const domain = email.split("@")[1];

    // ── Step 3: Disposable domain check ───────────────────────────
    if (DISPOSABLE.includes(domain)) {
      results.push({ email, status: "invalid", reason: "Disposable email domain", verificationLevel: "domain" });
      continue;
    }

    // ── Step 4: DNS MX check ───────────────────────────────────────
    const mxRecords = await getMxRecords(domain);
    if (mxRecords.length === 0) {
      results.push({ email, status: "invalid", reason: "Domain has no mail server", verificationLevel: "dns" });
      continue;
    }

    seen.add(email);

    // ── Step 5: SMTP handshake (business emails only) ──────────────
    if (UNVERIFIABLE_PROVIDERS.includes(domain)) {
      // Gmail/Yahoo/Outlook block verification — mark as unverifiable but valid format
      results.push({
        email,
        status: "valid",
        reason: null,
        verificationLevel: "dns",
        // @ts-ignore
        note: "Unverifiable — provider blocks mailbox checks",
      });
      continue;
    }

    // For business/custom domains — do full SMTP verification
    const mxHost = mxRecords[0];
    const smtpResult = await verifySmtpMailbox(email, mxHost);

    if (smtpResult === "notexist") {
      results.push({ email, status: "invalid", reason: "Mailbox does not exist", verificationLevel: "smtp" });
    } else if (smtpResult === "exists") {
      results.push({ email, status: "valid", reason: null, verificationLevel: "smtp" });
    } else {
      // Unknown — server didn't confirm either way, treat as valid
      results.push({ email, status: "valid", reason: null, verificationLevel: "dns" });
    }
  }

  // Save results to database
  const valid = results.filter(r => r.status === "valid");
  const invalid = results.filter(r => r.status !== "valid");

  if (valid.length > 0) {
    await db.insert(iwgContacts)
      .values(valid.map(r => ({ userId: auth.userId, email: r.email, status: "valid" })))
      .onConflictDoUpdate({
        target: [iwgContacts.userId, iwgContacts.email],
        set: { status: "valid", validationReason: null },
      });
  }

  if (invalid.length > 0) {
    await db.insert(iwgContacts)
      .values(invalid.map(r => ({
        userId: auth.userId,
        email: r.email,
        status: "invalid",
        validationReason: r.reason,
      })))
      .onConflictDoUpdate({
        target: [iwgContacts.userId, iwgContacts.email],
        set: { status: "invalid", validationReason: sql`excluded.validation_reason` },
      });
  }

  // Count by verification level
  const smtpVerified = results.filter(r => r.verificationLevel === "smtp" && r.status === "valid").length;
  const dnsVerified = results.filter(r => r.verificationLevel === "dns" && r.status === "valid").length;

  return NextResponse.json({
    results,
    total: results.length,
    valid: valid.length,
    invalid: invalid.length,
    breakdown: {
      smtpVerified,      // confirmed mailbox exists
      dnsVerified,       // domain exists but mailbox unverifiable (Gmail/Yahoo etc.)
      invalidFormat: results.filter(r => r.reason === "Invalid format").length,
      invalidDomain: results.filter(r => r.reason === "Domain has no mail server").length,
      mailboxNotFound: results.filter(r => r.reason === "Mailbox does not exist").length,
      duplicates: results.filter(r => r.reason === "Duplicate").length,
    },
  });
}
