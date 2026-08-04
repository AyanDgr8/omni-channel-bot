import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const emailAgentConfigTable = pgTable("email_agent_config", {
  id: text("id").primaryKey().default("default"),
  tenantId: text("tenant_id").notNull().default(""),
  clientId: text("client_id").notNull().default(""),
  clientSecret: text("client_secret").notNull().default(""),
  userEmail: text("user_email").notNull().default(""),
  isEnabled: boolean("is_enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EmailAgentConfig = typeof emailAgentConfigTable.$inferSelect;
export type EmailAgentConfigInput = Omit<EmailAgentConfig, "id" | "createdAt" | "updatedAt">;
