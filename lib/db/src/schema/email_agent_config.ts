import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const emailAgentConfigTable = pgTable("email_agent_config", {
  id: text("id").primaryKey().default("default"),
  /**
   * Microsoft Azure Active Directory tenant ID (for Graph API auth).
   * DB column kept as "tenant_id" — cannot be renamed without a breaking migration.
   * In application code always use `msTenantId` to avoid confusion with the
   * VoxAgent org `voxTenantId`.
   */
  msTenantId: text("tenant_id").notNull().default(""),
  clientId: text("client_id").notNull().default(""),
  clientSecret: text("client_secret").notNull().default(""),
  userEmail: text("user_email").notNull().default(""),
  isEnabled: boolean("is_enabled").notNull().default(false),
  /** VoxAgent organisation that owns this mail integration config */
  voxTenantId: text("vox_tenant_id").notNull().default("default"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EmailAgentConfig = typeof emailAgentConfigTable.$inferSelect;
export type EmailAgentConfigInput = Omit<EmailAgentConfig, "id" | "createdAt" | "updatedAt">;
