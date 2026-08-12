import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
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

export const personaTraitsTable = pgTable("persona_traits", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  personaId: text("persona_id")
    .notNull()
    .references(() => personasTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  traits: jsonb("traits").notNull().$type<PersonaTraitsJson>(),
  generatedByModel: text("generated_by_model"),
  /** Denormalised from parent persona for fast tenant filtering */
  tenantId: text("tenant_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PersonaTraits = typeof personaTraitsTable.$inferSelect;
export type PersonaTraitsInsert = typeof personaTraitsTable.$inferInsert;
