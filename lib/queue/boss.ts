import PgBoss from "pg-boss";

declare global { var _boss: PgBoss | undefined; }

export const boss: PgBoss = globalThis._boss ?? new PgBoss({
  connectionString: process.env.DATABASE_URL!,
  newJobCheckInterval: 1000,
  deleteAfterDays: 7,
  retryLimit: 3,
  retryDelay: 10,
  retryBackoff: true,
});

if (process.env.NODE_ENV !== "production") globalThis._boss = boss;

export const QUEUES = {
  SEND_EMAIL: "iw-send-email",
  PROCESS_CAMPAIGN: "iw-process-campaign",
} as const;
