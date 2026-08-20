import { mysqlTable, varchar, int, boolean, real, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const conversationConfigTable = mysqlTable("conversation_config", {
  id: varchar("id", { length: 64 }).primaryKey().default("default"),
  answerDelayMs: int("answer_delay_ms").notNull().default(400),
  maxSilenceMs: int("max_silence_ms").notNull().default(2000),
  bargeInEnabled: boolean("barge_in_enabled").notNull().default(true),
  bargeInThreshold: real("barge_in_threshold").notNull().default(0.6),
  minSpeechMs: int("min_speech_ms").notNull().default(200),
  endOfUtteranceMs: int("end_of_utterance_ms").notNull().default(800),
  maxTurnDurationSec: int("max_turn_duration_sec").notNull().default(60),
  responseTimeoutSec: int("response_timeout_sec").notNull().default(5),
  speakingRate: real("speaking_rate").notNull().default(1.0),
  interWordPauseMs: int("inter_word_pause_ms").notNull().default(0),
  /** VoxAgent organisation; replaces the single id='default' singleton pattern */
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertConversationConfigSchema = createInsertSchema(conversationConfigTable);
export type InsertConversationConfig = z.infer<typeof insertConversationConfigSchema>;
export type ConversationConfig = typeof conversationConfigTable.$inferSelect;
