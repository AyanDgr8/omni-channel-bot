import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  botsTable,
  callsTable,
  complianceDecisionsTable,
  complianceMediaEventsTable,
  consentLedgerTable,
  db,
  personasTable,
  personaTraitsTable,
} from "@workspace/db";
import {
  ConferenceCallBody,
  ConferenceCallParams,
  DialCallBody,
  GetCallParams,
  GetCallResponse,
  HangupCallParams,
  ListCallsQueryParams,
  ListCallsResponse,
  TransferCallBody,
  TransferCallParams,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";
import { z } from "zod";
import { evaluateCompliance } from "../lib/compliance-gate.js";
import { loadBotCallConfig, runCallConnectSimulation } from "../lib/call-connect-service.js";
import { logger } from "../lib/logger.js";
import { composeSystemPrompt, validatePersonaForVoiceBot } from "../lib/persona-composer.js";
import { requireRole } from "../middleware/require-role.js";
import { submitOutboundCall } from "../lib/outbound-transport.js";
import { selectOne } from "../lib/db-returning.js";

const router: IRouter = Router();

export async function resolvePersona(bot: typeof botsTable.$inferSelect, tenantId: string) {
  const personaId = bot.activePersonaId;
  const findTraits = async (id: string) => db.select().from(personaTraitsTable)
    .where(eq(personaTraitsTable.personaId, id)).orderBy(desc(personaTraitsTable.version)).limit(1);
  try {
    const [assigned] = personaId
      ? await db.select().from(personasTable).where(and(eq(personasTable.id, personaId), eq(personasTable.tenantId, tenantId))).limit(1)
      : [];
    const [fallback] = assigned ? [] : await db.select().from(personasTable)
      .where(and(eq(personasTable.tenantId, tenantId), eq(personasTable.isActive, true))).limit(1);
    const persona = assigned ?? fallback;
    if (!persona) return { personaId: null, personaName: null, personaVersion: null, composedPrompt: null };
    const [traits] = await findTraits(persona.id);
    if (!traits || !validatePersonaForVoiceBot(traits.traits).valid) {
      return { personaId: null, personaName: null, personaVersion: null, composedPrompt: null };
    }
    return {
      personaId: persona.id,
      personaName: persona.name,
      personaVersion: traits.version,
      composedPrompt: composeSystemPrompt(traits.traits),
    };
  } catch (error) {
    logger.warn({ error }, "Unable to resolve persona for call");
    return { personaId: null, personaName: null, personaVersion: null, composedPrompt: null };
  }
}

async function createCall(values: typeof callsTable.$inferInsert, decisionId?: string) {
  return db.transaction(async (tx) => {
    // MySQL has no RETURNING. Every caller supplies the id, so the inserted row
    // is read back by primary key inside the same transaction.
    await tx.insert(callsTable).values(values);
    const [call] = await tx.select().from(callsTable).where(eq(callsTable.id, values.id)).limit(1);
    if (decisionId) {
      await tx.update(complianceDecisionsTable).set({ callId: call.id }).where(and(
        eq(complianceDecisionsTable.id, decisionId),
        eq(complianceDecisionsTable.tenantId, values.tenantId),
      ));
    }
    return call;
  });
}

function simulateCompletion(
  callId: string,
  botId: string,
  botName: string,
  disclosure: string | null,
  onFinished?: (result: { disposition: string; outcome: string }) => Promise<void>,
) {
  setTimeout(async () => {
    try {
      const config = await loadBotCallConfig(botId);
      const result = config ? await runCallConnectSimulation(callId, config, botName, disclosure) : null;
      const hangup: Record<string, string> = {
        COMPLETED: "BOT_HUNGUP", VOICEMAIL_LEFT: "VOICEMAIL_LEFT", AMD_HANGUP: "NO_ANSWER",
        NO_RESPONSE: "NO_ANSWER", FAILED: "FAILED", TRANSFERRED: "TRANSFERRED",
      };
      await db.update(callsTable).set(result ? {
        status: "COMPLETED",
        hangupReason: hangup[result.disposition] ?? "BOT_HUNGUP",
        amdResult: result.amdResult ?? result.outcome,
        languageDetected: result.greetingLanguage,
        durationSeconds: 30 + Math.floor(Math.random() * 180),
        endedAt: new Date(),
        connectOutcome: result.outcome,
        interruptionCount: result.interruptionCount,
        escalationCount: result.escalationCount,
        languageSwitches: result.languageSwitches.length ? result.languageSwitches : null,
        finalDisposition: result.disposition,
        summary: `Call ended: ${result.outcome}.`,
      } : {
        status: "COMPLETED", hangupReason: "BOT_HUNGUP", amdResult: "HUMAN",
        durationSeconds: 30, endedAt: new Date(), connectOutcome: "HUMAN", finalDisposition: "COMPLETED",
      }).where(eq(callsTable.id, callId));
      if (onFinished) await onFinished(result ?? { disposition: "COMPLETED", outcome: "HUMAN" });
    } catch (error) {
      logger.error({ error, callId }, "Call simulation error");
    } finally {
      const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, botId));
      if (bot) await db.update(botsTable).set({
        status: "ONLINE", activeCalls: Math.max(0, bot.activeCalls - 1),
      }).where(eq(botsTable.id, botId));
    }
  }, 4000 + Math.floor(Math.random() * 3000));
}

/** Starts a campaign job through the same auditable outbound lifecycle as a direct dial. */
export async function startCampaignOutboundCall(input: {
  tenantId: string; botId: string; phoneNumber: string;
  compliance: Awaited<ReturnType<typeof evaluateCompliance>>;
  campaignContext?: string;
  onFinished: (result: { disposition: string; outcome: string }, callId: string) => Promise<void>;
}) {
  const [bot] = await db.select().from(botsTable).where(and(eq(botsTable.id, input.botId), eq(botsTable.tenantId, input.tenantId)));
  if (!bot) throw new Error("Campaign bot not found");
  const persona = await resolvePersona(bot, input.tenantId);
  const call = await createCall({
    id: randomUUID(), botId: bot.id, direction: "OUTBOUND", status: "INITIATING",
    customerNumber: input.compliance.normalizedPhone, startedAt: new Date(), followUpSent: false,
    ...persona, disclosureText: input.compliance.disclosureText,
    recordingConsentStatus: input.compliance.recordingConsentRequired ? "PENDING" : "NOT_REQUIRED",
    complianceDecisionId: input.compliance.decisionId, tenantId: input.tenantId, summary: input.campaignContext ?? null,
  }, input.compliance.decisionId);
  await db.update(botsTable).set({ status: "BUSY", activeCalls: bot.activeCalls + 1 }).where(and(eq(botsTable.id, bot.id), eq(botsTable.tenantId, input.tenantId)));
  let transport: "webrtc" | "sip";
  try {
    transport = await submitOutboundCall(bot.id, input.tenantId, call.id, input.compliance.normalizedPhone);
  } catch (error) {
    await db.transaction(async (tx) => {
      await tx.update(complianceDecisionsTable).set({ callId: null }).where(and(eq(complianceDecisionsTable.callId, call.id), eq(complianceDecisionsTable.tenantId, input.tenantId)));
      await tx.delete(callsTable).where(and(eq(callsTable.id, call.id), eq(callsTable.tenantId, input.tenantId)));
      await tx.update(botsTable).set({ status: bot.activeCalls ? "BUSY" : "ONLINE", activeCalls: bot.activeCalls })
        .where(and(eq(botsTable.id, bot.id), eq(botsTable.tenantId, input.tenantId)));
    });
    throw error;
  }
  if (transport === "webrtc") simulateCompletion(call.id, bot.id, bot.displayName, input.compliance.disclosureText, async (result) => input.onFinished(result, call.id));
  return call;
}

router.get("/v1/calls", async (req, res) => {
  const parsed = ListCallsQueryParams.safeParse(req.query);
  const query = parsed.success ? parsed.data : { limit: 50, offset: 0 };
  const conditions = [eq(callsTable.tenantId, req.tenantId!)];
  if (query.direction) conditions.push(eq(callsTable.direction, query.direction));
  if (query.hangupReason) conditions.push(eq(callsTable.hangupReason, query.hangupReason));
  if (query.botId) conditions.push(eq(callsTable.botId, query.botId));
  const where = and(...conditions);
  const calls = await db.select().from(callsTable).where(where).orderBy(desc(callsTable.createdAt))
    .limit(query.limit).offset(query.offset);
  const total = await db.select({ id: callsTable.id }).from(callsTable).where(where);
  res.json(ListCallsResponse.parse({ calls, total: total.length }));
});

async function dialOutbound(req: import("express").Request, res: import("express").Response): Promise<void> {
  const body = DialCallBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [bot] = await db.select().from(botsTable).where(and(
    eq(botsTable.id, body.data.botId), eq(botsTable.tenantId, req.tenantId!),
  ));
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  let compliance;
  try {
    compliance = await evaluateCompliance({ tenantId: req.tenantId!, botId: bot.id, phoneNumber: body.data.to, direction: "OUTBOUND", botTimezone: bot.timezone });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to evaluate compliance" }); return;
  }
  if (!compliance.allowed) {
    res.status(409).json({ error: compliance.reason, decision: compliance.decision, reasonCode: compliance.reasonCode, complianceDecisionId: compliance.decisionId }); return;
  }
  const persona = await resolvePersona(bot, req.tenantId!);
  const call = await createCall({
    id: randomUUID(), botId: bot.id, direction: "OUTBOUND", status: "INITIATING",
    customerNumber: compliance.normalizedPhone, startedAt: new Date(), followUpSent: false,
    ...persona, disclosureText: compliance.disclosureText,
    recordingConsentStatus: compliance.recordingConsentRequired ? "PENDING" : "NOT_REQUIRED",
    complianceDecisionId: compliance.decisionId, tenantId: req.tenantId!,
  }, compliance.decisionId);
  await db.update(botsTable).set({ status: "BUSY", activeCalls: bot.activeCalls + 1 }).where(and(eq(botsTable.id, bot.id), eq(botsTable.tenantId, req.tenantId!)));
  try {
    const transport = await submitOutboundCall(bot.id, req.tenantId!, call.id, compliance.normalizedPhone);
    if (transport === "webrtc") simulateCompletion(call.id, bot.id, bot.displayName, compliance.disclosureText);
  } catch (error) {
    await db.transaction(async (tx) => {
      await tx.update(complianceDecisionsTable).set({ callId: null }).where(and(eq(complianceDecisionsTable.callId, call.id), eq(complianceDecisionsTable.tenantId, req.tenantId!)));
      await tx.delete(callsTable).where(and(eq(callsTable.id, call.id), eq(callsTable.tenantId, req.tenantId!)));
      await tx.update(botsTable).set({ status: bot.activeCalls ? "BUSY" : "ONLINE", activeCalls: bot.activeCalls })
        .where(and(eq(botsTable.id, bot.id), eq(botsTable.tenantId, req.tenantId!)));
    });
    res.status(502).json({ error: error instanceof Error ? error.message : "Unable to submit outbound call" });
    return;
  }
  res.status(201).json(GetCallResponse.parse(call));
}
router.post("/v1/calls/dial", requireRole("SUPERVISOR"), dialOutbound);
router.post("/v1/calls/outbound", requireRole("SUPERVISOR"), dialOutbound);

router.post("/v1/calls/inbound", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const body = z.object({ from: z.string().min(1), botId: z.string().min(1) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [bot] = await db.select().from(botsTable).where(and(eq(botsTable.id, body.data.botId), eq(botsTable.tenantId, req.tenantId!)));
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  const compliance = await evaluateCompliance({ tenantId: req.tenantId!, botId: bot.id, phoneNumber: body.data.from, direction: "INBOUND", botTimezone: bot.timezone });
  const persona = await resolvePersona(bot, req.tenantId!);
  const call = await createCall({
    id: randomUUID(), botId: bot.id, direction: "INBOUND", status: "IN_PROGRESS",
    customerNumber: compliance.normalizedPhone, startedAt: new Date(), followUpSent: false,
    ...persona, disclosureText: compliance.disclosureText,
    recordingConsentStatus: compliance.recordingConsentRequired ? "PENDING" : "NOT_REQUIRED",
    complianceDecisionId: compliance.decisionId, tenantId: req.tenantId!,
  }, compliance.decisionId);
  await db.update(botsTable).set({ status: "BUSY", activeCalls: bot.activeCalls + 1 }).where(eq(botsTable.id, bot.id));
  simulateCompletion(call.id, bot.id, bot.displayName, compliance.disclosureText);
  res.status(201).json(GetCallResponse.parse(call));
});

router.post("/v1/calls/receive", async (req, res): Promise<void> => {
  const body = z.object({ from: z.string().optional(), botId: z.string().min(1) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [bot] = await db.select().from(botsTable).where(and(eq(botsTable.id, body.data.botId), eq(botsTable.tenantId, req.tenantId!)));
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  const compliance = body.data.from
    ? await evaluateCompliance({ tenantId: req.tenantId!, botId: bot.id, phoneNumber: body.data.from, direction: "INBOUND", botTimezone: bot.timezone })
    : null;
  const persona = await resolvePersona(bot, req.tenantId!);
  const call = await createCall({
    id: randomUUID(), botId: bot.id, direction: "INBOUND", status: "RINGING",
    customerNumber: compliance?.normalizedPhone ?? null, startedAt: new Date(), followUpSent: false,
    ...persona, disclosureText: compliance?.disclosureText ?? null,
    recordingConsentStatus: compliance?.recordingConsentRequired ? "PENDING" : "NOT_REQUIRED",
    complianceDecisionId: compliance?.decisionId ?? null, tenantId: req.tenantId!,
  }, compliance?.decisionId);
  res.status(201).json(GetCallResponse.parse(call));
});

router.get("/v1/calls/:id", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [call] = await db.select().from(callsTable).where(and(eq(callsTable.id, params.data.id), eq(callsTable.tenantId, req.tenantId!)));
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }
  res.json(GetCallResponse.parse(call));
});

router.post("/v1/calls/:id/media-events", async (req, res): Promise<void> => {
  const body = z.object({
    event: z.enum(["DISCLOSURE_PLAYED", "RECORDING_CONSENT_GRANTED", "RECORDING_CONSENT_DECLINED"]),
    evidence: z.string().min(1).max(2000), occurredAt: z.coerce.date().optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const id = req.params.id;
  const [existing] = await db.select().from(callsTable).where(and(eq(callsTable.id, id), eq(callsTable.tenantId, req.tenantId!)));
  if (!existing) { res.status(404).json({ error: "Call not found" }); return; }
  const occurredAt = body.data.occurredAt ?? new Date();
  const disclosure = body.data.event === "DISCLOSURE_PLAYED";
  if ((disclosure && (!existing.disclosureText || existing.disclosurePlayedAt)) ||
    (!disclosure && (existing.recordingConsentStatus !== "PENDING" || (existing.disclosureText && !existing.disclosurePlayedAt)))) {
    res.status(409).json({ error: "Media event conflicts with the call's current compliance state" }); return;
  }
  const update = disclosure ? { disclosurePlayedAt: occurredAt } : {
    recordingConsentStatus: body.data.event === "RECORDING_CONSENT_GRANTED" ? "GRANTED" : "DECLINED", recordingConsentAt: occurredAt,
  };
  const call = await db.transaction(async (tx) => {
    // The guarded UPDATE is the concurrency control: `affectedRows` is 0 when
    // the call no longer matches the expected compliance state, which is how a
    // conflicting or duplicate media event is rejected.
    const guarded = await tx.update(callsTable).set(update).where(and(
      eq(callsTable.id, id), eq(callsTable.tenantId, req.tenantId!),
      inArray(callsTable.status, ["INITIATING", "RINGING", "IN_PROGRESS"]),
      disclosure ? and(isNull(callsTable.disclosurePlayedAt), isNotNull(callsTable.disclosureText)) : eq(callsTable.recordingConsentStatus, "PENDING"),
    ));
    if (guarded[0].affectedRows === 0) return null;
    const [updated] = await tx.select().from(callsTable).where(eq(callsTable.id, id)).limit(1);
    await tx.insert(complianceMediaEventsTable).values({ id: randomUUID(), tenantId: req.tenantId!, callId: id, eventType: body.data.event, evidence: body.data.evidence, occurredAt });
    if (!disclosure && existing.customerNumber) await tx.insert(consentLedgerTable).values({
      id: randomUUID(), tenantId: req.tenantId!, phoneNumber: existing.customerNumber, consentType: "RECORDING",
      status: body.data.event === "RECORDING_CONSENT_GRANTED" ? "GRANTED" : "REVOKED",
      source: "telephony_media", evidence: body.data.evidence, actorUserId: null, capturedAt: occurredAt,
    });
    return updated;
  });
  if (!call) { res.status(409).json({ error: "Media event conflicts with the call's current compliance state" }); return; }
  res.json(GetCallResponse.parse(call));
});

router.delete("/v1/calls/:id", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const params = HangupCallParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  // MySQL has no RETURNING: update, then read the row back. A call that does
  // not exist updates nothing and reads back as undefined, giving the 404.
  const hangupScope = and(eq(callsTable.id, params.data.id), eq(callsTable.tenantId, req.tenantId!));
  await db.update(callsTable).set({ status: "COMPLETED", hangupReason: "BOT_HUNGUP", endedAt: new Date() }).where(hangupScope);
  const call = await selectOne(callsTable, hangupScope);
  res.json(GetCallResponse.parse(call));
});

router.post("/v1/calls/:id/transfer", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const params = TransferCallParams.safeParse(req.params); const body = TransferCallBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid transfer request" }); return; }
  const target = body.data.extension ?? body.data.e164 ?? body.data.agentName ?? "unknown";
  const transferScope = and(eq(callsTable.id, params.data.id), eq(callsTable.tenantId, req.tenantId!));
  await db.update(callsTable).set({ status: "COMPLETED", hangupReason: "TRANSFERRED", transferTarget: target, endedAt: new Date() }).where(transferScope);
  const call = await selectOne(callsTable, transferScope);
  res.json(GetCallResponse.parse(call));
});

router.post("/v1/calls/:id/conference", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const params = ConferenceCallParams.safeParse(req.params); const body = ConferenceCallBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid conference request" }); return; }
  const [call] = await db.select().from(callsTable).where(and(eq(callsTable.id, params.data.id), eq(callsTable.tenantId, req.tenantId!)));
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }
  res.json(GetCallResponse.parse(call));
});

export default router;