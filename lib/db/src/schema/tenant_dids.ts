import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";
import { tenantsTable } from "./tenants";

/**
 * Maps a DID (E.164 phone number) to a tenant.
 * Used by POST /v1/calls/receive to resolve the tenant from the called number
 * and validate the webhook secret.
 */
export const tenantDidsTable = mysqlTable("tenant_dids", {
  id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: varchar("tenant_id", { length: 64 })
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  /** E.164 format, e.g. +14155552671 — globally unique across all tenants */
  didE164: varchar("did_e164", { length: 32 }).notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TenantDid = typeof tenantDidsTable.$inferSelect;
