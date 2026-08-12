import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const writingStyleProfilesTable = pgTable("writing_style_profiles", {
  id: text("id").primaryKey().default("default"),
  greeting: text("greeting").notNull().default("Hi,"),
  signOff: text("sign_off").notNull().default("Best regards,"),
  tone: text("tone").notNull().default("professional"),
  callSummaryTemplate: text("call_summary_template").notNull().default(
    "Hi {{customerName}},\n\nThank you for speaking with us today. Here is a summary of our call:\n\n{{summary}}\n\n{{signOff}}"
  ),
  styleExamples: jsonb("style_examples").notNull().$type<string[]>().default([]),
  learnedPatterns: jsonb("learned_patterns").notNull().$type<Record<string, unknown>>().default({}),
  lastLearnedAt: timestamp("last_learned_at"),
  /** VoxAgent organisation this profile belongs to */
  tenantId: text("tenant_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WritingStyleProfile = typeof writingStyleProfilesTable.$inferSelect;
