import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { iwgCampaigns, iwgSmtpAccounts } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [accounts, recentCampaigns] = await Promise.all([
      db.query.iwgSmtpAccounts.findMany({ where: (a, { eq }) => eq(a.userId, auth.userId) }),
      db.query.iwgCampaigns.findMany({
        where: (c, { eq }) => eq(c.userId, auth.userId),
        orderBy: [desc(iwgCampaigns.createdAt)],
        limit: 7,
      }),
    ]);

    const active = accounts.filter(a => a.isActive);
    const now = new Date();

    // Reset daily counters if new day
    const resetNeeded = active.filter(a => {
      const last = a.lastResetAt ?? new Date(0);
      return now.toDateString() !== last.toDateString();
    });

    if (resetNeeded.length > 0) {
      // Reset in background — don't block response
      Promise.all(resetNeeded.map(a =>
        db.update(iwgSmtpAccounts)
          .set({ sentToday: 0, lastResetAt: now })
          .where((s => s.id === a.id) as any)
      )).catch(console.error);
      resetNeeded.forEach(a => { a.sentToday = 0; });
    }

    const totalCapacity = active.reduce((s, a) => s + a.dailyLimit, 0);
    const totalSentToday = active.reduce((s, a) => s + a.sentToday, 0);

    return NextResponse.json({
      pool: {
        accounts: accounts.map(a => ({ ...a, password: "••••••••••••" })),
        active: active.length,
        totalCapacity,
        totalSentToday,
        remaining: Math.max(0, totalCapacity - totalSentToday),
      },
      campaigns: recentCampaigns,
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
