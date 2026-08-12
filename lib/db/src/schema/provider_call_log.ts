import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-call provider telemetry — one row per provider attempt.
 * Written by the ProviderRegistry on every callLlm() attempt (success or failure).
 * Used for latency monitoring, cost estimation, and circuit-breaker forensics.
 */
export const providerCallLogTable = pgTable("provider_call_log", {
  id: text("id").primaryKey(),

  tenantId: text("tenant_id").notNull(),

  /** FK to providers.id — null if called via legacy env-var path */
  providerId: text("provider_id"),

  /** FK to calls.id — null when called outside a live call (e.g. persona generation) */
  callId: text("call_id"),

  providerVendor: text("provider_vendor").notNull(),

  /** LLM | STT | TTS */
  providerKind: text("provider_kind").notNull(),

  modelId: text("model_id").notNull(),

  /** success | error | timeout | breaker_open */
  outcomeStatus: text("outcome_status").notNull(),

  /** Wall-clock ms from sending the request to receiving the first response byte */
  latencyMs: integer("latency_ms").notNull(),

  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProviderCallLogSchema = createInsertSchema(providerCallLogTable).omit({ createdAt: true });
export type InsertProviderCallLog = z.infer<typeof insertProviderCallLogSchema>;
export type ProviderCallLog = typeof providerCallLogTable.$inferSelect;
