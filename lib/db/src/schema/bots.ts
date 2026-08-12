import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botsTable = pgTable("bots", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  sipExtension: text("sip_extension").notNull(),
  sipDomain: text("sip_domain"),
  whatsappNumber: text("whatsapp_number"),
  status: text("status").notNull().default("OFFLINE"),
  activeCalls: integer("active_calls").notNull().default(0),

  // ── Call Direction System ──────────────────────────────────────────────────
  /** "inbound" | "outbound" */
  direction: text("direction").notNull().default("inbound"),
  /** InboundDirectionConfig | OutboundDirectionConfig — stored as JSONB */
  directionConfig: jsonb("direction_config"),
  /** ISO 639-1 codes the bot can converse in, e.g. ["en","hi","ar"] */
  supportedLanguages: text("supported_languages").array().notNull().default(["en"]),
  /** ISO 639-1 code for the opening greeting */
  defaultGreetingLanguage: text("default_greeting_language").notNull().default("en"),
  /** IANA timezone, e.g. "Asia/Kolkata" — used for time-of-day greeting logic */
  timezone: text("timezone").notNull().default("UTC"),

  // ── Conversation-intelligence tunables ────────────────────────────────────
  /** ms of silence after caller stops before bot replies (800–2000, default 1200) */
  endpointSilenceMs: integer("endpoint_silence_ms").notNull().default(1200),
  /** max ms of caller audio that counts as a backchannel, not a barge-in (default 700) */
  backchannelThresholdMs: integer("backchannel_threshold_ms").notNull().default(700),
  /** seconds of caller silence before first re-prompt (default 6) */
  silenceRecoverySecs: integer("silence_recovery_secs").notNull().default(6),

  /** VoxAgent organisation this bot belongs to */
  tenantId: text("tenant_id").notNull(),

  /**
   * Per-bot active persona (Option A: coexists with personas.is_active which
   * remains a UI-level convenience flag). Null = no persona assigned to this bot.
   */
  activePersonaId: text("active_persona_id"),

  // ── Provider Registry — per-bot engine config (FR-TECH-02/05/06) ──────────

  /**
   * Ordered LLM fallback chain: [{provider_id, model_id, params?}]
   * params: { temperature?: number, max_tokens?: number }
   * NULL = use tenant-level provider list.
   */
  llmChainJson: jsonb("llm_chain_json"),

  /**
   * Per-language STT map: { "en": { provider_id, model_id }, "hi": { ... } }
   * NULL = use first enabled tenant STT provider for all languages.
   */
  sttMapJson: jsonb("stt_map_json"),

  /**
   * Per-language TTS map: { "en": { provider_id, model_id, voice? }, ... }
   * NULL = use first enabled tenant TTS provider for all languages.
   */
  ttsMapJson: jsonb("tts_map_json"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBotSchema = createInsertSchema(botsTable).omit({ createdAt: true });
export type InsertBot = z.infer<typeof insertBotSchema>;
export type Bot = typeof botsTable.$inferSelect;
