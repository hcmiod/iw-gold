import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { campaignRecipients, suppressionList, emailEvents, campaigns } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  return new NextResponse(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Unsubscribe</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:20px;color:#111;text-align:center}
h1{font-size:22px}p{color:#555}button{background:#111;color:#fff;border:none;border-radius:8px;padding:12px 32px;font-size:15px;cursor:pointer;margin-top:16px}</style></head>
<body><h1>Unsubscribe</h1><p>Click below to remove yourself from this mailing list.</p>
<button onclick="fetch(location.href,{method:'POST'}).then(()=>{document.body.innerHTML='<h1>✓ Unsubscribed</h1><p>You have been removed.</p>'})">Unsubscribe Me</button></body></html>`,
  { headers: { "Content-Type": "text/html" } });
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const recipientId = searchParams.get("r");
  if (recipientId) {
    try {
      const r = await db.query.campaignRecipients.findFirst({ where: (r, { eq }) => eq(r.id, recipientId) });
      if (r) {
        await db.insert(suppressionList).values({ email: r.email, reason: "unsubscribed" }).onConflictDoNothing();
        await db.update(campaigns).set({ totalBounced: sql`total_bounced + 1` }).where(eq(campaigns.id, r.campaignId));
      }
    } catch {}
  }
  return NextResponse.json({ ok: true });
}
