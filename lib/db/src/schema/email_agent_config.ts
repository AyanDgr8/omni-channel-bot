import { mysqlTable, varchar, boolean, timestamp } from "drizzle-orm/mysql-core";

export const emailAgentConfigTable = mysqlTable("email_agent_config", {
  id: varchar("id", { length: 64 }).primaryKey().default("default"),
  /**
   * Microsoft Azure Active Directory tenant ID (for Graph API auth).
   * DB column kept as "tenant_id" — cannot be renamed without a breaking migration.
   * In application code always use `msTenantId` to avoid confusion with the
   * VoxAgent org `voxTenantId`.
   */
  msTenantId: varchar("tenant_id", { length: 128 }).notNull().default(""),
  clientId: varchar("client_id", { length: 128 }).notNull().default(""),
  clientSecret: varchar("client_secret", { length: 512 }).notNull().default(""),
  userEmail: varchar("user_email", { length: 255 }).notNull().default(""),
  isEnabled: boolean("is_enabled").notNull().default(false),
  /** VoxAgent organisation that owns this mail integration config */
  voxTenantId: varchar("vox_tenant_id", { length: 64 }).notNull().default("default"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EmailAgentConfig = typeof emailAgentConfigTable.$inferSelect;
export type EmailAgentConfigInput = Omit<EmailAgentConfig, "id" | "createdAt" | "updatedAt">;
