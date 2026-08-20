import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";

export const tenantsTable = mysqlTable("tenants", {
  id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  /** active | suspended */
  status: varchar("status", { length: 32 }).notNull().default("active"),
  region: varchar("region", { length: 64 }).notNull().default("global"),
  /** Secret checked in X-Webhook-Secret header for /v1/calls/receive */
  webhookSecret: varchar("webhook_secret", { length: 255 }).notNull().$defaultFn(() => crypto.randomUUID()),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Tenant = typeof tenantsTable.$inferSelect;
export type TenantInsert = typeof tenantsTable.$inferInsert;
