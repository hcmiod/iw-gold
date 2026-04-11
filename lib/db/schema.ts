import { pgTable, text, timestamp, integer, boolean, uuid, real, uniqueIndex } from "drizzle-orm/pg-core";

export const iwgUsers = pgTable("iwg_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const iwgSmtpAccounts = pgTable("iwg_smtp_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => iwgUsers.id, { onDelete: "cascade" }),
  label: text("label"),
  host: text("host").notNull().default("smtp.gmail.com"),
  port: integer("port").notNull().default(587),
  secure: boolean("secure").notNull().default(false),
  username: text("username").notNull(),
  password: text("password").notNull(),
  replyTo: text("reply_to"),           // reply-to / display sender address
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

export const iwgContacts = pgTable("iwg_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => iwgUsers.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  status: text("status").notNull().default("pending"),
  validationReason: text("validation_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniq: uniqueIndex("iwg_uniq_user_contact").on(t.userId, t.email),
}));

export const iwgCampaigns = pgTable("iwg_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => iwgUsers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  fromName: text("from_name").notNull(),
  replyTo: text("reply_to"),           // reply-to address for replies
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body"),
  status: text("status").notNull().default("draft"),
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

export const iwgCampaignRecipients = pgTable("iwg_campaign_recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => iwgCampaigns.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => iwgContacts.id),
  email: text("email").notNull(),
  status: text("status").notNull().default("pending"),
  smtpAccountId: uuid("smtp_account_id").references(() => iwgSmtpAccounts.id),
  messageId: text("message_id"),
  sentAt: timestamp("sent_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniq: uniqueIndex("iwg_uniq_campaign_email").on(t.campaignId, t.email),
}));

export const iwgEmailEvents = pgTable("iwg_email_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").references(() => iwgCampaigns.id),
  recipientId: uuid("recipient_id").references(() => iwgCampaignRecipients.id),
  eventType: text("event_type").notNull(),
  url: text("url"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
});

export const iwgSuppressionList = pgTable("iwg_suppression_list", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => iwgUsers.id),
  email: text("email").notNull().unique(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type IwgUser = typeof iwgUsers.$inferSelect;
export type IwgSmtpAccount = typeof iwgSmtpAccounts.$inferSelect;
export type IwgContact = typeof iwgContacts.$inferSelect;
export type IwgCampaign = typeof iwgCampaigns.$inferSelect;
export type IwgCampaignRecipient = typeof iwgCampaignRecipients.$inferSelect;
