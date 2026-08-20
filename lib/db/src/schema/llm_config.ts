import { mysqlTable, varchar, int, json, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const llmConfigTable = mysqlTable("llm_config", {
  id: varchar("id", { length: 64 }).primaryKey().default("default"),
  primary: varchar("primary", { length: 64 }).notNull().default("openai"),
  /**
   * Ordered vendor fallback chain. MySQL has no array type, so this is a JSON
   * array; the default is applied in JS on insert because MySQL forbids
   * literal DEFAULTs on JSON columns.
   */
  fallbackChain: json("fallback_chain")
    .$type<string[]>()
    .notNull()
    .$defaultFn(() => ["anthropic", "gemini", "ollama"]),
  timeoutMs: int("timeout_ms").notNull().default(3000),
  maxRetries: int("max_retries").notNull().default(2),
  circuitBreakerFailureThreshold: int("circuit_breaker_failure_threshold").notNull().default(5),
  circuitBreakerRecoveryTimeoutSec: int("circuit_breaker_recovery_timeout_sec").notNull().default(30),
  /** VoxAgent organisation; replaces the single id='default' singleton pattern */
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertLlmConfigSchema = createInsertSchema(llmConfigTable);
export type InsertLlmConfig = z.infer<typeof insertLlmConfigSchema>;
export type LlmConfig = typeof llmConfigTable.$inferSelect;
