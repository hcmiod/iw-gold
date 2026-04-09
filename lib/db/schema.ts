import {
  pgTable, text, timestamp, integer, boolean, uuid, real, index, uniqueIndex
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Users ────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── SMTP Accounts (Gmail pool) ────────────────────────────
export const smtpAccounts = pgTable("smtp_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label"),                     // display name e.g. "Account 1"
  host: text("host").notNull().default("smtp.gmail.com"),
  port: integer("port").notNull().default(587),
  secure: boolean("secure").notNull().default(false),
  username: text("username").notNull(),     // Gmail address
  password: text("password").notNull(),     // App password
  dailyLimit: integer("daily_limit").notNull().default(500),
  throttleSeconds: integer("throttle_seconds").notNull().default(5),
  sentToday: integer("sent_today").notNull().default(0),
  lastResetAt: timestamp("last_reset_at").defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
  lastTestedAt: timestamp("last_tested_at"),
  lastTestOk: boolean("last_test_ok"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Contacts ──────────────────────────────────────────────
export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  status: text("status").notNull().default("pending"), // pending | valid | invalid | sent | bounced | unsubscribed
  validationReason: text("validation_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniq: uniqueIndex("uniq_user_contact").on(t.userId, t.email),
  statusIdx: index("contacts_status_idx").on(t.userId, t.status),
}));

// ── Campaigns ─────────────────────────────────────────────
export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  fromName: text("from_name").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body"),
  status: text("status").notNull().default("draft"), // draft | sending | completed | paused
  totalRecipients: integer("total_recipients").notNull().default(0),
  totalSent: integer("total_sent").notNull().default(0),
  totalFailed: integer("total_failed").notNull().default(0),
  totalOpened: integer("total_opened").notNull().default(0),
  totalClicked: integer("total_clicked").notNull().default(0),
  totalBounced: integer("total_bounced").notNull().default(0),
  openRate: real("open_rate"),
  clickRate: real("click_rate"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Campaign Recipients ───────────────────────────────────
export const campaignRecipients = pgTable("campaign_recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id),
  email: text("email").notNull(),
  status: text("status").notNull().default("pending"), // pending | sent | failed | bounced
  smtpAccountId: uuid("smtp_account_id").references(() => smtpAccounts.id),
  messageId: text("message_id"),
  sentAt: timestamp("sent_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniq: uniqueIndex("uniq_campaign_email").on(t.campaignId, t.email),
  statusIdx: index("recipients_status_idx").on(t.campaignId, t.status),
}));

// ── Email Events ──────────────────────────────────────────
export const emailEvents = pgTable("email_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  recipientId: uuid("recipient_id").references(() => campaignRecipients.id),
  eventType: text("event_type").notNull(), // opened | clicked | bounced | unsubscribed
  url: text("url"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
});

// ── Suppression list ──────────────────────────────────────
export const suppressionList = pgTable("suppression_list", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  email: text("email").notNull().unique(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Types ─────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type SmtpAccount = typeof smtpAccounts.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
