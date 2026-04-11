import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

const SECRET = process.env.AUTH_SECRET ?? "iw-gold-secret-change-me";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@iwgold.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";

export type AuthPayload = { userId: string; isAdmin?: boolean };

// ── User auth ─────────────────────────────────────────────────────────────────
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

// ── Admin auth ────────────────────────────────────────────────────────────────
export function getAdminAuth(req: NextRequest): boolean {
  try {
    const h = req.headers.get("authorization");
    if (!h?.startsWith("Bearer ")) return false;
    const payload = jwt.verify(h.slice(7), SECRET) as AuthPayload;
    return payload.isAdmin === true;
  } catch { return false; }
}

export function signAdminToken() {
  return jwt.sign({ userId: "admin", isAdmin: true }, SECRET, { expiresIn: "12h" });
}

export function verifyAdminCredentials(email: string, password: string): boolean {
  return email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && password === ADMIN_PASSWORD;
}
