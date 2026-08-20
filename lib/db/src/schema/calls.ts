import { mysqlTable, varchar, text, int, boolean, timestamp, datetime, json } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const callsTable = mysqlTable("calls", {
  id: varchar("id", { length: 64 }).primaryKey(),
  botId: varchar("bot_id", { length: 64 }).notNull(),
  direction: varchar("direction", { length: 16 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("INITIATING"),
  customerNumber: varchar("customer_number", { length: 32 }),
  customerName: varchar("customer_name", { length: 255 }),
  startedAt: datetime("started_at"),
  endedAt: datetime("ended_at"),
  durationSeconds: int("duration_seconds"),
  hangupReason: varchar("hangup_reason", { length: 64 }),
  sipCode: int("sip_code"),
  amdResult: varchar("amd_result", { length: 32 }),
  languageDetected: varchar("language_detected", { length: 16 }),
  recordingUrl: text("recording_url"),
  summary: text("summary"),
  transferTarget: varchar("transfer_target", { length: 64 }),
  followUpSent: boolean("follow_up_sent").notNull().default(false),

  // ── Call-Connect Intelligence ──────────────────────────────────────────────
  /** Outcome of the call-connect handler: HUMAN | ANSWERING_MACHINE | IVR | SILENCE | NO_RESPONSE */
  connectOutcome: varchar("connect_outcome", { length: 32 }),
  /** Number of times the caller barges in while the bot is speaking */
  interruptionCount: int("interruption_count").notNull().default(0),
  /** Number of escalation triggers detected during the call */
  escalationCount: int("escalation_count").notNull().default(0),
  /** JSON array of language-switch events: [{from, to, at}] */
  languageSwitches: json("language_switches"),
  /** Final call disposition set by the call-connect state machine */
  finalDisposition: varchar("final_disposition", { length: 64 }),

  // ── Persona Audit ──────────────────────────────────────────────────────────
  /** ID of the persona that was active when this call started */
  personaId: varchar("persona_id", { length: 64 }),
  /** Fully-composed system prompt injected for this call */
  composedPrompt: text("composed_prompt"),

  /** VoxAgent organisation this call belongs to */
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCallSchema = createInsertSchema(callsTable).omit({ createdAt: true });
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof callsTable.$inferSelect;
