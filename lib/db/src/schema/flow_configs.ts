import { mysqlTable, varchar, text, json, timestamp } from "drizzle-orm/mysql-core";

export const flowConfigsTable = mysqlTable("flow_configs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  /** MySQL forbids literal DEFAULTs on JSON columns — default applied in JS. */
  definition: json("definition")
    .$type<{ nodes: unknown[]; edges: unknown[] }>()
    .notNull()
    .$defaultFn(() => ({ nodes: [], edges: [] })),
  /** VoxAgent organisation this flow belongs to */
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type FlowConfig = typeof flowConfigsTable.$inferSelect;
