import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const calendarInvitesTable = pgTable("calendar_invites", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  start: timestamp("start", { withTimezone: true }).notNull(),
  end: timestamp("end", { withTimezone: true }).notNull(),
  timezone: text("timezone").notNull(),
  attendees: text("attendees").array().notNull().default([]),
  location: text("location"),
  meetLink: text("meet_link"),
  calendarEventId: text("calendar_event_id"),
  callId: text("call_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCalendarInviteSchema = createInsertSchema(calendarInvitesTable).omit({ createdAt: true });
export type InsertCalendarInvite = z.infer<typeof insertCalendarInviteSchema>;
export type CalendarInvite = typeof calendarInvitesTable.$inferSelect;
