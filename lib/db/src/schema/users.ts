import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
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

export const usersTable = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /** OWNER | ADMIN | SUPERVISOR | ANALYST */
  role: text("role").$type<UserRole>().notNull().default("ANALYST"),
  /** active | inactive */
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type UserInsert = typeof usersTable.$inferInsert;
