import { mysqlTable, varchar, int, json, timestamp } from "drizzle-orm/mysql-core";
import { personasTable } from "./personas";

export interface PersonaTraitsJson {
  identity: {
    role_title: string;
    backstory: string;
    goals: string[];
  };
  language: {
    jargon: string[];
    greeting_phrases: string[];
    closing_phrases: string[];
    forbidden_phrases: string[];
    sample_utterances: string[];
  };
  tone: {
    warmth: number;
    formality: number;
    energy: number;
    empathy: number;
    verbosity: number;
  };
  voice: {
    suggested_gender: string;
    pace: string;
    pitch: string;
    deepgram_voice_hint: string;
  };
  behavior: {
    interrupt_tolerance: string;
    silence_strategy: string;
    escalation_rule: string;
    do_rules: string[];
    dont_rules: string[];
  };
}

export const personaTraitsTable = mysqlTable("persona_traits", {
  id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  personaId: varchar("persona_id", { length: 64 })
    .notNull()
    .references(() => personasTable.id, { onDelete: "cascade" }),
  version: int("version").notNull().default(1),
  traits: json("traits").notNull().$type<PersonaTraitsJson>(),
  generatedByModel: varchar("generated_by_model", { length: 128 }),
  /** Denormalised from parent persona for fast tenant filtering */
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PersonaTraits = typeof personaTraitsTable.$inferSelect;
export type PersonaTraitsInsert = typeof personaTraitsTable.$inferInsert;
