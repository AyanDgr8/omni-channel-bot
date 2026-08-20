import { Router, type IRouter } from "express";
import { eq, and, or, isNull } from "drizzle-orm";
import { db, botsTable, personasTable, personaTraitsTable, providersTable, modelCatalogTable } from "@workspace/db";
import {
  ListBotsResponse,
  GetBotResponse,
  GetBotParams,
  CreateBotBody,
  UpdateBotBody,
  UpdateBotParams,
  DeleteBotParams,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";
import { desc } from "drizzle-orm";
import { validatePersonaForVoiceBot } from "../lib/persona-composer";
import { selectOne } from "../lib/db-returning.js";
import { requireRole } from "../middleware/require-role";
import { auditMiddleware } from "../middleware/audit";
import type { LlmChainEntry, SttMapEntry, TtsMapEntry } from "../lib/provider-registry";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Engine config validation ─────────────────────────────────────────────────

/**
 * Validate llmChainJson / sttMapJson / ttsMapJson bot engine config.
 *
 * Security contract (FR-TECH-09 / tenant isolation):
 * Every referenced provider_id must:
 *  (a) belong to the requesting tenant OR be platform-pooled (tenantId IS NULL)
 *  (b) be enabled
 *  (c) be of the correct kind (LLM / STT / TTS)
 * Every referenced model_id must exist in the model_catalog for that vendor+kind.
 *
 * Returns an error string on first violation, or null if valid.
 */
async function validateEngineConfig(
  tenantId: string,
  llmChainJson: unknown,
  sttMapJson: unknown,
  ttsMapJson: unknown,
): Promise<string | null> {
  // ── LLM chain ────────────────────────────────────────────────────────────────
  if (llmChainJson !== null && llmChainJson !== undefined) {
    if (!Array.isArray(llmChainJson)) return "llmChainJson must be an array";
    for (const entry of llmChainJson as unknown[]) {
      if (typeof entry !== "object" || entry === null) return "llmChainJson entries must be objects";
      const { provider_id, model_id } = entry as Record<string, unknown>;
      if (typeof provider_id !== "string" || !provider_id) return "llmChainJson entries must have a string provider_id";
      if (typeof model_id !== "string" || !model_id)         return "llmChainJson entries must have a string model_id";

      const [prov] = await db.select({ id: providersTable.id, vendor: providersTable.vendor }).from(providersTable)
        .where(and(
          eq(providersTable.id, provider_id),
          or(eq(providersTable.tenantId, tenantId), isNull(providersTable.tenantId)),
          eq(providersTable.enabled, true),
          eq(providersTable.kind, "LLM"),
        )).limit(1);
      if (!prov) return `Provider "${provider_id}" not found, disabled, wrong kind, or not accessible by this tenant`;

      const [model] = await db.select({ modelId: modelCatalogTable.modelId }).from(modelCatalogTable)
        .where(and(
          eq(modelCatalogTable.vendor, prov.vendor),
          eq(modelCatalogTable.kind, "LLM"),
          eq(modelCatalogTable.modelId, model_id),
        )).limit(1);
      if (!model) return `Model "${model_id}" not found in catalogue for vendor "${prov.vendor}" (LLM)`;
    }
  }

  // ── STT map ──────────────────────────────────────────────────────────────────
  if (sttMapJson !== null && sttMapJson !== undefined) {
    if (typeof sttMapJson !== "object" || Array.isArray(sttMapJson))
      return "sttMapJson must be an object (language → {provider_id, model_id})";
    for (const [lang, entry] of Object.entries(sttMapJson as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) return `sttMapJson["${lang}"] must be an object`;
      const { provider_id, model_id } = entry as Record<string, unknown>;
      if (typeof provider_id !== "string" || !provider_id) return `sttMapJson["${lang}"].provider_id must be a string`;
      if (typeof model_id !== "string" || !model_id)         return `sttMapJson["${lang}"].model_id must be a string`;

      const [prov] = await db.select({ id: providersTable.id, vendor: providersTable.vendor }).from(providersTable)
        .where(and(
          eq(providersTable.id, provider_id),
          or(eq(providersTable.tenantId, tenantId), isNull(providersTable.tenantId)),
          eq(providersTable.enabled, true),
          eq(providersTable.kind, "STT"),
        )).limit(1);
      if (!prov) return `STT provider "${provider_id}" not found, disabled, wrong kind, or not accessible by this tenant`;

      const [model] = await db.select({ modelId: modelCatalogTable.modelId }).from(modelCatalogTable)
        .where(and(
          eq(modelCatalogTable.vendor, prov.vendor),
          eq(modelCatalogTable.kind, "STT"),
          eq(modelCatalogTable.modelId, model_id),
        )).limit(1);
      if (!model) return `STT model "${model_id}" not found in catalogue for vendor "${prov.vendor}"`;
    }
  }

  // ── TTS map ──────────────────────────────────────────────────────────────────
  if (ttsMapJson !== null && ttsMapJson !== undefined) {
    if (typeof ttsMapJson !== "object" || Array.isArray(ttsMapJson))
      return "ttsMapJson must be an object (language → {provider_id, model_id, voice?})";
    for (const [lang, entry] of Object.entries(ttsMapJson as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) return `ttsMapJson["${lang}"] must be an object`;
      const { provider_id, model_id } = entry as Record<string, unknown>;
      if (typeof provider_id !== "string" || !provider_id) return `ttsMapJson["${lang}"].provider_id must be a string`;
      if (typeof model_id !== "string" || !model_id)         return `ttsMapJson["${lang}"].model_id must be a string`;

      const [prov] = await db.select({ id: providersTable.id, vendor: providersTable.vendor }).from(providersTable)
        .where(and(
          eq(providersTable.id, provider_id),
          or(eq(providersTable.tenantId, tenantId), isNull(providersTable.tenantId)),
          eq(providersTable.enabled, true),
          eq(providersTable.kind, "TTS"),
        )).limit(1);
      if (!prov) return `TTS provider "${provider_id}" not found, disabled, wrong kind, or not accessible by this tenant`;

      const [model] = await db.select({ modelId: modelCatalogTable.modelId }).from(modelCatalogTable)
        .where(and(
          eq(modelCatalogTable.vendor, prov.vendor),
          eq(modelCatalogTable.kind, "TTS"),
          eq(modelCatalogTable.modelId, model_id),
        )).limit(1);
      if (!model) return `TTS model "${model_id}" not found in catalogue for vendor "${prov.vendor}"`;
    }
  }

  return null;
}

// ─── List ─────────────────────────────────────────────────────────────────────

router.get("/v1/bots", async (req, res): Promise<void> => {
  const bots = await db
    .select()
    .from(botsTable)
    .where(eq(botsTable.tenantId, req.tenantId!))
    .orderBy(botsTable.createdAt);
  res.json(ListBotsResponse.parse(bots));
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post("/v1/bots", requireRole("ADMIN"), auditMiddleware("bot"), async (req, res): Promise<void> => {
  const parsed = CreateBotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const validationError = await validateEngineConfig(
    req.tenantId!,
    parsed.data.llmChainJson ?? null,
    parsed.data.sttMapJson ?? null,
    parsed.data.ttsMapJson ?? null,
  );
  if (validationError) {
    res.status(400).json({ error: `Engine config validation failed: ${validationError}` });
    return;
  }

  const id = randomUUID();
  await db.insert(botsTable).values({
    id,
    ...parsed.data,
    status: "OFFLINE",
    activeCalls: 0,
    tenantId: req.tenantId!,
  });
  const bot = await selectOne(botsTable, eq(botsTable.id, id));
  res.status(201).json(GetBotResponse.parse(bot));
});

// ─── Get single ───────────────────────────────────────────────────────────────

router.get("/v1/bots/:id", async (req, res): Promise<void> => {
  const params = GetBotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [bot] = await db
    .select()
    .from(botsTable)
    .where(and(eq(botsTable.id, params.data.id), eq(botsTable.tenantId, req.tenantId!)));
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json(GetBotResponse.parse(bot));
});

// ─── Update ───────────────────────────────────────────────────────────────────

router.patch("/v1/bots/:id", requireRole("ADMIN"), auditMiddleware("bot"), async (req, res): Promise<void> => {
  const params = UpdateBotParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateBotBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Only validate engine config if any of the three fields are being updated
  if (
    parsed.data.llmChainJson !== undefined ||
    parsed.data.sttMapJson !== undefined ||
    parsed.data.ttsMapJson !== undefined
  ) {
    const validationError = await validateEngineConfig(
      req.tenantId!,
      parsed.data.llmChainJson ?? null,
      parsed.data.sttMapJson ?? null,
      parsed.data.ttsMapJson ?? null,
    );
    if (validationError) {
      res.status(400).json({ error: `Engine config validation failed: ${validationError}` });
      return;
    }
  }

  const scope = and(eq(botsTable.id, params.data.id), eq(botsTable.tenantId, req.tenantId!));
  await db.update(botsTable).set(parsed.data).where(scope);
  const bot = await selectOne(botsTable, scope);
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json(GetBotResponse.parse(bot));
});

// ─── Delete ───────────────────────────────────────────────────────────────────

router.delete("/v1/bots/:id", requireRole("ADMIN"), auditMiddleware("bot"), async (req, res): Promise<void> => {
  const params = DeleteBotParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  // MySQL has no DELETE ... RETURNING — read the row first, then remove it.
  const scope = and(eq(botsTable.id, params.data.id), eq(botsTable.tenantId, req.tenantId!));
  const bot = await selectOne(botsTable, scope);
  if (bot) await db.delete(botsTable).where(scope);
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.sendStatus(204);
});

// ─── Assign persona to bot (PE-02 replacement) ────────────────────────────────
// POST /v1/bots/:botId/personas/:personaId/assign
// Validates identity fields (PE-03/PE-18), then sets bots.active_persona_id.
// Also sets personas.is_active = true as a UI-level convenience (Option A).

router.post(
  "/v1/bots/:botId/personas/:personaId/assign",
  requireRole("ADMIN"),
  auditMiddleware("bot"),
  async (req, res): Promise<void> => {
    const { botId, personaId } = req.params as { botId: string; personaId: string };

    // 1. Load bot (tenant-scoped)
    const [bot] = await db
      .select()
      .from(botsTable)
      .where(and(eq(botsTable.id, botId), eq(botsTable.tenantId, req.tenantId!)));
    if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }

    // 2. Load persona (tenant-scoped)
    const [persona] = await db
      .select()
      .from(personasTable)
      .where(and(eq(personasTable.id, personaId), eq(personasTable.tenantId, req.tenantId!)));
    if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

    // 3. Load latest traits (PE-18: must exist and be valid before bot can use them)
    const [traitsRow] = await db
      .select()
      .from(personaTraitsTable)
      .where(eq(personaTraitsTable.personaId, personaId))
      .orderBy(desc(personaTraitsTable.version))
      .limit(1);
    if (!traitsRow) {
      res.status(422).json({ error: "Persona has no generated traits — generate traits before assigning to a bot" });
      return;
    }

    // 4. PE-03 / PE-18: validate that required identity fields are populated
    const validation = validatePersonaForVoiceBot(traitsRow.traits);
    if (!validation.valid) {
      res.status(422).json({
        error: "Persona identity fields are incomplete — bot cannot use this persona",
        details: validation.issues,
      });
      return;
    }

    // 5. Assign
    const scope = and(eq(botsTable.id, botId), eq(botsTable.tenantId, req.tenantId!));
    await db.update(botsTable).set({ activePersonaId: personaId }).where(scope);
    const updatedBot = await selectOne(botsTable, scope);

    // 6. Update personas.is_active for UI convenience (Option A)
    await db
      .update(personasTable)
      .set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(personasTable.id, personaId), eq(personasTable.tenantId, req.tenantId!)));

    res.json({ bot: updatedBot, persona: { id: persona.id, name: persona.name } });
  }
);

// ─── Unassign persona from bot ────────────────────────────────────────────────

router.delete(
  "/v1/bots/:botId/personas",
  requireRole("ADMIN"),
  auditMiddleware("bot"),
  async (req, res): Promise<void> => {
    const { botId } = req.params as { botId: string };
    const [bot] = await db
      .select()
      .from(botsTable)
      .where(and(eq(botsTable.id, botId), eq(botsTable.tenantId, req.tenantId!)));
    if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }

    const scope = and(eq(botsTable.id, botId), eq(botsTable.tenantId, req.tenantId!));
    await db.update(botsTable).set({ activePersonaId: null }).where(scope);
    const updatedBot = await selectOne(botsTable, scope);

    res.json({ bot: updatedBot, assigned: false });
  }
);

export default router;
