import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgContacts } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth";
import { sql } from "drizzle-orm";
import { promises as dns } from "dns";

const mxCache = new Map<string, boolean>();

async function domainHasMx(domain: string): Promise<boolean> {
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  const result = await Promise.race([
    dns.resolveMx(domain).then(r => r.length > 0).catch(() => false),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 3000)),
  ]);
  mxCache.set(domain, result);
  return result;
}

const DISPOSABLE = new Set([
  "mailinator.com","guerrillamail.com","guerrillamailblock.com","guerrillamail.info",
  "grr.la","sharklasers.com","spam4.me","tempmail.com","throwaway.email",
  "yopmail.com","trashmail.com","10minutemail.com","maildrop.cc",
  "dispostable.com","fakeinbox.com","spamgourmet.com","trashmail.at",
  "trashmail.io","trashmail.me","temp-mail.org","getairmail.com",
  "mailnull.com","spamex.com","mailexpire.com","discardmail.com",
  "spammotel.com","mailzilla.com","trashmail.net","wegwerfmail.de",
  "spamgourmet.net","spamgourmet.org","mytrashmail.com","spamfree24.org",
  "deadaddress.com","tempinbox.com","mailtemp.info","discard.email",
]);

const TYPOS: Record<string, string> = {
  "gmial.com":"gmail.com","gmai.com":"gmail.com","gamil.com":"gmail.com",
  "gamail.com":"gmail.com","gmail.co":"gmail.com","gmail.cm":"gmail.com",
  "gnail.com":"gmail.com","gmaill.com":"gmail.com","gmail.ccom":"gmail.com",
  "hotmal.com":"hotmail.com","hotmial.com":"hotmail.com","hotmail.co":"hotmail.com",
  "hotamil.com":"hotmail.com","hotmaill.com":"hotmail.com",
  "yahooo.com":"yahoo.com","yaho.com":"yahoo.com","yahoo.co":"yahoo.com",
  "yhaoo.com":"yahoo.com","yaoo.com":"yahoo.com",
  "outlok.com":"outlook.com","outloook.com":"outlook.com","outllook.com":"outlook.com",
  "iclod.com":"icloud.com","icoud.com":"icloud.com",
  "protonmai.com":"protonmail.com","protonmal.com":"protonmail.com",
};

const ROLE_PREFIXES = new Set([
  "admin","administrator","webmaster","hostmaster","postmaster",
  "noreply","no-reply","donotreply","do-not-reply","mailer-daemon",
  "abuse","security","support","info","contact","sales","marketing",
  "newsletter","unsubscribe","help","root","mail","email","bounce",
  "billing","accounts","enquiries","office",
]);

type Result = {
  email: string;
  status: "valid" | "invalid";
  reason: string | null;
  warning: string | null;
  verificationLevel: string;
};

async function validateOne(email: string, seen: Set<string>): Promise<Result> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { email, status: "invalid", reason: "Invalid email format", warning: null, verificationLevel: "format" };
  }
  const [local, domain] = email.split("@");
  if (local.length < 1 || local.length > 64 || local.includes("..") || local.startsWith(".") || local.endsWith(".")) {
    return { email, status: "invalid", reason: "Invalid email format", warning: null, verificationLevel: "format" };
  }
  if (seen.has(email)) {
    return { email, status: "invalid", reason: "Duplicate — removed", warning: null, verificationLevel: "format" };
  }
  if (TYPOS[domain]) {
    return { email, status: "invalid", reason: `Possible typo — did you mean ${local}@${TYPOS[domain]}?`, warning: null, verificationLevel: "format" };
  }
  if (DISPOSABLE.has(domain)) {
    return { email, status: "invalid", reason: "Disposable email domain", warning: null, verificationLevel: "domain" };
  }
  const hasMx = await domainHasMx(domain);
  if (!hasMx) {
    return { email, status: "invalid", reason: "Domain does not accept email", warning: null, verificationLevel: "dns" };
  }
  seen.add(email);
  return {
    email, status: "valid", reason: null,
    warning: ROLE_PREFIXES.has(local) ? "Role-based address — may not reach a real person" : null,
    verificationLevel: "dns",
  };
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body?.rawEmails?.trim()) return NextResponse.json({ error: "No emails provided" }, { status: 400 });

    const lines: string[] = body.rawEmails
      .split(/[\n,;]+/)
      .map((e: string) => e.trim().toLowerCase())
      .filter((e: string) => e.length > 0);

    if (lines.length === 0) return NextResponse.json({ error: "No emails found" }, { status: 400 });
    if (lines.length > 10000) return NextResponse.json({ error: "Max 10,000 emails per batch" }, { status: 400 });

    const seen = new Set<string>();
    const results: Result[] = [];

    // Process in parallel batches of 20 — far faster than sequential
    const BATCH = 20;
    for (let i = 0; i < lines.length; i += BATCH) {
      const batch = lines.slice(i, i + BATCH);
      const batchResults = await Promise.all(batch.map(e => validateOne(e, seen)));
      results.push(...batchResults);
    }

    const valid = results.filter(r => r.status === "valid");
    const invalid = results.filter(r => r.status === "invalid");

    // Save in batches of 500
    const DB_BATCH = 500;
    if (valid.length > 0) {
      for (let i = 0; i < valid.length; i += DB_BATCH) {
        await db.insert(iwgContacts)
          .values(valid.slice(i, i + DB_BATCH).map(r => ({ userId: auth.userId, email: r.email, status: "valid" })))
          .onConflictDoUpdate({ target: [iwgContacts.userId, iwgContacts.email], set: { status: "valid", validationReason: null } });
      }
    }
    if (invalid.length > 0) {
      for (let i = 0; i < invalid.length; i += DB_BATCH) {
        await db.insert(iwgContacts)
          .values(invalid.slice(i, i + DB_BATCH).map(r => ({ userId: auth.userId, email: r.email, status: "invalid", validationReason: r.reason })))
          .onConflictDoUpdate({ target: [iwgContacts.userId, iwgContacts.email], set: { status: "invalid", validationReason: sql`excluded.validation_reason` } });
      }
    }

    return NextResponse.json({
      results, total: results.length, valid: valid.length, invalid: invalid.length,
      breakdown: {
        dnsVerified: valid.length,
        roleAddresses: valid.filter(r => r.warning).length,
        typosCaught: results.filter(r => r.reason?.includes("did you mean")).length,
        disposable: results.filter(r => r.reason === "Disposable email domain").length,
        invalidDomain: results.filter(r => r.reason === "Domain does not accept email").length,
        invalidFormat: results.filter(r => r.verificationLevel === "format" && r.reason !== "Duplicate — removed").length,
        duplicates: results.filter(r => r.reason === "Duplicate — removed").length,
      },
    });
  } catch (err) {
    console.error("Validation error:", err);
    return NextResponse.json({ error: "Validation failed — please try again" }, { status: 500 });
  }
}
