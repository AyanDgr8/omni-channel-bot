import { mysqlTable, varchar, real, boolean, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const personaConfigTable = mysqlTable("persona_config", {
  id: varchar("id", { length: 64 }).primaryKey().default("default"),
  name: varchar("name", { length: 255 }).notNull().default("Aria"),
  character: varchar("character", { length: 64 }).notNull().default("professional"),
  formality: real("formality").notNull().default(0.8),
  verbosity: real("verbosity").notNull().default(0.5),
  empathyLevel: real("empathy_level").notNull().default(0.7),
  humorLevel: real("humor_level").notNull().default(0.1),
  speakingRate: real("speaking_rate").notNull().default(1.0),
  pitch: real("pitch").notNull().default(0.0),
  voiceId: varchar("voice_id", { length: 128 }),
  fillerWordsEnabled: boolean("filler_words_enabled").notNull().default(false),
  greetingStyle: varchar("greeting_style", { length: 64 }).notNull().default("warm"),
  interruptMode: varchar("interrupt_mode", { length: 32 }).notNull().default("HARD_INTERRUPT"),
  /** VoxAgent organisation; replaces the single id='default' singleton pattern */
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPersonaConfigSchema = createInsertSchema(personaConfigTable);
export type InsertPersonaConfig = z.infer<typeof insertPersonaConfigSchema>;
export type PersonaConfig = typeof personaConfigTable.$inferSelect;
