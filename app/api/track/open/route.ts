import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgEmailEvents, iwgCampaigns } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const recipientId = searchParams.get("r");
  const campaignId = searchParams.get("c");
  if (recipientId && campaignId) {
    try {
      const existing = await db.query.iwgEmailEvents.findFirst({ where: (e, { and, eq }) => and(eq(e.recipientId, recipientId), eq(e.eventType, "opened")) });
      if (!existing) {
        await db.insert(iwgEmailEvents).values({ campaignId, recipientId, eventType: "opened", userAgent: req.headers.get("user-agent") });
        await db.update(iwgCampaigns).set({ totalOpened: sql`total_opened + 1` }).where(eq(iwgCampaigns.id, campaignId));
      }
    } catch {}
  }
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  return new NextResponse(gif, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });
}
