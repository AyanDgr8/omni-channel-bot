import { mysqlTable, varchar, text, boolean, timestamp, json } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Registered provider instances per tenant (or platform-pooled when tenant_id IS NULL).
 * One row = one credential+endpoint pair that bots can reference in their engine chains.
 */
export const providersTable = mysqlTable("providers", {
  id: varchar("id", { length: 64 }).primaryKey(),

  /** NULL = platform-pooled (shared across all tenants as last-resort fallback) */
  tenantId: varchar("tenant_id", { length: 64 }),

  /** LLM | STT | TTS */
  kind: varchar("kind", { length: 16 }).notNull(),

  /**
   * Vendor slug — must match a vendor value in model_catalog.
   * LLM: openai | anthropic | google-gemini | sarvam | openai-compatible
   * STT: deepgram | elevenlabs | google | sarvam | whisper-compatible
   * TTS: elevenlabs | google | deepgram-aura | cartesia | sarvam | azure
   */
  vendor: varchar("vendor", { length: 64 }).notNull(),

  displayName: varchar("display_name", { length: 255 }).notNull(),

  /** Custom base URL — required for openai-compatible / whisper-compatible vendors */
  baseUrl: text("base_url"),

  /** bearer | api-key | none */
  authMode: varchar("auth_mode", { length: 16 }).notNull().default("bearer"),

  /** AES-256-GCM ciphertext of the raw API key — never returned to clients */
  apiKeyEncrypted: text("api_key_encrypted"),

  /** Extra vendor-specific options (e.g. Deepgram diarization, Sarvam language hints) */
  configJson: json("config_json"),

  enabled: boolean("enabled").notNull().default(true),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProviderSchema = createInsertSchema(providersTable).omit({ createdAt: true, updatedAt: true });
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Provider = typeof providersTable.$inferSelect;
