import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const tenantsTable = pgTable("tenants", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** active | suspended */
  status: text("status").notNull().default("active"),
  region: text("region").notNull().default("global"),
  /** Secret checked in X-Webhook-Secret header for /v1/calls/receive */
  webhookSecret: text("webhook_secret").notNull().$defaultFn(() => crypto.randomUUID()),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenantsTable.$inferSelect;
export type TenantInsert = typeof tenantsTable.$inferInsert;
