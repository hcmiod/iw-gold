import PgBoss from "pg-boss";

// Each process gets its own boss instance
// The web app uses it to ENQUEUE jobs
// The worker uses it to PROCESS jobs
// They communicate through the database — not shared memory

export function createBoss() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  return new PgBoss({
    connectionString: process.env.DATABASE_URL,
    newJobCheckInterval: 1000,
    deleteAfterDays: 7,
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    // Prevent pg-boss from creating duplicate schema on each instance
    noSupervisor: false,
  });
}

// Singleton for the current process only
let _boss: PgBoss | null = null;
let _started = false;

export async function getBoss(): Promise<PgBoss> {
  if (!_boss) {
    _boss = createBoss();
  }
  if (!_started) {
    await _boss.start();
    _started = true;
  }
  return _boss;
}

export const QUEUES = {
  SEND_EMAIL: "iw-send-email",
  PROCESS_CAMPAIGN: "iw-process-campaign",
} as const;
