import { mysqlTable, varchar, text, boolean, timestamp, datetime, json, uniqueIndex } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** Tenant-owned do-not-call records. phoneNumber is always stored in E.164 form. */
export const dncEntriesTable = mysqlTable("dnc_entries", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  phoneNumber: varchar("phone_number", { length: 32 }).notNull(),
  source: varchar("source", { length: 32 }).notNull().default("manual"),
  reason: text("reason"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
  expiresAt: datetime("expires_at"),
  createdByUserId: varchar("created_by_user_id", { length: 64 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tenantPhoneUnique: uniqueIndex("dnc_entries_tenant_phone_idx").on(table.tenantId, table.phoneNumber),
}));

/** Immutable consent history. The latest non-expired event is authoritative. */
export const consentLedgerTable = mysqlTable("consent_ledger", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  phoneNumber: varchar("phone_number", { length: 32 }).notNull(),
  consentType: varchar("consent_type", { length: 32 }).notNull().default("VOICE_CALLING"),
  status: varchar("status", { length: 32 }).notNull(),
  source: varchar("source", { length: 32 }).notNull().default("manual"),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
  expiresAt: datetime("expires_at"),
  evidence: text("evidence"),
  actorUserId: varchar("actor_user_id", { length: 64 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Per-tenant jurisdiction controls used by the single compliance decision gate. */
export const complianceProfilesTable = mysqlTable("compliance_profiles", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  jurisdictionCode: varchar("jurisdiction_code", { length: 32 }).notNull(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
  callingWindowStart: varchar("calling_window_start", { length: 8 }).notNull().default("09:00"),
  callingWindowEnd: varchar("calling_window_end", { length: 8 }).notNull().default("21:00"),
  /** JSON defaults are applied in JS — MySQL forbids literal DEFAULTs on JSON. */
  allowedDays: json("allowed_days").$type<string[]>().notNull().$defaultFn(() => ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]),
  holidays: json("holidays").$type<string[]>().notNull().$defaultFn(() => []),
  requireConsent: boolean("require_consent").notNull().default(false),
  requireRecordingConsent: boolean("require_recording_consent").notNull().default(false),
  mandatoryDisclosureText: text("mandatory_disclosure_text"),
  blockOnHoliday: boolean("block_on_holiday").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  tenantJurisdictionUnique: uniqueIndex("compliance_profiles_tenant_jurisdiction_idx").on(table.tenantId, table.jurisdictionCode),
}));

/** Evidence for every compliance decision, including blocked attempts with no call row. */
export const complianceDecisionsTable = mysqlTable("compliance_decisions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  callId: varchar("call_id", { length: 64 }),
  botId: varchar("bot_id", { length: 64 }).notNull(),
  phoneNumber: varchar("phone_number", { length: 32 }).notNull(),
  direction: varchar("direction", { length: 16 }).notNull(),
  decision: varchar("decision", { length: 32 }).notNull(),
  reasonCode: varchar("reason_code", { length: 64 }).notNull(),
  reason: text("reason").notNull(),
  jurisdictionCode: varchar("jurisdiction_code", { length: 32 }).notNull(),
  calledPartyTimezone: varchar("called_party_timezone", { length: 64 }).notNull(),
  disclosureText: text("disclosure_text"),
  recordingConsentRequired: boolean("recording_consent_required").notNull().default(false),
  evaluatedAt: timestamp("evaluated_at").notNull().defaultNow(),
  metadataJson: json("metadata_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Immutable telephony media acknowledgements used to substantiate compliance state. */
export const complianceMediaEventsTable = mysqlTable("compliance_media_events", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  callId: varchar("call_id", { length: 64 }).notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(), // DISCLOSURE_PLAYED | RECORDING_CONSENT_GRANTED | RECORDING_CONSENT_DECLINED
  evidence: text("evidence").notNull(),
  occurredAt: datetime("occurred_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDncEntrySchema = createInsertSchema(dncEntriesTable).omit({ createdAt: true });
export const insertConsentLedgerSchema = createInsertSchema(consentLedgerTable).omit({ createdAt: true });
export const insertComplianceProfileSchema = createInsertSchema(complianceProfilesTable).omit({ createdAt: true, updatedAt: true });
export const insertComplianceDecisionSchema = createInsertSchema(complianceDecisionsTable).omit({ createdAt: true });

export type DncEntry = typeof dncEntriesTable.$inferSelect;
export type ConsentLedgerEntry = typeof consentLedgerTable.$inferSelect;
export type ComplianceProfile = typeof complianceProfilesTable.$inferSelect;
export type ComplianceDecision = typeof complianceDecisionsTable.$inferSelect;
export type InsertDncEntry = z.infer<typeof insertDncEntrySchema>;
export type InsertConsentLedger = z.infer<typeof insertConsentLedgerSchema>;
export type InsertComplianceProfile = z.infer<typeof insertComplianceProfileSchema>;
export type InsertComplianceDecision = z.infer<typeof insertComplianceDecisionSchema>;
