import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { iwgUsers } from "@/lib/db/schema";
import { autoMigrate } from "@/lib/db/migrate";
import { signToken, signAdminToken, verifyAdminCredentials } from "@/lib/auth";

let migrated = false;
async function ensureMigrated() {
  if (!migrated) { await autoMigrate(); migrated = true; }
}

export async function POST(req: NextRequest) {
  await ensureMigrated();
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const body = await req.json().catch(() => ({}));

  // ── Admin login ───────────────────────────────────────────────────────────
  if (action === "admin-login") {
    const ok = verifyAdminCredentials(body.email ?? "", body.password ?? "");
    if (!ok) return NextResponse.json({ error: "Invalid admin credentials" }, { status: 401 });
    return NextResponse.json({ token: signAdminToken() });
  }

  // ── User login ────────────────────────────────────────────────────────────
  if (action === "login") {
    const user = await db.query.iwgUsers.findFirst({
      where: (u, { eq }) => eq(u.email, body.email?.toLowerCase?.() ?? ""),
    });
    if (!user?.passwordHash) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    const ok = await bcrypt.compare(body.password ?? "", user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    return NextResponse.json({
      token: signToken(user.id),
      user: { id: user.id, name: user.name, email: user.email },
    });
  }

  // ── Public signup is disabled ─────────────────────────────────────────────
  return NextResponse.json(
    { error: "Registration is disabled. Contact the administrator." },
    { status: 403 }
  );
}
