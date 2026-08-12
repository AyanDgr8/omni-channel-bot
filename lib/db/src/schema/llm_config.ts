import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const llmConfigTable = pgTable("llm_config", {
  id: text("id").primaryKey().default("default"),
  primary: text("primary").notNull().default("openai"),
  fallbackChain: text("fallback_chain").array().notNull().default(["anthropic", "gemini", "ollama"]),
  timeoutMs: integer("timeout_ms").notNull().default(3000),
  maxRetries: integer("max_retries").notNull().default(2),
  circuitBreakerFailureThreshold: integer("circuit_breaker_failure_threshold").notNull().default(5),
  circuitBreakerRecoveryTimeoutSec: integer("circuit_breaker_recovery_timeout_sec").notNull().default(30),
  /** VoxAgent organisation; replaces the single id='default' singleton pattern */
  tenantId: text("tenant_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLlmConfigSchema = createInsertSchema(llmConfigTable);
export type InsertLlmConfig = z.infer<typeof insertLlmConfigSchema>;
export type LlmConfig = typeof llmConfigTable.$inferSelect;
