import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { iwgEmailEvents, iwgCampaigns } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const encodedUrl = searchParams.get("url");
  const recipientId = searchParams.get("r");
  const campaignId = searchParams.get("c");

  const targetUrl = encodedUrl ? decodeURIComponent(encodedUrl) : "/";

  if (recipientId && campaignId) {
    try {
      await db.insert(iwgEmailEvents).values({
        campaignId,
        recipientId,
        eventType: "clicked",
        url: targetUrl,
        userAgent: req.headers.get("user-agent") ?? undefined,
      });
      await db.update(iwgCampaigns)
        .set({ totalClicked: sql`total_clicked + 1` })
        .where(eq(iwgCampaigns.id, campaignId));
    } catch {}
  }

  return NextResponse.redirect(targetUrl, { status: 302 });
}
