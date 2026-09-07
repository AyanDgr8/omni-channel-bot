import { mysqlTable, varchar, text, int, boolean, timestamp, datetime, json, uniqueIndex } from "drizzle-orm/mysql-core";

/**
 * MySQL forbids literal DEFAULTs on JSON columns, so every JSON default below
 * is applied in JS via `$defaultFn`.
 */
export const campaignsTable = mysqlTable("campaigns", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  botId: varchar("bot_id", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  /** MySQL TEXT columns cannot carry a literal DEFAULT, so it is applied in JS. */
  objectivePrompt: text("objective_prompt").notNull().$defaultFn(() => ""),
  status: varchar("status", { length: 32 }).notNull().default("DRAFT"),
  scheduleJson: json("schedule_json").notNull().$defaultFn(() => ({})),
  callingWindowOverride: json("calling_window_override"),
  concurrencyCap: int("concurrency_cap").notNull().default(1),
  retryPolicyJson: json("retry_policy_json").notNull().$defaultFn(() => ({ max_attempts: 3, spacing_minutes: 30, per_outcome: {} })),
  successFieldsJson: json("success_fields_json").notNull().$defaultFn(() => []),
  cliNumber: varchar("cli_number", { length: 32 }),
  voicemailScript: text("voicemail_script"),
  abVariantOf: varchar("ab_variant_of", { length: 64 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const campaignContactsTable = mysqlTable("campaign_contacts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  campaignId: varchar("campaign_id", { length: 64 }).notNull(),
  phoneE164: varchar("phone_e164", { length: 32 }).notNull(),
  variablesJson: json("variables_json").notNull().$defaultFn(() => ({})),
  state: varchar("state", { length: 32 }).notNull().default("PENDING"),
  attempts: int("attempts").notNull().default(0),
  nextAttemptAt: datetime("next_attempt_at").notNull().$defaultFn(() => new Date()),
  lastDisposition: varchar("last_disposition", { length: 64 }),
  blockReason: varchar("block_reason", { length: 128 }),
  callId: varchar("call_id", { length: 64 }),
  /** Opaque owner for an in-flight dial attempt. */
  leaseToken: varchar("lease_token", { length: 64 }),
  /** A worker may recover an attempt after this time. */
  leaseExpiresAt: datetime("lease_expires_at"),
  /** Last claim or call-start error; retained for operators and retry decisions. */
  leaseError: text("lease_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  campaignPhoneUnique: uniqueIndex("campaign_contacts_campaign_phone_idx").on(table.campaignId, table.phoneE164),
}));

export const dispositionsTable = mysqlTable("dispositions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  campaignId: varchar("campaign_id", { length: 64 }).notNull(),
  campaignContactId: varchar("campaign_contact_id", { length: 64 }),
  callId: varchar("call_id", { length: 64 }).notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  summaryText: text("summary_text"),
  extractedFieldsJson: json("extracted_fields_json").notNull().$defaultFn(() => ({})),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  callUnique: uniqueIndex("dispositions_call_idx").on(table.callId),
}));

export const callbacksTable = mysqlTable("callbacks", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  campaignId: varchar("campaign_id", { length: 64 }).notNull(),
  campaignContactId: varchar("campaign_contact_id", { length: 64 }).notNull(),
  callId: varchar("call_id", { length: 64 }),
  scheduledFor: datetime("scheduled_for").notNull(),
  note: text("note"),
  fulfilled: boolean("fulfilled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
