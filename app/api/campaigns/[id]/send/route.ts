import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgCampaigns } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth";
import { getBoss, QUEUES } from "@/lib/queue/boss";
import { eq } from "drizzle-orm";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { emails } = body;

  if (!emails?.length) {
    return NextResponse.json({ error: "No valid emails provided" }, { status: 400 });
  }

  const campaign = await db.query.iwgCampaigns.findFirst({
    where: (c, { and, eq }) => and(eq(c.id, params.id), eq(c.userId, auth.userId)),
  });

  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  if (campaign.status === "sending") {
    return NextResponse.json({ error: "Campaign is already sending" }, { status: 409 });
  }

  // Mark as sending
  await db.update(iwgCampaigns)
    .set({ status: "sending", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(iwgCampaigns.id, params.id));

  // Enqueue the campaign processor job
  try {
    const boss = await getBoss();
    await boss.send(QUEUES.PROCESS_CAMPAIGN, {
      campaignId: params.id,
      userId: auth.userId,
      emails,
    });
    console.log(`Campaign ${params.id} queued with ${emails.length} emails`);
  } catch (err) {
    console.error("Failed to queue campaign:", err);
    // Revert status if queue fails
    await db.update(iwgCampaigns)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(iwgCampaigns.id, params.id));
    return NextResponse.json({ error: "Failed to start campaign — please try again" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: "Campaign is now sending" });
}
