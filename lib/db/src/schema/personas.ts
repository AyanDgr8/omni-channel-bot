import { pgTable, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const personasTable = pgTable("personas", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  description: text("description"),
  // "library" | "llm_generated" | "manual"
  source: text("source").notNull().default("manual"),
  isActive: boolean("is_active").notNull().default(false),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Persona = typeof personasTable.$inferSelect;
export type PersonaInsert = typeof personasTable.$inferInsert;
