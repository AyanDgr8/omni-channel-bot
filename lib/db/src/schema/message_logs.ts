import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const messageLogsTable = mysqlTable("message_logs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  channel: varchar("channel", { length: 32 }).notNull(),
  recipient: varchar("recipient", { length: 255 }).notNull(),
  templateName: varchar("template_name", { length: 255 }),
  messageId: varchar("message_id", { length: 128 }),
  status: varchar("status", { length: 32 }).notNull().default("sent"),
  callId: varchar("call_id", { length: 64 }),
  /** VoxAgent organisation this message belongs to */
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMessageLogSchema = createInsertSchema(messageLogsTable).omit({ createdAt: true });
export type InsertMessageLog = z.infer<typeof insertMessageLogSchema>;
export type MessageLog = typeof messageLogsTable.$inferSelect;
