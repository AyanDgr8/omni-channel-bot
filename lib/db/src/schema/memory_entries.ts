import { mysqlTable, varchar, text, int, real, timestamp, datetime } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const memoryEntriesTable = mysqlTable("memory_entries", {
  id: varchar("id", { length: 64 }).primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  hitCount: int("hit_count").notNull().default(0),
  confidence: real("confidence").notNull().default(1.0),
  tier: varchar("tier", { length: 8 }).notNull().default("L3"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastHitAt: datetime("last_hit_at"),
  /** VoxAgent organisation this memory entry belongs to */
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
});

export const insertMemoryEntrySchema = createInsertSchema(memoryEntriesTable).omit({ createdAt: true });
export type InsertMemoryEntry = z.infer<typeof insertMemoryEntrySchema>;
export type MemoryEntry = typeof memoryEntriesTable.$inferSelect;
