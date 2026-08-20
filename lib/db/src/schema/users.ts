import { mysqlTable, varchar, text, timestamp } from "drizzle-orm/mysql-core";
import { tenantsTable } from "./tenants";

/** Role hierarchy (ascending privilege): ANALYST < SUPERVISOR < ADMIN < OWNER */
export const USER_ROLES = ["ANALYST", "SUPERVISOR", "ADMIN", "OWNER"] as const;
export type UserRole = typeof USER_ROLES[number];

export const ROLE_RANK: Record<UserRole, number> = {
  ANALYST: 1,
  SUPERVISOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

export const usersTable = mysqlTable("users", {
  id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: varchar("tenant_id", { length: 64 })
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /** OWNER | ADMIN | SUPERVISOR | ANALYST */
  role: varchar("role", { length: 32 }).$type<UserRole>().notNull().default("ANALYST"),
  /** active | inactive */
  status: varchar("status", { length: 32 }).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type UserInsert = typeof usersTable.$inferInsert;
