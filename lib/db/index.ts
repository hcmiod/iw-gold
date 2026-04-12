import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Lazy initialization — ensures DATABASE_URL is loaded before connecting
let _db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (_db) return _db;
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Make sure .env.local is loaded before importing db.");
  }
  const client = postgres(process.env.DATABASE_URL, {
    max: 10,
    ssl: { rejectUnauthorized: false },
  });
  _db = drizzle(client, { schema });
  return _db;
}

// Proxy that lazily initializes on first use
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    const database = getDb();
    const value = (database as any)[prop];
    if (typeof value === "function") {
      return value.bind(database);
    }
    return value;
  },
});
