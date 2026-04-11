import { db } from "./index";
import { sql } from "drizzle-orm";

let done = false;

export async function autoMigrate() {
  if (done) return;
  try {
    console.log("IW-Gold: running migration...");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS iwg_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        password_hash TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS iwg_smtp_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES iwg_users(id) ON DELETE CASCADE,
        label TEXT,
        host TEXT NOT NULL DEFAULT 'smtp.gmail.com',
        port INTEGER NOT NULL DEFAULT 587,
        secure BOOLEAN NOT NULL DEFAULT false,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        reply_to TEXT,
        daily_limit INTEGER NOT NULL DEFAULT 500,
        throttle_seconds INTEGER NOT NULL DEFAULT 5,
        sent_today INTEGER NOT NULL DEFAULT 0,
        last_reset_at TIMESTAMP DEFAULT NOW(),
        is_active BOOLEAN NOT NULL DEFAULT true,
        last_tested_at TIMESTAMP,
        last_test_ok BOOLEAN,
        last_error TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    // Add reply_to column if it doesn't exist (for existing deployments)
    await db.execute(sql`
      ALTER TABLE iwg_smtp_accounts ADD COLUMN IF NOT EXISTS reply_to TEXT
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS iwg_contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES iwg_users(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        validation_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        UNIQUE(user_id, email)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS iwg_campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES iwg_users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        from_name TEXT NOT NULL,
        reply_to TEXT,
        subject TEXT NOT NULL,
        html_body TEXT NOT NULL,
        text_body TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        total_recipients INTEGER NOT NULL DEFAULT 0,
        total_sent INTEGER NOT NULL DEFAULT 0,
        total_failed INTEGER NOT NULL DEFAULT 0,
        total_opened INTEGER NOT NULL DEFAULT 0,
        total_clicked INTEGER NOT NULL DEFAULT 0,
        total_bounced INTEGER NOT NULL DEFAULT 0,
        open_rate REAL,
        click_rate REAL,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    await db.execute(sql`
      ALTER TABLE iwg_campaigns ADD COLUMN IF NOT EXISTS reply_to TEXT
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS iwg_campaign_recipients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id UUID NOT NULL REFERENCES iwg_campaigns(id) ON DELETE CASCADE,
        contact_id UUID REFERENCES iwg_contacts(id),
        email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        smtp_account_id UUID REFERENCES iwg_smtp_accounts(id),
        message_id TEXT,
        sent_at TIMESTAMP,
        error TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        UNIQUE(campaign_id, email)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS iwg_email_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id UUID REFERENCES iwg_campaigns(id),
        recipient_id UUID REFERENCES iwg_campaign_recipients(id),
        event_type TEXT NOT NULL,
        url TEXT,
        user_agent TEXT,
        ip_address TEXT,
        occurred_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS iwg_suppression_list (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES iwg_users(id),
        email TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    done = true;
    console.log("✓ IW-Gold migration complete");
  } catch (err) {
    console.error("IW-Gold migration error:", err);
    throw err;
  }
}
