import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emailEvents, campaigns } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = decodeURIComponent(searchParams.get("url") ?? "/");
  const recipientId = searchParams.get("r");
  const campaignId = searchParams.get("c");
  if (recipientId && campaignId) {
    try {
      await db.insert(emailEvents).values({ campaignId, recipientId, eventType: "clicked", url, userAgent: req.headers.get("user-agent") });
      await db.update(campaigns).set({ totalClicked: sql`total_clicked + 1` }).where(eq(campaigns.id, campaignId));
    } catch {}
  }
  return NextResponse.redirect(url, { status: 302 });
}
