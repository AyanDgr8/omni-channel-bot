import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const messageLogsTable = pgTable("message_logs", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  recipient: text("recipient").notNull(),
  templateName: text("template_name"),
  messageId: text("message_id"),
  status: text("status").notNull().default("sent"),
  callId: text("call_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMessageLogSchema = createInsertSchema(messageLogsTable).omit({ createdAt: true });
export type InsertMessageLog = z.infer<typeof insertMessageLogSchema>;
export type MessageLog = typeof messageLogsTable.$inferSelect;
