import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

const SECRET = process.env.AUTH_SECRET ?? "iw-gold-secret-change-me";

export type AuthPayload = { userId: string };

export function getAuth(req: NextRequest): AuthPayload | null {
  try {
    const h = req.headers.get("authorization");
    if (!h?.startsWith("Bearer ")) return null;
    return jwt.verify(h.slice(7), SECRET) as AuthPayload;
  } catch { return null; }
}

export function signToken(userId: string) {
  return jwt.sign({ userId }, SECRET, { expiresIn: "30d" });
}
