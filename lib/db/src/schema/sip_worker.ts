import { mysqlTable, varchar, timestamp, uniqueIndex } from "drizzle-orm/mysql-core";

/** Durable idempotency/session mapping for authenticated FreeSWITCH deliveries. */
export const sipWorkerSessionsTable = mysqlTable("sip_worker_sessions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  eventId: varchar("event_id", { length: 191 }).notNull(),
  freeswitchUuid: varchar("freeswitch_uuid", { length: 191 }).notNull(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  botId: varchar("bot_id", { length: 64 }).notNull(),
  callId: varchar("call_id", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  eventUnique: uniqueIndex("sip_worker_sessions_event_unique").on(table.eventId),
  uuidUnique: uniqueIndex("sip_worker_sessions_uuid_unique").on(table.freeswitchUuid),
  tenantCallUnique: uniqueIndex("sip_worker_sessions_tenant_call_unique").on(table.tenantId, table.callId),
}));
