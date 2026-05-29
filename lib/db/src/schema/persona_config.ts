import { pgTable, text, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const personaConfigTable = pgTable("persona_config", {
  id: text("id").primaryKey().default("default"),
  name: text("name").notNull().default("Aria"),
  character: text("character").notNull().default("professional"),
  formality: real("formality").notNull().default(0.8),
  verbosity: real("verbosity").notNull().default(0.5),
  empathyLevel: real("empathy_level").notNull().default(0.7),
  humorLevel: real("humor_level").notNull().default(0.1),
  speakingRate: real("speaking_rate").notNull().default(1.0),
  pitch: real("pitch").notNull().default(0.0),
  voiceId: text("voice_id"),
  fillerWordsEnabled: boolean("filler_words_enabled").notNull().default(false),
  greetingStyle: text("greeting_style").notNull().default("warm"),
  interruptMode: text("interrupt_mode").notNull().default("HARD_INTERRUPT"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPersonaConfigSchema = createInsertSchema(personaConfigTable);
export type InsertPersonaConfig = z.infer<typeof insertPersonaConfigSchema>;
export type PersonaConfig = typeof personaConfigTable.$inferSelect;
