import { mysqlTable, varchar, text, int, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-call provider telemetry — one row per provider attempt.
 * Written by the ProviderRegistry on every callLlm() attempt (success or failure).
 * Used for latency monitoring, cost estimation, and circuit-breaker forensics.
 */
export const providerCallLogTable = mysqlTable("provider_call_log", {
  id: varchar("id", { length: 64 }).primaryKey(),

  tenantId: varchar("tenant_id", { length: 64 }).notNull(),

  /** FK to providers.id — null if called via legacy env-var path */
  providerId: varchar("provider_id", { length: 64 }),

  /** FK to calls.id — null when called outside a live call (e.g. persona generation) */
  callId: varchar("call_id", { length: 64 }),

  providerVendor: varchar("provider_vendor", { length: 64 }).notNull(),

  /** LLM | STT | TTS */
  providerKind: varchar("provider_kind", { length: 16 }).notNull(),

  modelId: varchar("model_id", { length: 128 }).notNull(),

  /** success | error | timeout | breaker_open */
  outcomeStatus: varchar("outcome_status", { length: 32 }).notNull(),

  /** Wall-clock ms from sending the request to receiving the first response byte */
  latencyMs: int("latency_ms").notNull(),

  inputTokens: int("input_tokens"),
  outputTokens: int("output_tokens"),
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProviderCallLogSchema = createInsertSchema(providerCallLogTable).omit({ createdAt: true });
export type InsertProviderCallLog = z.infer<typeof insertProviderCallLogSchema>;
export type ProviderCallLog = typeof providerCallLogTable.$inferSelect;
