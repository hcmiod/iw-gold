import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgContacts } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth";
import { sql } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { rawEmails } = await req.json();
  if (!rawEmails) return NextResponse.json({ error: "No emails provided" }, { status: 400 });

  const lines = rawEmails.split(/[\n,;]+/).map((e: string) => e.trim().toLowerCase()).filter((e: string) => e.length > 0);
  if (lines.length === 0) return NextResponse.json({ error: "No emails found" }, { status: 400 });

  const disposable = ["mailinator.com","guerrillamail.com","tempmail.com","throwaway.email","yopmail.com","trashmail.com","10minutemail.com"];
  const seen = new Set<string>();
  const results: any[] = [];

  for (const email of lines) {
    const formatOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    if (!formatOk) { results.push({ email, status: "invalid", reason: "Invalid format" }); continue; }
    if (seen.has(email)) { results.push({ email, status: "invalid", reason: "Duplicate" }); continue; }
    const domain = email.split("@")[1];
    if (disposable.includes(domain)) { results.push({ email, status: "invalid", reason: "Disposable email" }); continue; }
    seen.add(email);
    results.push({ email, status: "valid", reason: null });
  }

  const valid = results.filter(r => r.status === "valid");
  if (valid.length > 0) {
    await db.insert(iwgContacts)
      .values(valid.map(r => ({ userId: auth.userId, email: r.email, status: "valid" })))
      .onConflictDoUpdate({ target: [iwgContacts.userId, iwgContacts.email], set: { status: "valid" } });
  }
  const invalid = results.filter(r => r.status === "invalid");
  if (invalid.length > 0) {
    await db.insert(iwgContacts)
      .values(invalid.map(r => ({ userId: auth.userId, email: r.email, status: "invalid", validationReason: r.reason })))
      .onConflictDoUpdate({ target: [iwgContacts.userId, iwgContacts.email], set: { status: "invalid", validationReason: sql`excluded.validation_reason` } });
  }

  return NextResponse.json({ results, total: results.length, valid: valid.length, invalid: invalid.length });
}
