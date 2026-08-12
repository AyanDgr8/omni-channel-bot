import { pgTable, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const memoryEntriesTable = pgTable("memory_entries", {
  id: text("id").primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  hitCount: integer("hit_count").notNull().default(0),
  confidence: real("confidence").notNull().default(1.0),
  tier: text("tier").notNull().default("L3"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastHitAt: timestamp("last_hit_at", { withTimezone: true }),
  /** VoxAgent organisation this memory entry belongs to */
  tenantId: text("tenant_id").notNull(),
});

export const insertMemoryEntrySchema = createInsertSchema(memoryEntriesTable).omit({ createdAt: true });
export type InsertMemoryEntry = z.infer<typeof insertMemoryEntrySchema>;
export type MemoryEntry = typeof memoryEntriesTable.$inferSelect;
