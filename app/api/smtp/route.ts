import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgSmtpAccounts } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accounts = await db.query.iwgSmtpAccounts.findMany({ where: (a, { eq }) => eq(a.userId, auth.userId), orderBy: (a, { asc }) => [asc(a.createdAt)] });
  return NextResponse.json({ accounts: accounts.map(a => ({ ...a, password: "••••••••••••" })) });
}

export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body.username || !body.password) return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  const existing = await db.query.iwgSmtpAccounts.findMany({ where: (a, { eq }) => eq(a.userId, auth.userId) });
  const [account] = await db.insert(iwgSmtpAccounts).values({
    userId: auth.userId, label: body.label || `Account ${existing.length + 1}`,
    host: body.host || "smtp.gmail.com", port: body.port || 587, secure: body.secure || false,
    username: body.username, password: body.password,
    dailyLimit: body.dailyLimit || 500, throttleSeconds: body.throttleSeconds || 5,
  }).returning();
  return NextResponse.json({ account: { ...account, password: "••••••••••••" } }, { status: 201 });
}
