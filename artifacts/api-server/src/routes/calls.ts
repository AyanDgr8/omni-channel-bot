import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, callsTable, botsTable, personasTable, personaTraitsTable } from "@workspace/db";
import { runCallConnectSimulation, loadBotCallConfig } from "../lib/call-connect-service.js";
import {
  ListCallsResponse,
  GetCallResponse,
  GetCallParams,
  HangupCallParams,
  TransferCallParams,
  ConferenceCallParams,
  DialCallBody,
  TransferCallBody,
  ConferenceCallBody,
  ListCallsQueryParams,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";
import { z } from "zod";
import { composeSystemPrompt, validatePersonaForVoiceBot } from "../lib/persona-composer.js";
import { selectOne } from "../lib/db-returning.js";
import { requireRole } from "../middleware/require-role.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ─── Helper: resolve persona for a bot (per-bot first, then global isActive) ─
async function resolvePersonaForBot(bot: typeof botsTable.$inferSelect, tenantId: string) {
  let personaId: string | null = null;
  let composedPrompt: string | null = null;

  try {
    // Option A: try the bot's explicitly assigned persona first
    if (bot.activePersonaId) {
      const [assigned] = await db
        .select()
        .from(personasTable)
        .where(and(eq(personasTable.id, bot.activePersonaId), eq(personasTable.tenantId, tenantId)))
        .limit(1);
      if (assigned) {
        const [traitsRow] = await db
          .select()
          .from(personaTraitsTable)
          .where(eq(personaTraitsTable.personaId, assigned.id))
          .orderBy(desc(personaTraitsTable.version))
          .limit(1);
        if (traitsRow) {
          personaId = assigned.id;
          composedPrompt = composeSystemPrompt(traitsRow.traits);
        }
      }
    }

    // Fallback to global isActive (UI-level convenience flag)
    if (!personaId) {
      const [activePersona] = await db
        .select()
        .from(personasTable)
        .where(and(eq(personasTable.isActive, true), eq(personasTable.tenantId, tenantId)))
        .limit(1);
      if (activePersona) {
        const [traitsRow] = await db
          .select()
          .from(personaTraitsTable)
          .where(eq(personaTraitsTable.personaId, activePersona.id))
          .orderBy(desc(personaTraitsTable.version))
          .limit(1);
        if (traitsRow) {
          personaId = activePersona.id;
          composedPrompt = composeSystemPrompt(traitsRow.traits);
        }
      }
    }
  } catch {
    // Non-fatal: proceed without persona stamping
  }

  return { personaId, composedPrompt };
}

// ─── List calls ───────────────────────────────────────────────────────────────

router.get("/v1/calls", async (req, res): Promise<void> => {
  const params = ListCallsQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 50) : 50;
  const offset = params.success ? (params.data.offset ?? 0) : 0;

  const conditions: ReturnType<typeof eq>[] = [eq(callsTable.tenantId, req.tenantId!)];
  if (params.success && params.data.direction) conditions.push(eq(callsTable.direction, params.data.direction));
  if (params.success && params.data.hangupReason) conditions.push(eq(callsTable.hangupReason, params.data.hangupReason));
  if (params.success && params.data.botId) conditions.push(eq(callsTable.botId, params.data.botId));

  const where = and(...conditions);
  const rawCalls = await db
    .select()
    .from(callsTable)
    .where(where)
    .orderBy(desc(callsTable.createdAt))
    .limit(limit)
    .offset(offset);

  // Enrich with persona names via secondary lookup
  const personaIds = [...new Set(rawCalls.map((c) => c.personaId).filter(Boolean))] as string[];
  const personaMap: Record<string, string> = {};
  if (personaIds.length > 0) {
    const allPersonas = await db
      .select({ id: personasTable.id, name: personasTable.name })
      .from(personasTable)
      .where(eq(personasTable.tenantId, req.tenantId!));
    for (const p of allPersonas) {
      if (personaIds.includes(p.id)) personaMap[p.id] = p.name;
    }
  }

  const calls = rawCalls.map((c) => ({
    ...c,
    personaName: c.personaId ? (personaMap[c.personaId] ?? null) : null,
  }));

  const totalResult = await db.select().from(callsTable).where(where);
  res.json(ListCallsResponse.parse({ calls, total: totalResult.length }));
});

// ─── Dial (outbound) ─────────────────────────────────────────────────────────

router.post("/v1/calls/dial", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const parsed = DialCallBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [bot] = await db
    .select()
    .from(botsTable)
    .where(and(eq(botsTable.id, parsed.data.botId), eq(botsTable.tenantId, req.tenantId!)));
  if (!bot) { res.status(400).json({ error: "Bot not found" }); return; }

  const { personaId: activePersonaId, composedPrompt: activeComposedPrompt } =
    await resolvePersonaForBot(bot, req.tenantId!);

  const callId = randomUUID();
  await db.insert(callsTable).values({
    id: callId,
    botId: parsed.data.botId,
    direction: "OUTBOUND",
    status: "INITIATING",
    customerNumber: parsed.data.to,
    startedAt: new Date(),
    followUpSent: false,
    personaId: activePersonaId,
    composedPrompt: activeComposedPrompt,
    tenantId: req.tenantId!,
  });
  const call = await selectOne(callsTable, eq(callsTable.id, callId));

  await db.update(botsTable).set({ status: "BUSY", activeCalls: bot.activeCalls + 1 }).where(eq(botsTable.id, bot.id));

  // Run call-connect simulation asynchronously using the bot's direction config
  setTimeout(async () => {
    try {
      const botConfig = await loadBotCallConfig(parsed.data.botId);
      const hangupReasonMap: Record<string, string> = {
        COMPLETED: "BOT_HUNGUP", VOICEMAIL_LEFT: "VOICEMAIL_LEFT", AMD_HANGUP: "NO_ANSWER",
        NO_RESPONSE: "NO_ANSWER", FAILED: "FAILED", TRANSFERRED: "TRANSFERRED", LANGUAGE_UNSUPPORTED: "BOT_HUNGUP",
      };
      if (botConfig) {
        const result = await runCallConnectSimulation(callId, botConfig, bot.displayName);
        const dur = 30 + Math.floor(Math.random() * 180);
        await db.update(callsTable).set({
          status: "COMPLETED",
          hangupReason: hangupReasonMap[result.disposition] ?? "BOT_HUNGUP",
          amdResult: result.amdResult ?? (result.outcome === "HUMAN" ? "HUMAN" : result.outcome),
          languageDetected: result.greetingLanguage,
          durationSeconds: dur,
          endedAt: new Date(),
          connectOutcome: result.outcome,
          interruptionCount: result.interruptionCount,
          escalationCount: result.escalationCount,
          languageSwitches: result.languageSwitches.length > 0 ? result.languageSwitches : null,
          finalDisposition: result.disposition,
          summary: result.outcome === "HUMAN"
            ? `Call completed. Greeted in ${result.greetingLanguage}. ${result.interruptionCount} barge-in(s) detected.${result.escalationCount > 0 ? " Escalation triggered." : ""}`
            : result.outcome === "ANSWERING_MACHINE"
              ? `Voicemail detected — ${result.disposition === "VOICEMAIL_LEFT" ? "left a voicemail message" : "hung up"}.`
              : `Call ended: ${result.outcome}.`,
        }).where(eq(callsTable.id, callId));
      } else {
        const dur = 30 + Math.floor(Math.random() * 180);
        await db.update(callsTable).set({
          status: "COMPLETED", hangupReason: "BOT_HUNGUP", amdResult: "HUMAN",
          durationSeconds: dur, endedAt: new Date(), connectOutcome: "HUMAN",
          interruptionCount: 0, escalationCount: 0, finalDisposition: "COMPLETED",
        }).where(eq(callsTable.id, callId));
      }
    } catch (err) { logger.error({ err }, "Call simulation error"); }
    const [currentBot] = await db.select().from(botsTable).where(eq(botsTable.id, parsed.data.botId));
    if (currentBot) {
      await db.update(botsTable).set({ status: "ONLINE", activeCalls: Math.max(0, currentBot.activeCalls - 1) }).where(eq(botsTable.id, parsed.data.botId));
    }
  }, 4000 + Math.floor(Math.random() * 3000));

  res.status(201).json(GetCallResponse.parse(call));
});

// ─── Inbound call (internal webhook from bot platform) ───────────────────────

router.post("/v1/calls/inbound", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const bodySchema = z.object({ from: z.string().min(1), botId: z.string().min(1), to: z.string().optional() });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [bot] = await db
    .select()
    .from(botsTable)
    .where(and(eq(botsTable.id, parsed.data.botId), eq(botsTable.tenantId, req.tenantId!)));
  if (!bot) { res.status(400).json({ error: "Bot not found" }); return; }

  const { personaId: activePersonaId, composedPrompt: activeComposedPrompt } =
    await resolvePersonaForBot(bot, req.tenantId!);

  const callId = randomUUID();
  await db.insert(callsTable).values({
    id: callId,
    botId: parsed.data.botId,
    direction: "INBOUND",
    status: "IN_PROGRESS",
    customerNumber: parsed.data.from,
    startedAt: new Date(),
    followUpSent: false,
    personaId: activePersonaId,
    composedPrompt: activeComposedPrompt,
    tenantId: req.tenantId!,
  });
  const call = await selectOne(callsTable, eq(callsTable.id, callId));

  await db.update(botsTable).set({ status: "BUSY", activeCalls: bot.activeCalls + 1 }).where(eq(botsTable.id, bot.id));

  setTimeout(async () => {
    try {
      const botConfig = await loadBotCallConfig(parsed.data.botId);
      const hangupReasonMap: Record<string, string> = {
        COMPLETED: "BOT_HUNGUP", VOICEMAIL_LEFT: "VOICEMAIL_LEFT", AMD_HANGUP: "NO_ANSWER",
        NO_RESPONSE: "NO_ANSWER", FAILED: "FAILED", TRANSFERRED: "TRANSFERRED", LANGUAGE_UNSUPPORTED: "BOT_HUNGUP",
      };
      if (botConfig) {
        const result = await runCallConnectSimulation(callId, botConfig, bot.displayName);
        const dur = 30 + Math.floor(Math.random() * 180);
        await db.update(callsTable).set({
          status: "COMPLETED",
          hangupReason: hangupReasonMap[result.disposition] ?? "BOT_HUNGUP",
          amdResult: result.amdResult ?? (result.outcome === "HUMAN" ? "HUMAN" : result.outcome),
          languageDetected: result.greetingLanguage,
          durationSeconds: dur,
          endedAt: new Date(),
          connectOutcome: result.outcome,
          interruptionCount: result.interruptionCount,
          escalationCount: result.escalationCount,
          languageSwitches: result.languageSwitches.length > 0 ? result.languageSwitches : null,
          finalDisposition: result.disposition,
          summary: result.outcome === "HUMAN"
            ? `Inbound call completed. Greeted in ${result.greetingLanguage}. ${result.interruptionCount} barge-in(s) detected.${result.escalationCount > 0 ? " Escalation triggered." : ""}`
            : `Inbound call ended: ${result.outcome}.`,
        }).where(eq(callsTable.id, callId));
      } else {
        const dur = 30 + Math.floor(Math.random() * 180);
        await db.update(callsTable).set({
          status: "COMPLETED", hangupReason: "BOT_HUNGUP", amdResult: "HUMAN",
          durationSeconds: dur, endedAt: new Date(), connectOutcome: "HUMAN",
          interruptionCount: 0, escalationCount: 0, finalDisposition: "COMPLETED",
        }).where(eq(callsTable.id, callId));
      }
    } catch (err) { logger.error({ err }, "Inbound call simulation error"); }
    const [currentBot] = await db.select().from(botsTable).where(eq(botsTable.id, parsed.data.botId));
    if (currentBot) {
      await db.update(botsTable).set({ status: "ONLINE", activeCalls: Math.max(0, currentBot.activeCalls - 1) }).where(eq(botsTable.id, parsed.data.botId));
    }
  }, 4000 + Math.floor(Math.random() * 3000));

  res.status(201).json(GetCallResponse.parse(call));
});

// ─── Telephony webhook receiver (PE-19 stamping + webhook auth) ──────────────
// Authentication is handled by tenantScope middleware (X-Webhook-Secret + DID).

router.post("/v1/calls/receive", async (req, res): Promise<void> => {
  const { from, botId } = req.body as { from?: string; botId?: string };
  if (!botId) { res.status(400).json({ error: "botId is required" }); return; }

  const [bot] = await db
    .select()
    .from(botsTable)
    .where(and(eq(botsTable.id, botId), eq(botsTable.tenantId, req.tenantId!)));
  if (!bot) { res.status(400).json({ error: "Bot not found" }); return; }

  let activePersonaId: string | null = null;
  let activePersonaName: string | null = null;
  let activeComposedPrompt: string | null = null;

  try {
    // Try bot's assigned persona first
    if (bot.activePersonaId) {
      const [assigned] = await db
        .select()
        .from(personasTable)
        .where(and(eq(personasTable.id, bot.activePersonaId), eq(personasTable.tenantId, req.tenantId!)))
        .limit(1);
      if (assigned) {
        const [traitsRow] = await db
          .select()
          .from(personaTraitsTable)
          .where(eq(personaTraitsTable.personaId, assigned.id))
          .orderBy(desc(personaTraitsTable.version))
          .limit(1);
        if (traitsRow) {
          const validation = validatePersonaForVoiceBot(traitsRow.traits);
          if (validation.valid) {
            activePersonaId = assigned.id;
            activePersonaName = assigned.name;
            activeComposedPrompt = composeSystemPrompt(traitsRow.traits);
          }
        }
      }
    }

    // Fallback: global isActive persona
    if (!activePersonaId) {
      const [activePersona] = await db
        .select()
        .from(personasTable)
        .where(and(eq(personasTable.isActive, true), eq(personasTable.tenantId, req.tenantId!)))
        .limit(1);
      if (activePersona) {
        const [traitsRow] = await db
          .select()
          .from(personaTraitsTable)
          .where(eq(personaTraitsTable.personaId, activePersona.id))
          .orderBy(desc(personaTraitsTable.version))
          .limit(1);
        if (traitsRow) {
          const validation = validatePersonaForVoiceBot(traitsRow.traits);
          if (validation.valid) {
            activePersonaId = activePersona.id;
            activePersonaName = activePersona.name;
            activeComposedPrompt = composeSystemPrompt(traitsRow.traits);
          } else {
            logger.warn({ personaId: activePersona.id, issues: validation.issues }, "Active persona has invalid identity fields — not stamped on inbound call");
          }
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to fetch active persona for inbound call");
  }

  const callId = randomUUID();
  await db.insert(callsTable).values({
    id: callId,
    botId,
    direction: "INBOUND",
    status: "RINGING",
    customerNumber: from ?? null,
    startedAt: new Date(),
    followUpSent: false,
    personaId: activePersonaId,
    composedPrompt: activeComposedPrompt,
    tenantId: req.tenantId!,
  });
  const call = await selectOne(callsTable, eq(callsTable.id, callId));

  await db.update(botsTable).set({ status: "BUSY", activeCalls: bot.activeCalls + 1 }).where(eq(botsTable.id, bot.id));

  res.status(201).json({ ...call, personaName: activePersonaName });
});

// ─── Get call detail ──────────────────────────────────────────────────────────

router.get("/v1/calls/:id", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [call] = await db
    .select()
    .from(callsTable)
    .where(and(eq(callsTable.id, params.data.id), eq(callsTable.tenantId, req.tenantId!)));
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }
  res.json(GetCallResponse.parse(call));
});

// ─── Hangup / end call ────────────────────────────────────────────────────────

router.delete("/v1/calls/:id", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const params = HangupCallParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const scope = and(eq(callsTable.id, params.data.id), eq(callsTable.tenantId, req.tenantId!));
  await db
    .update(callsTable)
    .set({ status: "COMPLETED", hangupReason: "BOT_HUNGUP", endedAt: new Date() })
    .where(scope);
  const call = await selectOne(callsTable, scope);
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }
  res.json(GetCallResponse.parse(call));
});

// ─── Transfer call ────────────────────────────────────────────────────────────

router.post("/v1/calls/:id/transfer", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const params = TransferCallParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = TransferCallBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const target = parsed.data.extension ?? parsed.data.e164 ?? parsed.data.agentName ?? "unknown";
  const scope = and(eq(callsTable.id, params.data.id), eq(callsTable.tenantId, req.tenantId!));
  await db
    .update(callsTable)
    .set({ status: "COMPLETED", hangupReason: "TRANSFERRED", transferTarget: target, endedAt: new Date() })
    .where(scope);
  const call = await selectOne(callsTable, scope);
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }
  res.json(GetCallResponse.parse(call));
});

// ─── Conference call ──────────────────────────────────────────────────────────

router.post("/v1/calls/:id/conference", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const params = ConferenceCallParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = ConferenceCallBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [call] = await db
    .select()
    .from(callsTable)
    .where(and(eq(callsTable.id, params.data.id), eq(callsTable.tenantId, req.tenantId!)));
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }
  res.json(GetCallResponse.parse(call));
});

export default router;
