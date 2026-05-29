import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const flowConfigsTable = pgTable("flow_configs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  definition: jsonb("definition").notNull().default({ nodes: [], edges: [] }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FlowConfig = typeof flowConfigsTable.$inferSelect;
