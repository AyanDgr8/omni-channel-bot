import { pgTable, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
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

  // ── Call-Connect Intelligence ──────────────────────────────────────────────
  /** Outcome of the call-connect handler: HUMAN | ANSWERING_MACHINE | IVR | SILENCE | NO_RESPONSE */
  connectOutcome: text("connect_outcome"),
  /** Number of times the caller barges in while the bot is speaking */
  interruptionCount: integer("interruption_count").notNull().default(0),
  /** Number of escalation triggers detected during the call */
  escalationCount: integer("escalation_count").notNull().default(0),
  /** JSON array of language-switch events: [{from, to, at}] */
  languageSwitches: jsonb("language_switches"),
  /** Final call disposition set by the call-connect state machine */
  finalDisposition: text("final_disposition"),

  // ── Persona Audit ──────────────────────────────────────────────────────────
  /** ID of the persona that was active when this call started */
  personaId: text("persona_id"),
  /** Fully-composed system prompt injected for this call */
  composedPrompt: text("composed_prompt"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCallSchema = createInsertSchema(callsTable).omit({ createdAt: true });
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof callsTable.$inferSelect;
