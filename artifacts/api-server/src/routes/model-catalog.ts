/**
 * Model Catalog — vendor model catalogue.
 *
 * Authorization model:
 *  - GET  /v1/model-catalog          → any authenticated tenant user (read-only)
 *  - POST /v1/model-catalog          → BLOCKED for tenant users (403); catalogue
 *    mutations affect the global shared catalogue used by every tenant, so only
 *    platform operators may add/modify entries (via migration or direct DB).
 *  - PATCH /v1/model-catalog/:id     → BLOCKED for tenant users (403); same reason.
 *
 * If per-tenant custom model entries are needed in the future, add a tenantId
 * column to model_catalog and scope reads/writes accordingly.
 */
import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db, modelCatalogTable } from "@workspace/db";

const router: IRouter = Router();

// ─── List ─────────────────────────────────────────────────────────────────────
// GET /v1/model-catalog?kind=LLM&vendor=openai&deprecated=false

router.get("/v1/model-catalog", async (req, res): Promise<void> => {
  const { kind, vendor, deprecated } = req.query as Record<string, string | undefined>;

  let rows = await db.select().from(modelCatalogTable);

  if (kind) rows = rows.filter((r) => r.kind === kind);
  if (vendor) rows = rows.filter((r) => r.vendor === vendor);
  if (deprecated === "false") rows = rows.filter((r) => !r.deprecated);

  // Sort: non-deprecated first, then by vendor+kind+tier
  rows.sort((a, b) => {
    if (a.deprecated !== b.deprecated) return a.deprecated ? 1 : -1;
    if (a.vendor !== b.vendor) return a.vendor.localeCompare(b.vendor);
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.displayName.localeCompare(b.displayName);
  });

  res.json(rows);
});

// ─── Create custom entry (platform-admin only) ────────────────────────────────
// Blocked for all tenant users: the catalogue is global and mutations affect
// every tenant. Add new models via SQL migration (lib/db/src/migrations/).

const CreateModelCatalogBody = z.object({
  vendor: z.string().min(1),
  kind: z.enum(["LLM", "STT", "TTS"]),
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  tier: z.enum(["lite", "standard", "premium"]).default("standard"),
  contextWindow: z.number().int().positive().optional().nullable(),
  costPerUnit: z.string().optional().nullable(),
  deprecated: z.boolean().default(false),
});

router.post(
  "/v1/model-catalog",
  async (req, res): Promise<void> => {
    // All requests arrive with a tenantId (set by auth middleware). Catalogue
    // mutations are platform-admin-only and not exposed to tenant users.
    res.status(403).json({
      error: "Model catalogue mutations are not available to tenant users. " +
        "Add new models via SQL migration or contact the platform operator.",
    });
  }
);

// ─── Deprecate entry (platform-admin only) ────────────────────────────────────

router.patch(
  "/v1/model-catalog/:id",
  async (req, res): Promise<void> => {
    // Same restriction as POST: mutating the global catalogue is platform-admin-only.
    res.status(403).json({
      error: "Model catalogue mutations are not available to tenant users. " +
        "Deprecate models via SQL migration or contact the platform operator.",
    });
  }
);

export default router;
