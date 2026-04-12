import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { iwgUsers } from "@/lib/db/schema";
import { getAdminAuth } from "@/lib/auth";
import { desc } from "drizzle-orm";

// GET /api/admin/users — list all users
export async function GET(req: NextRequest) {
  if (!getAdminAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const users = await db.query.iwgUsers.findMany({
    orderBy: [desc(iwgUsers.createdAt)],
  });
  return NextResponse.json({
    users: users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.createdAt,
    })),
  });
}

// POST /api/admin/users — create a new user
export async function POST(req: NextRequest) {
  if (!getAdminAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { name, email, password } = body;

  if (!name || !email || !password) {
    return NextResponse.json({ error: "Name, email and password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existing = await db.query.iwgUsers.findFirst({
    where: (u, { eq }) => eq(u.email, email.toLowerCase().trim()),
  });
  if (existing) {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 });
  }

  const hash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(iwgUsers).values({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash: hash,
  }).returning();

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
  }, { status: 201 });
}
