import { mysqlTable, varchar, text, boolean, int, unique } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Vendor model catalogue — read-only seed data plus any custom entries added via admin API.
 * New models are added as DATA rows, never as code changes (FR-TECH-01).
 */
export const modelCatalogTable = mysqlTable(
  "model_catalog",
  {
    id: varchar("id", { length: 64 }).primaryKey(),

    /** Matches providers.vendor */
    vendor: varchar("vendor", { length: 64 }).notNull(),

    /** LLM | STT | TTS */
    kind: varchar("kind", { length: 16 }).notNull(),

    /** The actual API model identifier (e.g. "gpt-4o", "nova-2", "aura-asteria-en") */
    modelId: varchar("model_id", { length: 128 }).notNull(),

    displayName: varchar("display_name", { length: 255 }).notNull(),

    /** lite | standard | premium */
    tier: varchar("tier", { length: 32 }).notNull().default("standard"),

    /** Token context window (LLM only) */
    contextWindow: int("context_window"),

    /** Human-readable cost string, e.g. "$0.15/1M tokens in" */
    costPerUnit: text("cost_per_unit"),

    deprecated: boolean("deprecated").notNull().default(false),
  },
  (t) => [
    unique("model_catalog_vendor_kind_model_id_key").on(t.vendor, t.kind, t.modelId),
  ]
);

export const insertModelCatalogSchema = createInsertSchema(modelCatalogTable);
export type InsertModelCatalog = z.infer<typeof insertModelCatalogSchema>;
export type ModelCatalog = typeof modelCatalogTable.$inferSelect;
