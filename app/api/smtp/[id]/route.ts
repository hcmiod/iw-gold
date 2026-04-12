import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgSmtpAccounts } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db.delete(iwgSmtpAccounts).where(and(eq(iwgSmtpAccounts.id, params.id), eq(iwgSmtpAccounts.userId, auth.userId)));
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  await db.update(iwgSmtpAccounts).set({ isActive: body.isActive }).where(and(eq(iwgSmtpAccounts.id, params.id), eq(iwgSmtpAccounts.userId, auth.userId)));
  return NextResponse.json({ ok: true });
}
