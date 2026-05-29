import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const callsTable = pgTable("calls", {
  id: text("id").primaryKey(),
  botId: text("bot_id").notNull(),
  direction: text("direction").notNull(),
  status: text("status").notNull().default("INITIATING"),
  customerNumber: text("customer_number"),
  customerName: text("customer_name"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  hangupReason: text("hangup_reason"),
  sipCode: integer("sip_code"),
  amdResult: text("amd_result"),
  languageDetected: text("language_detected"),
  recordingUrl: text("recording_url"),
  summary: text("summary"),
  transferTarget: text("transfer_target"),
  followUpSent: boolean("follow_up_sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCallSchema = createInsertSchema(callsTable).omit({ createdAt: true });
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof callsTable.$inferSelect;
