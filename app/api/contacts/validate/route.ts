import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgContacts } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth";
import { sql } from "drizzle-orm";
import { promises as dns } from "dns";

// ─── Domain cache — avoid repeated DNS lookups ────────────────────────────────
const mxCache = new Map<string, boolean>();

async function domainHasMx(domain: string): Promise<boolean> {
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  try {
    const records = await dns.resolveMx(domain);
    const valid = records.length > 0;
    mxCache.set(domain, valid);
    return valid;
  } catch {
    mxCache.set(domain, false);
    return false;
  }
}

// ─── Disposable email domains ─────────────────────────────────────────────────
const DISPOSABLE = new Set([
  "mailinator.com","guerrillamail.com","guerrillamailblock.com","guerrillamail.info",
  "grr.la","sharklasers.com","spam4.me","tempmail.com","throwaway.email",
  "yopmail.com","trashmail.com","10minutemail.com","maildrop.cc",
  "dispostable.com","fakeinbox.com","spamgourmet.com","trashmail.at",
  "trashmail.io","trashmail.me","temp-mail.org","getairmail.com",
  "mailnull.com","spamex.com","mailexpire.com","discardmail.com",
  "spammotel.com","mailzilla.com","trashmail.net","wegwerfmail.de",
  "anonaddy.com","spamgourmet.net","spamgourmet.org","mytrashmail.com",
  "mt2015.com","mt2016.com","mt2017.com","spamfree24.org",
  "deadaddress.com","spamgob.com","emailsensei.com","spamthisplease.com",
]);

// ─── Common typos in popular domains ─────────────────────────────────────────
const COMMON_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gamail.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.ccom": "gmail.com",
  "gnail.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "hotmal.com": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotamil.com": "hotmail.com",
  "hotmaill.com": "hotmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yhaoo.com": "yahoo.com",
  "outlok.com": "outlook.com",
  "outloook.com": "outlook.com",
  "outllook.com": "outlook.com",
  "iclod.com": "icloud.com",
  "icoud.com": "icloud.com",
  "protonmai.com": "protonmail.com",
  "protonmal.com": "protonmail.com",
};

// ─── Role-based addresses (often not real people) ────────────────────────────
const ROLE_PREFIXES = new Set([
  "admin","administrator","webmaster","hostmaster","postmaster",
  "noreply","no-reply","donotreply","do-not-reply","mailer-daemon",
  "abuse","security","support","info","contact","sales","marketing",
  "newsletter","unsubscribe","help","root","mail","email","bounce",
]);

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
    originalEmail: string;
    status: string;
    reason: string | null;
    warning: string | null;
    verificationLevel: string;
  }[] = [];

  for (const email of lines) {

    // ── 1. Basic format check ────────────────────────────────────────────────
    const formatOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    if (!formatOk) {
      results.push({ email, originalEmail: email, status: "invalid", reason: "Invalid email format", warning: null, verificationLevel: "format" });
      continue;
    }

    const [localPart, domain] = email.split("@");

    // ── 2. Local part checks ─────────────────────────────────────────────────
    // Too short or too long
    if (localPart.length < 1 || localPart.length > 64) {
      results.push({ email, originalEmail: email, status: "invalid", reason: "Invalid email format", warning: null, verificationLevel: "format" });
      continue;
    }

    // Consecutive dots or starts/ends with dot
    if (localPart.includes("..") || localPart.startsWith(".") || localPart.endsWith(".")) {
      results.push({ email, originalEmail: email, status: "invalid", reason: "Invalid email format", warning: null, verificationLevel: "format" });
      continue;
    }

    // ── 3. Duplicate check ───────────────────────────────────────────────────
    if (seen.has(email)) {
      results.push({ email, originalEmail: email, status: "invalid", reason: "Duplicate — removed", warning: null, verificationLevel: "format" });
      continue;
    }

    // ── 4. Common domain typo correction ────────────────────────────────────
    let finalEmail = email;
    let typoWarning: string | null = null;
    if (COMMON_TYPOS[domain]) {
      const corrected = `${localPart}@${COMMON_TYPOS[domain]}`;
      typoWarning = `Possible typo — did you mean ${corrected}?`;
      // Mark as invalid — better to flag and let user fix than silently correct
      results.push({
        email,
        originalEmail: email,
        status: "invalid",
        reason: typoWarning,
        warning: null,
        verificationLevel: "format",
      });
      continue;
    }

    // ── 5. Disposable domain check ───────────────────────────────────────────
    if (DISPOSABLE.has(domain)) {
      results.push({ email, originalEmail: email, status: "invalid", reason: "Disposable email domain", warning: null, verificationLevel: "domain" });
      continue;
    }

    // ── 6. DNS MX check — does domain actually receive email? ────────────────
    const hasMx = await domainHasMx(domain);
    if (!hasMx) {
      results.push({ email, originalEmail: email, status: "invalid", reason: "Domain does not accept email (no MX record)", warning: null, verificationLevel: "dns" });
      continue;
    }

    // ── 7. Role-based address warning (valid but risky) ──────────────────────
    const isRole = ROLE_PREFIXES.has(localPart);
    const roleWarning = isRole ? "Role-based address — may not reach a real person" : null;

    // ── All checks passed ────────────────────────────────────────────────────
    seen.add(email);
    results.push({
      email: finalEmail,
      originalEmail: email,
      status: "valid",
      reason: null,
      warning: roleWarning,
      verificationLevel: "dns",
    });
  }

  // ── Save to database ─────────────────────────────────────────────────────
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

  const roleAddresses = valid.filter(r => r.warning).length;
  const typosCaught = results.filter(r => r.reason?.includes("typo") || r.reason?.includes("did you mean")).length;

  return NextResponse.json({
    results,
    total: results.length,
    valid: valid.length,
    invalid: invalid.length,
    breakdown: {
      dnsVerified: valid.length,
      invalidFormat: results.filter(r => r.verificationLevel === "format" && r.reason !== "Duplicate — removed").length,
      invalidDomain: results.filter(r => r.reason === "Domain does not accept email (no MX record)").length,
      disposable: results.filter(r => r.reason === "Disposable email domain").length,
      duplicates: results.filter(r => r.reason === "Duplicate — removed").length,
      typosCaught,
      roleAddresses,
    },
  });
}
