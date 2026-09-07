import { mysqlTable, varchar, text, int, timestamp, json } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botsTable = mysqlTable("bots", {
  id: varchar("id", { length: 64 }).primaryKey(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  sipExtension: varchar("sip_extension", { length: 64 }).notNull(),
  sipDomain: varchar("sip_domain", { length: 255 }),
  /** WebRTC is the legacy transport; SIP requires a corresponding sip_configs row. */
  telephonyType: varchar("telephony_type", { length: 16 }).notNull().default("webrtc"),
  whatsappNumber: varchar("whatsapp_number", { length: 32 }),
  status: varchar("status", { length: 32 }).notNull().default("OFFLINE"),
  activeCalls: int("active_calls").notNull().default(0),

  // ── Call Direction System ──────────────────────────────────────────────────
  /** "inbound" | "outbound" */
  direction: varchar("direction", { length: 16 }).notNull().default("inbound"),
  /** InboundDirectionConfig | OutboundDirectionConfig — stored as JSON */
  directionConfig: json("direction_config"),
  /**
   * ISO 639-1 codes the bot can converse in, e.g. ["en","hi","ar"].
   * MySQL has no array type, so this is a JSON array. The default is applied
   * in JS on insert (MySQL forbids literal DEFAULTs on JSON columns).
   */
  supportedLanguages: json("supported_languages").$type<string[]>().notNull().$defaultFn(() => ["en"]),
  /** ISO 639-1 code for the opening greeting */
  defaultGreetingLanguage: varchar("default_greeting_language", { length: 16 }).notNull().default("en"),
  /** IANA timezone, e.g. "Asia/Kolkata" — used for time-of-day greeting logic */
  timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),

  // ── Conversation-intelligence tunables ────────────────────────────────────
  /** ms of silence after caller stops before bot replies (800–2000, default 1200) */
  endpointSilenceMs: int("endpoint_silence_ms").notNull().default(1200),
  /** max ms of caller audio that counts as a backchannel, not a barge-in (default 700) */
  backchannelThresholdMs: int("backchannel_threshold_ms").notNull().default(700),
  /** seconds of caller silence before first re-prompt (default 6) */
  silenceRecoverySecs: int("silence_recovery_secs").notNull().default(6),

  /** VoxAgent organisation this bot belongs to */
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),

  /**
   * Per-bot active persona (Option A: coexists with personas.is_active which
   * remains a UI-level convenience flag). Null = no persona assigned to this bot.
   */
  activePersonaId: varchar("active_persona_id", { length: 64 }),

  // ── Provider Registry — per-bot engine config (FR-TECH-02/05/06) ──────────

  /**
   * Ordered LLM fallback chain: [{provider_id, model_id, params?}]
   * params: { temperature?: number, max_tokens?: number }
   * NULL = use tenant-level provider list.
   */
  llmChainJson: json("llm_chain_json"),

  /**
   * Per-language STT map: { "en": { provider_id, model_id }, "hi": { ... } }
   * NULL = use first enabled tenant STT provider for all languages.
   */
  sttMapJson: json("stt_map_json"),

  /**
   * Per-language TTS map: { "en": { provider_id, model_id, voice? }, ... }
   * NULL = use first enabled tenant TTS provider for all languages.
   */
  ttsMapJson: json("tts_map_json"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBotSchema = createInsertSchema(botsTable).omit({ createdAt: true });
export type InsertBot = z.infer<typeof insertBotSchema>;
export type Bot = typeof botsTable.$inferSelect;
