import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const rows = await db.query.contacts.findMany({
    where: status
      ? (c, { and, eq }) => and(eq(c.userId, auth.userId), eq(c.status, status))
      : (c, { eq }) => eq(c.userId, auth.userId),
    limit: 1000,
    orderBy: (c, { desc }) => [desc(c.createdAt)],
  });
  return NextResponse.json({ contacts: rows });
}

export async function DELETE(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db.delete(contacts).where(eq(contacts.userId, auth.userId));
  return NextResponse.json({ ok: true });
}
