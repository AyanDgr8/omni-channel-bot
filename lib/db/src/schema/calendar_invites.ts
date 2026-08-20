import { mysqlTable, varchar, text, json, timestamp, datetime } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const calendarInvitesTable = mysqlTable("calendar_invites", {
  id: varchar("id", { length: 64 }).primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  start: datetime("start").notNull(),
  end: datetime("end").notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull(),
  /**
   * Attendee email addresses. MySQL has no array type, so this is a JSON array
   * with the default applied in JS on insert.
   */
  attendees: json("attendees").$type<string[]>().notNull().$defaultFn(() => []),
  location: text("location"),
  meetLink: text("meet_link"),
  calendarEventId: varchar("calendar_event_id", { length: 128 }),
  callId: varchar("call_id", { length: 64 }),
  /** VoxAgent organisation this invite belongs to */
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCalendarInviteSchema = createInsertSchema(calendarInvitesTable).omit({ createdAt: true });
export type InsertCalendarInvite = z.infer<typeof insertCalendarInviteSchema>;
export type CalendarInvite = typeof calendarInvitesTable.$inferSelect;
