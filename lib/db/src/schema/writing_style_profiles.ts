import { mysqlTable, varchar, text, json, timestamp, datetime } from "drizzle-orm/mysql-core";

const DEFAULT_CALL_SUMMARY_TEMPLATE =
  "Hi {{customerName}},\n\nThank you for speaking with us today. Here is a summary of our call:\n\n{{summary}}\n\n{{signOff}}";

export const writingStyleProfilesTable = mysqlTable("writing_style_profiles", {
  id: varchar("id", { length: 64 }).primaryKey().default("default"),
  greeting: varchar("greeting", { length: 255 }).notNull().default("Hi,"),
  signOff: varchar("sign_off", { length: 255 }).notNull().default("Best regards,"),
  tone: varchar("tone", { length: 64 }).notNull().default("professional"),
  /** MySQL TEXT columns cannot carry a literal DEFAULT — applied in JS instead. */
  callSummaryTemplate: text("call_summary_template")
    .notNull()
    .$defaultFn(() => DEFAULT_CALL_SUMMARY_TEMPLATE),
  /** MySQL forbids literal DEFAULTs on JSON columns — defaults applied in JS. */
  styleExamples: json("style_examples").$type<string[]>().notNull().$defaultFn(() => []),
  learnedPatterns: json("learned_patterns")
    .$type<Record<string, unknown>>()
    .notNull()
    .$defaultFn(() => ({})),
  lastLearnedAt: datetime("last_learned_at"),
  /** VoxAgent organisation this profile belongs to */
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WritingStyleProfile = typeof writingStyleProfilesTable.$inferSelect;
