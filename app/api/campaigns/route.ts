import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgCampaigns } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth";
import { desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db.query.iwgCampaigns.findMany({ where: (c, { eq }) => eq(c.userId, auth.userId), orderBy: [desc(iwgCampaigns.createdAt)], limit: 50 });
  return NextResponse.json({ campaigns: rows });
}

export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const [camp] = await db.insert(iwgCampaigns).values({
    userId: auth.userId, name: body.name, fromName: body.fromName,
    subject: body.subject, htmlBody: body.htmlBody, textBody: body.textBody,
  }).returning();
  return NextResponse.json({ campaign: camp }, { status: 201 });
}
