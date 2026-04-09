import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { getPoolStats } from "@/lib/email/smtp-pool";
import { campaigns } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [pool, recentCampaigns] = await Promise.all([
    getPoolStats(auth.userId),
    db.query.campaigns.findMany({ where: (c, { eq }) => eq(c.userId, auth.userId), orderBy: [desc(campaigns.createdAt)], limit: 7 }),
  ]);
  return NextResponse.json({ pool, campaigns: recentCampaigns });
}
