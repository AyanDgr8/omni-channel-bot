import { pgTable, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Registered provider instances per tenant (or platform-pooled when tenant_id IS NULL).
 * One row = one credential+endpoint pair that bots can reference in their engine chains.
 */
export const providersTable = pgTable("providers", {
  id: text("id").primaryKey(),

  /** NULL = platform-pooled (shared across all tenants as last-resort fallback) */
  tenantId: text("tenant_id"),

  /** LLM | STT | TTS */
  kind: text("kind").notNull(),

  /**
   * Vendor slug — must match a vendor value in model_catalog.
   * LLM: openai | anthropic | google-gemini | sarvam | openai-compatible
   * STT: deepgram | elevenlabs | google | sarvam | whisper-compatible
   * TTS: elevenlabs | google | deepgram-aura | cartesia | sarvam | azure
   */
  vendor: text("vendor").notNull(),

  displayName: text("display_name").notNull(),

  /** Custom base URL — required for openai-compatible / whisper-compatible vendors */
  baseUrl: text("base_url"),

  /** bearer | api-key | none */
  authMode: text("auth_mode").notNull().default("bearer"),

  /** AES-256-GCM ciphertext of the raw API key — never returned to clients */
  apiKeyEncrypted: text("api_key_encrypted"),

  /** Extra vendor-specific options (e.g. Deepgram diarization, Sarvam language hints) */
  configJson: jsonb("config_json"),

  enabled: boolean("enabled").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProviderSchema = createInsertSchema(providersTable).omit({ createdAt: true, updatedAt: true });
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Provider = typeof providersTable.$inferSelect;
