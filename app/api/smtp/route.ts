import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { testSmtpConnection } from "@/lib/email/smtp-pool";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await testSmtpConnection(params.id, auth.userId);
  return NextResponse.json(result);
}
