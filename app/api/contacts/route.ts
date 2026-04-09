import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgContacts } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db.query.iwgContacts.findMany({ where: (c, { eq }) => eq(c.userId, auth.userId), limit: 1000 });
  return NextResponse.json({ contacts: rows });
}

export async function DELETE(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db.delete(iwgContacts).where(eq(iwgContacts.userId, auth.userId));
  return NextResponse.json({ ok: true });
}
