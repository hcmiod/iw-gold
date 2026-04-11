import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgContacts } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth";
import { sql } from "drizzle-orm";
import { promises as dns } from "dns";

// Cache checked domains to avoid repeated DNS lookups
const domainCache = new Map<string, boolean>();

async function domainHasMx(domain: string): Promise<boolean> {
  if (domainCache.has(domain)) return domainCache.get(domain)!;
  try {
    const records = await dns.resolveMx(domain);
    const valid = records.length > 0;
    domainCache.set(domain, valid);
    return valid;
  } catch {
    domainCache.set(domain, false);
    return false;
  }
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

  const disposable = [
    "mailinator.com","guerrillamail.com","tempmail.com","throwaway.email",
    "yopmail.com","trashmail.com","10minutemail.com","sharklasers.com",
    "guerrillamailblock.com","grr.la","guerrillamail.info","spam4.me",
    "maildrop.cc","dispostable.com","fakeinbox.com","spamgourmet.com",
  ];

  const seen = new Set<string>();
  const results: any[] = [];

  for (const email of lines) {
    // 1. Format check
    const formatOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    if (!formatOk) {
      results.push({ email, status: "invalid", reason: "Invalid format" });
      continue;
    }

    // 2. Duplicate check
    if (seen.has(email)) {
      results.push({ email, status: "invalid", reason: "Duplicate" });
      continue;
    }

    const domain = email.split("@")[1];

    // 3. Disposable domain check
    if (disposable.includes(domain)) {
      results.push({ email, status: "invalid", reason: "Disposable email domain" });
      continue;
    }

    // 4. DNS MX record check — does domain actually accept email?
    const hasMx = await domainHasMx(domain);
    if (!hasMx) {
      results.push({ email, status: "invalid", reason: "Domain has no mail server" });
      continue;
    }

    seen.add(email);
    results.push({ email, status: "valid", reason: null });
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
      .values(invalid.map(r => ({ userId: auth.userId, email: r.email, status: "invalid", validationReason: r.reason })))
      .onConflictDoUpdate({
        target: [iwgContacts.userId, iwgContacts.email],
        set: { status: "invalid", validationReason: sql`excluded.validation_reason` },
      });
  }

  return NextResponse.json({
    results,
    total: results.length,
    valid: valid.length,
    invalid: invalid.length,
  });
}
