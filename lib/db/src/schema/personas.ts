import { mysqlTable, varchar, text, boolean, int, timestamp } from "drizzle-orm/mysql-core";

export const personasTable = mysqlTable("personas", {
  id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 255 }).notNull().unique(),
  description: text("description"),
  // "library" | "llm_generated" | "manual"
  source: varchar("source", { length: 32 }).notNull().default("manual"),
  isActive: boolean("is_active").notNull().default(false),
  version: int("version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  /** VoxAgent organisation this persona belongs to */
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
});

export type Persona = typeof personasTable.$inferSelect;
export type PersonaInsert = typeof personasTable.$inferInsert;
