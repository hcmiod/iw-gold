import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { iwgUsers } from "@/lib/db/schema";
import { getAdminAuth } from "@/lib/auth";
import { eq } from "drizzle-orm";

// DELETE /api/admin/users/[id] — delete a user
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!getAdminAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db.delete(iwgUsers).where(eq(iwgUsers.id, params.id));
  return NextResponse.json({ ok: true });
}

// PATCH /api/admin/users/[id] — reset password
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!getAdminAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { password } = body;

  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 12);
  await db.update(iwgUsers)
    .set({ passwordHash: hash })
    .where(eq(iwgUsers.id, params.id));

  return NextResponse.json({ ok: true });
}
