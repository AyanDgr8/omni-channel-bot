import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botsTable = pgTable("bots", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  sipExtension: text("sip_extension").notNull(),
  sipDomain: text("sip_domain"),
  whatsappNumber: text("whatsapp_number"),
  status: text("status").notNull().default("OFFLINE"),
  activeCalls: integer("active_calls").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBotSchema = createInsertSchema(botsTable).omit({ createdAt: true });
export type InsertBot = z.infer<typeof insertBotSchema>;
export type Bot = typeof botsTable.$inferSelect;
