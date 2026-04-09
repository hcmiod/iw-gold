import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { autoMigrate } from "@/lib/db/migrate";
import { signToken } from "@/lib/auth";

let migrated = false;
async function ensureMigrated() { if (!migrated) { await autoMigrate(); migrated = true; } }

export async function POST(req: NextRequest) {
  await ensureMigrated();
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const body = await req.json();
  if (action === "login") {
    const user = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, body.email?.toLowerCase()) });
    if (!user?.passwordHash) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    return NextResponse.json({ token: signToken(user.id), user: { id: user.id, name: user.name, email: user.email } });
  }
  const existing = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, body.email?.toLowerCase()) });
  if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  const hash = await bcrypt.hash(body.password, 12);
  const [user] = await db.insert(users).values({ email: body.email.toLowerCase(), name: body.name, passwordHash: hash }).returning();
  return NextResponse.json({ token: signToken(user.id), user: { id: user.id, name: user.name, email: user.email } });
}
