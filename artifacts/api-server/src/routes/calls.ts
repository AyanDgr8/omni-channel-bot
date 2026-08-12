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

const router: IRouter = Router();

router.get("/v1/calls", async (req, res): Promise<void> => {
  const params = ListCallsQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 50) : 50;
  const offset = params.success ? (params.data.offset ?? 0) : 0;

  const conditions = [];
  if (params.success && params.data.direction) {
    conditions.push(eq(callsTable.direction, params.data.direction));
  }
  if (params.success && params.data.hangupReason) {
    conditions.push(eq(callsTable.hangupReason, params.data.hangupReason));
  }
  if (params.success && params.data.botId) {
    conditions.push(eq(callsTable.botId, params.data.botId));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
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
    const personas = await db
      .select({ id: personasTable.id, name: personasTable.name })
      .from(personasTable)
      .where(eq(personasTable.id, personaIds[0]));
    // Fetch all matching personas
    const allPersonas = await db.select({ id: personasTable.id, name: personasTable.name }).from(personasTable);
    for (const p of allPersonas) {
      if (personaIds.includes(p.id)) personaMap[p.id] = p.name;
    }
    void personas; // suppress unused warning
  }

  const calls = rawCalls.map((c) => ({
    ...c,
    personaName: c.personaId ? (personaMap[c.personaId] ?? null) : null,
  }));

  const totalResult = await db.select().from(callsTable).where(where);
  res.json(ListCallsResponse.parse({ calls, total: totalResult.length }));
});

router.post("/v1/calls/dial", async (req, res): Promise<void> => {
  const parsed = DialCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, parsed.data.botId));
  if (!bot) {
    res.status(400).json({ error: "Bot not found" });
    return;
  }

  // Fetch active persona and compose system prompt for call stamping
  let activePersonaId: string | null = null;
  let activeComposedPrompt: string | null = null;
  try {
    const [activePersona] = await db
      .select()
      .from(personasTable)
      .where(eq(personasTable.isActive, true))
      .limit(1);
    if (activePersona) {
      const [traitsRow] = await db
        .select()
        .from(personaTraitsTable)
        .where(eq(personaTraitsTable.personaId, activePersona.id))
        .orderBy(desc(personaTraitsTable.version))
        .limit(1);
      if (traitsRow) {
        activePersonaId = activePersona.id;
        activeComposedPrompt = composeSystemPrompt(traitsRow.traits);
      }
    }
  } catch {
    // Non-fatal: proceed without persona stamping
  }

  const callId = randomUUID();
  const [call] = await db
    .insert(callsTable)
    .values({
      id: callId,
      botId: parsed.data.botId,
      direction: "OUTBOUND",
      status: "INITIATING",
      customerNumber: parsed.data.to,
      startedAt: new Date(),
      followUpSent: false,
      personaId: activePersonaId,
      composedPrompt: activeComposedPrompt,
    })
    .returning();

  await db.update(botsTable).set({ status: "BUSY", activeCalls: bot.activeCalls + 1 }).where(eq(botsTable.id, bot.id));

  // Run call-connect simulation asynchronously using the bot's direction config
  setTimeout(async () => {
    try {
      const botConfig = await loadBotCallConfig(parsed.data.botId);
      const hangupReasonMap: Record<string, string> = {
        COMPLETED: "BOT_HUNGUP",
        VOICEMAIL_LEFT: "VOICEMAIL_LEFT",
        AMD_HANGUP: "NO_ANSWER",
        NO_RESPONSE: "NO_ANSWER",
        FAILED: "FAILED",
        TRANSFERRED: "TRANSFERRED",
        LANGUAGE_UNSUPPORTED: "BOT_HUNGUP",
      };

      if (botConfig) {
        const result = await runCallConnectSimulation(callId, botConfig, bot.displayName);
        const dur = 30 + Math.floor(Math.random() * 180);
        await db
          .update(callsTable)
          .set({
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
          })
          .where(eq(callsTable.id, callId));
      } else {
        // Fallback if bot config not found
        const dur = 30 + Math.floor(Math.random() * 180);
        await db
          .update(callsTable)
          .set({
            status: "COMPLETED",
            hangupReason: "BOT_HUNGUP",
            amdResult: "HUMAN",
            durationSeconds: dur,
            endedAt: new Date(),
            connectOutcome: "HUMAN",
            interruptionCount: 0,
            escalationCount: 0,
            finalDisposition: "COMPLETED",
          })
          .where(eq(callsTable.id, callId));
      }
    } catch (err) {
      console.error("Call simulation error:", err);
    }

    const currentBot = await db.select().from(botsTable).where(eq(botsTable.id, parsed.data.botId));
    if (currentBot[0]) {
      await db
        .update(botsTable)
        .set({ status: "ONLINE", activeCalls: Math.max(0, currentBot[0].activeCalls - 1) })
        .where(eq(botsTable.id, parsed.data.botId));
    }
  }, 4000 + Math.floor(Math.random() * 3000));

  res.status(201).json(GetCallResponse.parse(call));
});

/**
 * POST /v1/calls/inbound
 * Webhook handler for incoming calls. Stamps the active persona at call-start
 * time, exactly as the outbound dial handler does.
 *
 * Expected body: { from: string, botId: string, to?: string }
 */
router.post("/v1/calls/inbound", async (req, res): Promise<void> => {
  const bodySchema = z.object({
    from:  z.string().min(1),
    botId: z.string().min(1),
    to:    z.string().optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, parsed.data.botId));
  if (!bot) {
    res.status(400).json({ error: "Bot not found" });
    return;
  }

  // Fetch active persona and compose system prompt — same logic as outbound
  let activePersonaId: string | null = null;
  let activeComposedPrompt: string | null = null;
  try {
    const [activePersona] = await db
      .select()
      .from(personasTable)
      .where(eq(personasTable.isActive, true))
      .limit(1);
    if (activePersona) {
      const [traitsRow] = await db
        .select()
        .from(personaTraitsTable)
        .where(eq(personaTraitsTable.personaId, activePersona.id))
        .orderBy(desc(personaTraitsTable.version))
        .limit(1);
      if (traitsRow) {
        activePersonaId = activePersona.id;
        activeComposedPrompt = composeSystemPrompt(traitsRow.traits);
      }
    }
  } catch {
    // Non-fatal: proceed without persona stamping
  }

  const callId = randomUUID();
  const [call] = await db
    .insert(callsTable)
    .values({
      id: callId,
      botId: parsed.data.botId,
      direction: "INBOUND",
      status: "IN_PROGRESS",
      customerNumber: parsed.data.from,
      startedAt: new Date(),
      followUpSent: false,
      personaId: activePersonaId,
      composedPrompt: activeComposedPrompt,
    })
    .returning();

  await db
    .update(botsTable)
    .set({ status: "BUSY", activeCalls: bot.activeCalls + 1 })
    .where(eq(botsTable.id, bot.id));

  // Run call simulation asynchronously
  setTimeout(async () => {
    try {
      const botConfig = await loadBotCallConfig(parsed.data.botId);
      const hangupReasonMap: Record<string, string> = {
        COMPLETED: "BOT_HUNGUP",
        VOICEMAIL_LEFT: "VOICEMAIL_LEFT",
        AMD_HANGUP: "NO_ANSWER",
        NO_RESPONSE: "NO_ANSWER",
        FAILED: "FAILED",
        TRANSFERRED: "TRANSFERRED",
        LANGUAGE_UNSUPPORTED: "BOT_HUNGUP",
      };

      if (botConfig) {
        const result = await runCallConnectSimulation(callId, botConfig, bot.displayName);
        const dur = 30 + Math.floor(Math.random() * 180);
        await db
          .update(callsTable)
          .set({
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
            summary:
              result.outcome === "HUMAN"
                ? `Inbound call completed. Greeted in ${result.greetingLanguage}. ${result.interruptionCount} barge-in(s) detected.${result.escalationCount > 0 ? " Escalation triggered." : ""}`
                : `Inbound call ended: ${result.outcome}.`,
          })
          .where(eq(callsTable.id, callId));
      } else {
        const dur = 30 + Math.floor(Math.random() * 180);
        await db
          .update(callsTable)
          .set({
            status: "COMPLETED",
            hangupReason: "BOT_HUNGUP",
            amdResult: "HUMAN",
            durationSeconds: dur,
            endedAt: new Date(),
            connectOutcome: "HUMAN",
            interruptionCount: 0,
            escalationCount: 0,
            finalDisposition: "COMPLETED",
          })
          .where(eq(callsTable.id, callId));
      }
    } catch (err) {
      console.error("Inbound call simulation error:", err);
    }

    const currentBot = await db.select().from(botsTable).where(eq(botsTable.id, parsed.data.botId));
    if (currentBot[0]) {
      await db
        .update(botsTable)
        .set({ status: "ONLINE", activeCalls: Math.max(0, currentBot[0].activeCalls - 1) })
        .where(eq(botsTable.id, parsed.data.botId));
    }
  }, 4000 + Math.floor(Math.random() * 3000));

  res.status(201).json(GetCallResponse.parse(call));
});

router.get("/v1/calls/:id", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(GetCallResponse.parse(call));
});

router.delete("/v1/calls/:id", async (req, res): Promise<void> => {
  const params = HangupCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [call] = await db
    .update(callsTable)
    .set({ status: "COMPLETED", hangupReason: "BOT_HUNGUP", endedAt: new Date() })
    .where(eq(callsTable.id, params.data.id))
    .returning();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(GetCallResponse.parse(call));
});

router.post("/v1/calls/:id/transfer", async (req, res): Promise<void> => {
  const params = TransferCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = TransferCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const target = parsed.data.extension ?? parsed.data.e164 ?? parsed.data.agentName ?? "unknown";
  const [call] = await db
    .update(callsTable)
    .set({ status: "COMPLETED", hangupReason: "TRANSFERRED", transferTarget: target, endedAt: new Date() })
    .where(eq(callsTable.id, params.data.id))
    .returning();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(GetCallResponse.parse(call));
});

router.post("/v1/calls/:id/conference", async (req, res): Promise<void> => {
  const params = ConferenceCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ConferenceCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(GetCallResponse.parse(call));
});

// ─── Task #17: Inbound call receive endpoint ────────────────────────────────
// Webhook handler: creates an inbound call record stamped with the active persona.
// Even when no active persona exists, the call is accepted — personaId is simply null.
router.post("/v1/calls/receive", async (req, res): Promise<void> => {
  const { from, botId } = req.body as { from?: string; botId?: string };
  if (!botId) { res.status(400).json({ error: "botId is required" }); return; }

  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, botId));
  if (!bot) { res.status(400).json({ error: "Bot not found" }); return; }

  let activePersonaId: string | null = null;
  let activePersonaName: string | null = null;
  let activeComposedPrompt: string | null = null;

  try {
    const [activePersona] = await db
      .select()
      .from(personasTable)
      .where(eq(personasTable.isActive, true))
      .limit(1);
    if (activePersona) {
      const [traitsRow] = await db
        .select()
        .from(personaTraitsTable)
        .where(eq(personaTraitsTable.personaId, activePersona.id))
        .orderBy(desc(personaTraitsTable.version))
        .limit(1);
      if (traitsRow) {
        // Task #11/13: only stamp persona if identity fields are valid
        const validation = validatePersonaForVoiceBot(traitsRow.traits);
        if (validation.valid) {
          activePersonaId = activePersona.id;
          activePersonaName = activePersona.name;
          activeComposedPrompt = composeSystemPrompt(traitsRow.traits);
        } else {
          console.warn(`[inbound] Active persona "${activePersona.name}" has invalid identity fields — not stamped on call. Issues: ${validation.issues.join("; ")}`);
        }
      }
    }
  } catch (err) {
    console.error("[inbound] Failed to fetch active persona:", err);
    // Non-fatal: proceed without persona stamping
  }

  const callId = randomUUID();
  const [call] = await db
    .insert(callsTable)
    .values({
      id: callId,
      botId,
      direction: "INBOUND",
      status: "RINGING",
      customerNumber: from ?? null,
      startedAt: new Date(),
      followUpSent: false,
      personaId: activePersonaId,
      composedPrompt: activeComposedPrompt,
    })
    .returning();

  await db
    .update(botsTable)
    .set({ status: "BUSY", activeCalls: bot.activeCalls + 1 })
    .where(eq(botsTable.id, bot.id));

  res.status(201).json({ ...call, personaName: activePersonaName });
});

export default router;
