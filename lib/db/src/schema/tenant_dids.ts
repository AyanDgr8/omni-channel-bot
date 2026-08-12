import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Maps a DID (E.164 phone number) to a tenant.
 * Used by POST /v1/calls/receive to resolve the tenant from the called number
 * and validate the webhook secret.
 */
export const tenantDidsTable = pgTable("tenant_dids", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  /** E.164 format, e.g. +14155552671 — globally unique across all tenants */
  didE164: text("did_e164").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantDid = typeof tenantDidsTable.$inferSelect;
