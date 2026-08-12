import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, botsTable, personasTable, personaTraitsTable } from "@workspace/db";
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
import { requireRole } from "../middleware/require-role";
import { auditMiddleware } from "../middleware/audit";

const router: IRouter = Router();

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
  const [bot] = await db
    .insert(botsTable)
    .values({
      id: randomUUID(),
      ...parsed.data,
      status: "OFFLINE",
      activeCalls: 0,
      tenantId: req.tenantId!,
    })
    .returning();
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

  const [bot] = await db
    .update(botsTable)
    .set(parsed.data)
    .where(and(eq(botsTable.id, params.data.id), eq(botsTable.tenantId, req.tenantId!)))
    .returning();
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json(GetBotResponse.parse(bot));
});

// ─── Delete ───────────────────────────────────────────────────────────────────

router.delete("/v1/bots/:id", requireRole("ADMIN"), auditMiddleware("bot"), async (req, res): Promise<void> => {
  const params = DeleteBotParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [bot] = await db
    .delete(botsTable)
    .where(and(eq(botsTable.id, params.data.id), eq(botsTable.tenantId, req.tenantId!)))
    .returning();
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

    const [bot] = await db
      .select()
      .from(botsTable)
      .where(and(eq(botsTable.id, botId), eq(botsTable.tenantId, req.tenantId!)));
    if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }

    const [persona] = await db
      .select()
      .from(personasTable)
      .where(and(eq(personasTable.id, personaId), eq(personasTable.tenantId, req.tenantId!)));
    if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

    // PE-03/PE-18: validate identity fields before assignment
    const [traitsRow] = await db
      .select()
      .from(personaTraitsTable)
      .where(eq(personaTraitsTable.personaId, personaId))
      .orderBy(desc(personaTraitsTable.version))
      .limit(1);

    if (traitsRow) {
      const validation = validatePersonaForVoiceBot(traitsRow.traits);
      if (!validation.valid) {
        res.status(422).json({
          error: "Cannot assign a persona with incomplete identity fields to a bot.",
          issues: validation.issues,
        });
        return;
      }
    }

    // Assign the persona to the bot
    const [updatedBot] = await db
      .update(botsTable)
      .set({ activePersonaId: personaId as string })
      .where(and(eq(botsTable.id, botId), eq(botsTable.tenantId, req.tenantId!)))
      .returning();

    // Option A: also set is_active on the persona (UI convenience flag, tenant-scoped)
    await db
      .update(personasTable)
      .set({ isActive: false })
      .where(eq(personasTable.tenantId, req.tenantId!));
    await db
      .update(personasTable)
      .set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(personasTable.id, personaId as string), eq(personasTable.tenantId, req.tenantId!)));

    res.json({ bot: updatedBot, personaId, assigned: true });
  }
);

// ─── Unassign persona from bot ────────────────────────────────────────────────

router.delete(
  "/v1/bots/:botId/personas",
  requireRole("ADMIN"),
  auditMiddleware("bot"),
  async (req, res): Promise<void> => {
    const botId = req.params.botId as string;
    const [bot] = await db
      .select()
      .from(botsTable)
      .where(and(eq(botsTable.id, botId), eq(botsTable.tenantId, req.tenantId!)));
    if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }

    const [updatedBot] = await db
      .update(botsTable)
      .set({ activePersonaId: null })
      .where(and(eq(botsTable.id, botId), eq(botsTable.tenantId, req.tenantId!)))
      .returning();

    res.json({ bot: updatedBot, assigned: false });
  }
);

export default router;
