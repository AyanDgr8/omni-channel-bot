import { mysqlTable, varchar, text, json, timestamp } from "drizzle-orm/mysql-core";

/**
 * Immutable audit trail. Written by middleware on every mutating request
 * that touches personas, bots, configs, or users.
 */
export const auditLogTable = mysqlTable("audit_log", {
  id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  actorUserId: varchar("actor_user_id", { length: 64 }),
  /** CREATE | UPDATE | DELETE */
  action: varchar("action", { length: 32 }).notNull(),
  /** persona | bot | config | user | flow | memory */
  entity: varchar("entity", { length: 64 }).notNull(),
  entityId: varchar("entity_id", { length: 64 }),
  beforeJson: json("before_json"),
  afterJson: json("after_json"),
  ip: text("ip"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AuditLog = typeof auditLogTable.$inferSelect;
