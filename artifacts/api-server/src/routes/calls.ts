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
import { composeSystemPrompt } from "../lib/persona-composer.js";

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
  const calls = await db
    .select()
    .from(callsTable)
    .where(where)
    .orderBy(desc(callsTable.createdAt))
    .limit(limit)
    .offset(offset);

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

export default router;
