import { pgTable, text, integer, boolean, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const conversationConfigTable = pgTable("conversation_config", {
  id: text("id").primaryKey().default("default"),
  answerDelayMs: integer("answer_delay_ms").notNull().default(400),
  maxSilenceMs: integer("max_silence_ms").notNull().default(2000),
  bargeInEnabled: boolean("barge_in_enabled").notNull().default(true),
  bargeInThreshold: real("barge_in_threshold").notNull().default(0.6),
  minSpeechMs: integer("min_speech_ms").notNull().default(200),
  endOfUtteranceMs: integer("end_of_utterance_ms").notNull().default(800),
  maxTurnDurationSec: integer("max_turn_duration_sec").notNull().default(60),
  responseTimeoutSec: integer("response_timeout_sec").notNull().default(5),
  speakingRate: real("speaking_rate").notNull().default(1.0),
  interWordPauseMs: integer("inter_word_pause_ms").notNull().default(0),
  /** VoxAgent organisation; replaces the single id='default' singleton pattern */
  tenantId: text("tenant_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertConversationConfigSchema = createInsertSchema(conversationConfigTable);
export type InsertConversationConfig = z.infer<typeof insertConversationConfigSchema>;
export type ConversationConfig = typeof conversationConfigTable.$inferSelect;
