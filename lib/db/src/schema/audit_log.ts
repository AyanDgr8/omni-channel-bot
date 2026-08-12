import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Immutable audit trail. Written by middleware on every mutating request
 * that touches personas, bots, configs, or users.
 */
export const auditLogTable = pgTable("audit_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id").notNull(),
  actorUserId: text("actor_user_id"),
  /** CREATE | UPDATE | DELETE */
  action: text("action").notNull(),
  /** persona | bot | config | user | flow | memory */
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogTable.$inferSelect;
