import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgCampaigns } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth";
import { boss, QUEUES } from "@/lib/queue/boss";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { emails } = await req.json();
  if (!emails?.length) return NextResponse.json({ error: "No valid emails" }, { status: 400 });
  const campaign = await db.query.iwgCampaigns.findFirst({ where: (c, { and, eq }) => and(eq(c.id, params.id), eq(c.userId, auth.userId)) });
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.update(iwgCampaigns).set({ status: "sending", updatedAt: new Date() }).where(eq(iwgCampaigns.id, params.id));
  try {
    await boss.start();
    await boss.send(QUEUES.PROCESS_CAMPAIGN, { campaignId: params.id, userId: auth.userId, emails });
  } catch (err) { console.error("Queue error:", err); }
  return NextResponse.json({ ok: true });
}
