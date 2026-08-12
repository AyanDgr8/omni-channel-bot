import { pgTable, text, boolean, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Vendor model catalogue — read-only seed data plus any custom entries added via admin API.
 * New models are added as DATA rows, never as code changes (FR-TECH-01).
 */
export const modelCatalogTable = pgTable(
  "model_catalog",
  {
    id: text("id").primaryKey(),

    /** Matches providers.vendor */
    vendor: text("vendor").notNull(),

    /** LLM | STT | TTS */
    kind: text("kind").notNull(),

    /** The actual API model identifier (e.g. "gpt-4o", "nova-2", "aura-asteria-en") */
    modelId: text("model_id").notNull(),

    displayName: text("display_name").notNull(),

    /** lite | standard | premium */
    tier: text("tier").notNull().default("standard"),

    /** Token context window (LLM only) */
    contextWindow: integer("context_window"),

    /** Human-readable cost string, e.g. "$0.15/1M tokens in" */
    costPerUnit: text("cost_per_unit"),

    deprecated: boolean("deprecated").notNull().default(false),
  },
  (t) => ({
    vendorKindModelUniq: unique("model_catalog_vendor_kind_model_id_key").on(t.vendor, t.kind, t.modelId),
  })
);

export const insertModelCatalogSchema = createInsertSchema(modelCatalogTable);
export type InsertModelCatalog = z.infer<typeof insertModelCatalogSchema>;
export type ModelCatalog = typeof modelCatalogTable.$inferSelect;
