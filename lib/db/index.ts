import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global { var _pg: postgres.Sql | undefined; }

const client = globalThis._pg ?? postgres(process.env.DATABASE_URL!, {
  max: 10, ssl: { rejectUnauthorized: false },
});
if (process.env.NODE_ENV !== "production") globalThis._pg = client;

export const db = drizzle(client, { schema });
