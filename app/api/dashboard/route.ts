import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { iwgCampaigns, iwgSmtpAccounts } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [accounts, recentCampaigns] = await Promise.all([
    db.query.iwgSmtpAccounts.findMany({ where: (a, { eq }) => eq(a.userId, auth.userId) }),
    db.query.iwgCampaigns.findMany({ where: (c, { eq }) => eq(c.userId, auth.userId), orderBy: [desc(iwgCampaigns.createdAt)], limit: 7 }),
  ]);

  const active = accounts.filter(a => a.isActive);
  const totalCapacity = active.reduce((s, a) => s + a.dailyLimit, 0);
  const totalSentToday = active.reduce((s, a) => s + a.sentToday, 0);

  return NextResponse.json({
    pool: { accounts, active: active.length, totalCapacity, totalSentToday, remaining: totalCapacity - totalSentToday },
    campaigns: recentCampaigns,
  });
}
