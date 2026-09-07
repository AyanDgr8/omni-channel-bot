import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";
import { botsTable, callbacksTable, callsTable, campaignContactsTable, campaignsTable, complianceDecisionsTable, complianceMediaEventsTable, db, dispositionsTable, insertSipEvent, sipConfigsTable, sipEventsTable, sipWorkerSessionsTable } from "@workspace/db";
import { auditMiddleware } from "../middleware/audit.js";
import { requireRole } from "../middleware/require-role.js";
import { decryptSipPassword, encryptSipPassword } from "../lib/sip-credential-crypto.js";
import { controlFreeSwitch, FreeSwitchWorkerUnavailableError, sendFreeSwitchDtmf, workerHealth } from "../lib/freeswitch-worker.js";
import { buildMediaSession } from "../lib/media-session.js";
import { inboundSessionResponseSchema, workerCallStateSchema, workerEventTypeSchema } from "../lib/freeswitch-protocol.js";
import { dispatchDtmfToSession } from "../lib/dtmf-session-dispatch.js";
import { submitSipTestCall } from "../lib/outbound-transport.js";
import { evaluateCompliance } from "../lib/compliance-gate.js";
import { resolvePersona } from "./calls-router.js";
import { selectOne } from "../lib/db-returning.js";

const router: IRouter = Router();
const did = z.string().regex(/^\+[1-9][0-9]{7,14}$/);
const inboundDid = z.string().regex(/^(\+[1-9][0-9]{7,14}|\+[1-9][0-9]{0,14}\*)$/);
const sipInput = z.object({
  enabled: z.boolean().optional(),
  sipDomain: z.string().max(253).nullable().optional(),
  registrarHost: z.string().min(1).max(253),
  registrarPort: z.number().int().min(1).max(65535).optional(),
  transport: z.enum(["udp", "tcp", "tls", "wss"]).optional(),
  extension: z.string().min(1).max(64),
  authUsername: z.string().min(1).max(128),
  password: z.string().max(1024).optional(),
  displayName: z.string().max(128).nullable().optional(),
  callerIdNumber: z.string().max(64).nullable().optional(),
  outboundProxyHost: z.string().max(253).nullable().optional(),
  outboundProxyPort: z.number().int().min(1).max(65535).nullable().optional(),
  registerExpirySeconds: z.number().int().min(60).max(86400).optional(),
  keepaliveIntervalSeconds: z.number().int().min(1).max(86400).optional(),
  codecs: z.array(z.enum(["PCMU", "PCMA", "G722", "OPUS"])).min(1).optional(),
  dtmfMode: z.enum(["rfc2833", "sip_info", "inband"]).optional(),
  srtpMode: z.enum(["disabled", "optional", "required"]).optional(),
  rtpPortMin: z.number().int().min(1).max(65535).optional(),
  rtpPortMax: z.number().int().min(1).max(65535).optional(),
  ptimeMs: z.number().int().min(1).max(1000).optional(),
  natTraversal: z.enum(["none", "stun", "force_rport"]).optional(),
  stunServer: z.string().max(253).nullable().optional(),
  localBindIp: z.string().max(64).nullable().optional(),
  externalIp: z.string().max(64).nullable().optional(),
  maxConcurrentCalls: z.number().int().min(1).max(10000).optional(),
  inboundDids: z.array(inboundDid).optional(),
  answerDelayMs: z.number().int().min(0).max(120000).optional(),
  recordCalls: z.boolean().optional(),
  outboundEnabled: z.boolean().optional(),
  outboundPrefix: z.string().max(32).nullable().optional(),
  allowSelfSigned: z.boolean().optional(),
  debugLogging: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.rtpPortMin !== undefined && value.rtpPortMin % 2) ctx.addIssue({ code: "custom", path: ["rtpPortMin"], message: "RTP ports must be even" });
  if (value.rtpPortMax !== undefined && value.rtpPortMax % 2) ctx.addIssue({ code: "custom", path: ["rtpPortMax"], message: "RTP ports must be even" });
  if (value.rtpPortMin !== undefined && value.rtpPortMax !== undefined && value.rtpPortMax - value.rtpPortMin < 100) ctx.addIssue({ code: "custom", path: ["rtpPortMax"], message: "RTP range must be at least 100 ports wide" });
  if (value.allowSelfSigned && value.transport !== undefined && value.transport !== "tls" && value.transport !== "wss") ctx.addIssue({ code: "custom", path: ["allowSelfSigned"], message: "allowSelfSigned is only valid with TLS or WSS transport" });
});
const callbackBody = z.object({
  tenantId: z.string().min(1), botId: z.string().min(1), eventId: z.string().optional(),
  registrationState: z.enum(["unregistered", "registering", "registered", "failed"]).optional(),
  activeCalls: z.number().int().min(0).optional(), lastError: z.string().max(2000).nullable().optional(),
  callId: z.string().optional(), callState: workerCallStateSchema.optional(),
  eventType: workerEventTypeSchema.optional(),
  freeswitchUuid: z.string().optional(), dtmfDigit: z.string().regex(/^[0-9A-D#*]$/).optional(),
  disposition: z.string().max(64).optional(), sipCode: z.number().int().min(100).max(699).optional(),
  mediaEvent: z.enum(["DISCLOSURE_PLAYED", "RECORDING_CONSENT_GRANTED", "RECORDING_CONSENT_DECLINED"]).optional(),
  evidence: z.string().max(2000).optional(),
  event: z.object({ level: z.enum(["debug", "info", "warn", "error"]), summary: z.string().min(1).max(2000), direction: z.enum(["inbound", "outbound"]).optional(), methodResponse: z.string().max(100).optional(), rawSnippet: z.string().max(4000).optional() }).optional(),
});
const attempts = new Map<string, { count: number; reset: number }>();
function redactSip(value: string | undefined): string | undefined {
  return value?.replace(/(authorization\s*:\s*(?:digest|bearer)?\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/(password\s*[=:]\s*)[^\s;,&]+/gi, "$1[REDACTED]")
    .replace(/(a=crypto|m=audio|v=0)[\s\S]*/gi, "[SDP REDACTED]");
}
function workerAuthorized(req: import("express").Request): boolean {
  const expected = process.env.FREESWITCH_WORKER_CALLBACK_SECRET;
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(expected && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected)));
}
function actionRateLimit(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  const key = `${req.tenantId}:${req.params.id}:${req.path}`;
  const now = Date.now(), item = attempts.get(key);
  if (!item || item.reset <= now) { attempts.set(key, { count: 1, reset: now + 60_000 }); next(); return; }
  if (item.count >= 10) { res.status(429).json({ error: "Too many SIP actions; retry shortly" }); return; }
  item.count++; next();
}
function publicConfig(config: typeof sipConfigsTable.$inferSelect) {
  const { passwordEncrypted: _passwordEncrypted, tenantId: _tenantId, debug, ...output } = config;
  return { ...output, debugLogging: debug, passwordIsSet: Boolean(config.passwordEncrypted), passwordMasked: config.passwordEncrypted ? "••••••••" : null };
}
function workerConfig(config: typeof sipConfigsTable.$inferSelect) {
  const { passwordEncrypted, ...safe } = config;
  return { ...safe, password: passwordEncrypted ? decryptSipPassword(passwordEncrypted) : null };
}
async function durableSessionConfig(bot: typeof botsTable.$inferSelect, callId: string, freeswitchUuid: string) {
  return inboundSessionResponseSchema.parse({ accepted: true, callId, freeswitchUuid, ...await buildMediaSession(bot.tenantId, bot.id, callId) });
}
async function botForTenant(id: string, tenantId: string) {
  const [bot] = await db.select().from(botsTable).where(and(eq(botsTable.id, id), eq(botsTable.tenantId, tenantId))).limit(1);
  return bot;
}
async function configForTenant(botId: string, tenantId: string) {
  const [config] = await db.select().from(sipConfigsTable).where(and(eq(sipConfigsTable.botId, botId), eq(sipConfigsTable.tenantId, tenantId))).limit(1);
  return config;
}

router.get("/v1/sip/health", async (_req, res) => res.json(await workerHealth()));
router.get("/v1/bots/:id/sip", async (req, res) => {
  if (!await botForTenant(req.params.id, req.tenantId!)) return void res.status(404).json({ error: "Bot not found" });
  const config = await configForTenant(req.params.id, req.tenantId!);
  if (!config) return void res.json(null); // WebRTC and SIP bots without saved config intentionally have no SIP config.
  res.json(publicConfig(config));
});
router.put("/v1/bots/:id/sip", requireRole("ADMIN"), auditMiddleware("sip_config"), async (req, res) => {
  const input = sipInput.safeParse(req.body);
  if (!input.success) return void res.status(400).json({ error: input.error.message });
  const bot = await botForTenant(String(req.params.id), req.tenantId!);
  if (!bot) return void res.status(404).json({ error: "Bot not found" });
  const existing = await configForTenant(bot.id, req.tenantId!);
  const password = input.data.password?.trim();
  const { debugLogging, ...inputValues } = input.data;
  const values = { ...inputValues, debug: debugLogging, password: undefined, passwordEncrypted: password ? encryptSipPassword(password) : existing?.passwordEncrypted, updatedAt: new Date() };
  const rangeMin = values.rtpPortMin ?? existing?.rtpPortMin ?? 10000, rangeMax = values.rtpPortMax ?? existing?.rtpPortMax ?? 20000;
  if (rangeMin % 2 || rangeMax % 2 || rangeMax - rangeMin < 100) return void res.status(400).json({ error: "RTP ports must be even and at least 100 apart" });
  const transport = values.transport ?? existing?.transport ?? "udp", allowSelfSigned = values.allowSelfSigned ?? existing?.allowSelfSigned ?? false;
  if (allowSelfSigned && transport !== "tls" && transport !== "wss") return void res.status(400).json({ error: "allowSelfSigned requires TLS or WSS transport" });
  const { password: _password, ...persistedValues } = values;
  // MySQL has no RETURNING; write, then read the row back by its primary key.
  let configId: string;
  if (existing) {
    await db.update(sipConfigsTable).set(values).where(and(eq(sipConfigsTable.id, existing.id), eq(sipConfigsTable.tenantId, req.tenantId!)));
    configId = existing.id;
  } else {
    configId = randomUUID();
    await db.insert(sipConfigsTable).values({ id: configId, tenantId: req.tenantId!, botId: bot.id, ...persistedValues, enabled: values.enabled ?? true, registrarPort: values.registrarPort ?? 5060, transport, registerExpirySeconds: values.registerExpirySeconds ?? 300, codecs: values.codecs ?? ["PCMU", "PCMA"], rtpPortMin: rangeMin, rtpPortMax: rangeMax, inboundDids: values.inboundDids ?? [], allowSelfSigned });
  }
  const config = (await selectOne(sipConfigsTable, and(eq(sipConfigsTable.id, configId), eq(sipConfigsTable.tenantId, req.tenantId!))))!;
  // Reload only this gateway; an enabled SIP bot is then registered.
  try { await controlFreeSwitch("reload", config); }
  catch (error) { return void res.status(503).json({ error: error instanceof Error ? error.message : "FreeSWITCH worker unavailable" }); }
  if (bot.telephonyType === "sip" && config.enabled) {
    if (!config.passwordEncrypted) return void res.status(400).json({ error: "An enabled SIP configuration requires a password before registration" });
    try { await controlFreeSwitch("register", config); }
    catch (error) { return void res.status(503).json({ error: error instanceof Error ? error.message : "FreeSWITCH worker unavailable" }); }
  }
  res.json(publicConfig(config));
});
async function action(req: import("express").Request, res: import("express").Response, actionName: "register" | "unregister") {
  const bot = await botForTenant(String(req.params.id), req.tenantId!);
  if (!bot) return void res.status(404).json({ error: "Bot not found" });
  const config = await configForTenant(bot.id, req.tenantId!);
  // Unregister is idempotent: a SIP-selected bot may not have saved credentials yet.
  if (!config && actionName === "unregister") return void res.json({ accepted: true, requestId: null });
  if (!config) return void res.status(404).json({ error: "SIP configuration not found" });
  if (actionName === "register" && (!config.enabled || bot.telephonyType !== "sip")) return void res.status(409).json({ error: "SIP bot must be enabled before registration" });
  try { const result = await controlFreeSwitch(actionName, config); res.json({ accepted: true, requestId: result.requestId ?? null }); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "FreeSWITCH worker unavailable" }); }
}
async function testCall(req: import("express").Request, res: import("express").Response) {
  const input = z.object({ to: did }).safeParse(req.body);
  if (!input.success) return void res.status(400).json({ error: input.error.message });
  const bot = await botForTenant(String(req.params.id), req.tenantId!);
  const config = bot && await configForTenant(bot.id, req.tenantId!);
  if (!bot || bot.telephonyType !== "sip" || !config?.enabled) return void res.status(404).json({ error: "Enabled SIP configuration not found" });
  if (config.registrationState !== "registered") return void res.status(409).json({ error: "SIP gateway must be registered before a test call" });
  const persona = await resolvePersona(bot, bot.tenantId);
  const callId = randomUUID();
  await db.insert(callsTable).values({
    id: callId, tenantId: bot.tenantId, botId: bot.id, direction: "OUTBOUND", status: "INITIATING",
    customerNumber: input.data.to, startedAt: new Date(), summary: "SIP gateway test call",
    recordingConsentStatus: "NOT_REQUIRED", ...persona,
  });
  await db.update(botsTable).set({ activeCalls: sql`${botsTable.activeCalls} + 1`, status: "BUSY" })
    .where(and(eq(botsTable.id, bot.id), eq(botsTable.tenantId, bot.tenantId)));
  try {
    const result = await submitSipTestCall(bot.id, bot.tenantId, callId, input.data.to);
    res.json({ accepted: true, callId, requestId: result.requestId ?? null });
  } catch (error) {
    await db.transaction(async (tx) => {
      await tx.delete(callsTable).where(and(eq(callsTable.id, callId), eq(callsTable.tenantId, bot.tenantId)));
      await tx.update(botsTable).set({ activeCalls: sql`greatest(0, ${botsTable.activeCalls} - 1)`, status: sql`CASE WHEN ${botsTable.activeCalls} <= 1 THEN 'ONLINE' ELSE 'BUSY' END` })
        .where(and(eq(botsTable.id, bot.id), eq(botsTable.tenantId, bot.tenantId)));
    });
    res.status(503).json({ error: error instanceof Error ? error.message : "FreeSWITCH worker unavailable" });
  }
}
router.post("/v1/bots/:id/sip/register", requireRole("ADMIN"), actionRateLimit, auditMiddleware("sip_config"), (req, res) => void action(req, res, "register"));
router.post("/v1/bots/:id/sip/unregister", requireRole("ADMIN"), auditMiddleware("sip_config"), (req, res) => void action(req, res, "unregister"));
router.post("/v1/bots/:id/sip/test-call", requireRole("ADMIN"), actionRateLimit, auditMiddleware("sip_config"), (req, res) => void testCall(req, res));
router.get("/v1/bots/:id/sip/status", async (req, res) => {
  const config = await configForTenant(req.params.id, req.tenantId!);
  if (!config) return void res.json({ registrationState: "unregistered", lastRegisteredAt: null, lastError: null, activeCalls: 0 });
  res.json({ registrationState: config.registrationState, lastRegisteredAt: config.lastRegisteredAt, lastError: config.lastError, activeCalls: config.activeCalls });
});
router.get("/v1/bots/:id/sip/events", async (req, res) => {
  if (!await botForTenant(req.params.id, req.tenantId!)) return void res.status(404).json({ error: "Bot not found" });
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50)), level = typeof req.query.level === "string" ? req.query.level : undefined;
  if (level && !["debug", "info", "warn", "error"].includes(level)) return void res.status(400).json({ error: "Invalid event level" });
  const where = level ? and(eq(sipEventsTable.botId, req.params.id), eq(sipEventsTable.tenantId, req.tenantId!), eq(sipEventsTable.level, level)) : and(eq(sipEventsTable.botId, req.params.id), eq(sipEventsTable.tenantId, req.tenantId!));
  res.json(await db.select().from(sipEventsTable).where(where).orderBy(desc(sipEventsTable.timestamp)).limit(limit));
});
router.post("/v1/calls/:id/dtmf", actionRateLimit, auditMiddleware("sip_call_dtmf"), async (req, res) => {
  const input = z.object({ digit: z.string().regex(/^[0-9A-D*#]$/) }).safeParse(req.body);
  if (!input.success) return void res.status(400).json({ error: input.error.message });
  const [call] = await db.select().from(callsTable).where(and(eq(callsTable.id, String(req.params.id)), eq(callsTable.tenantId, req.tenantId!), inArray(callsTable.status, ["INITIATING", "RINGING", "IN_PROGRESS"]))).limit(1);
  if (!call) return void res.status(404).json({ error: "Active call not found" });
  const bot = await botForTenant(call.botId, req.tenantId!);
  const config = bot && await configForTenant(bot.id, req.tenantId!);
  if (!bot || bot.telephonyType !== "sip" || !config?.enabled) return void res.status(409).json({ error: "DTMF requires an active SIP call" });
  try {
    const result = await sendFreeSwitchDtmf(config, call.id, input.data.digit);
    res.json({ accepted: true, requestId: result.requestId ?? null });
  } catch (error) {
    res.status(error instanceof FreeSwitchWorkerUnavailableError ? 503 : 500).json({ error: error instanceof Error ? error.message : "FreeSWITCH worker unavailable" });
  }
});
router.post("/internal/freeswitch/callback", async (req, res) => {
  if (!workerAuthorized(req)) return void res.status(401).json({ error: "Unauthorized worker callback" });
  const legacyLifecycle = req.body && !req.body.callState && ["ringing", "answered", "failed", "ended"].includes(req.body.eventType)
    ? { ...req.body, callState: req.body.eventType, eventType: "log" }
    : req.body;
  const input = callbackBody.safeParse(legacyLifecycle);
  if (!input.success) return void res.status(400).json({ error: input.error.message });
  const bot = await botForTenant(input.data.botId, input.data.tenantId);
  if (!bot) return void res.status(404).json({ error: "Bot not found for tenant" });
  const config = await configForTenant(bot.id, bot.tenantId);
  if (!config) return void res.status(404).json({ error: "SIP configuration not found" });
  if (input.data.freeswitchUuid) {
    let [mapping] = await db.select().from(sipWorkerSessionsTable).where(eq(sipWorkerSessionsTable.freeswitchUuid, input.data.freeswitchUuid)).limit(1);
    if (!mapping && input.data.callId) {
      const [ownedCall] = await db.select({ id: callsTable.id }).from(callsTable).where(and(eq(callsTable.id, input.data.callId), eq(callsTable.tenantId, bot.tenantId), eq(callsTable.botId, bot.id))).limit(1);
      if (!ownedCall) return void res.status(404).json({ error: "Call not found for tenant" });
      // `ON DUPLICATE KEY UPDATE id = id` is MySQL's no-op equivalent of
      // `ON CONFLICT DO NOTHING`. The row is then read back either way, which
      // also covers a concurrent worker having inserted it first.
      await db.insert(sipWorkerSessionsTable).values({ id: randomUUID(), eventId: input.data.eventId ?? `lifecycle:${input.data.freeswitchUuid}`, freeswitchUuid: input.data.freeswitchUuid, tenantId: bot.tenantId, botId: bot.id, callId: ownedCall.id }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
      [mapping] = await db.select().from(sipWorkerSessionsTable).where(eq(sipWorkerSessionsTable.freeswitchUuid, input.data.freeswitchUuid)).limit(1);
    }
    if (!mapping || mapping.tenantId !== bot.tenantId || mapping.botId !== bot.id || (input.data.callId && mapping.callId !== input.data.callId)) return void res.status(404).json({ error: "FreeSWITCH call mapping not found for tenant" });
  }
  if (input.data.registrationState || input.data.activeCalls !== undefined || input.data.lastError !== undefined) await db.update(sipConfigsTable).set({ registrationState: input.data.registrationState ?? config.registrationState, activeCalls: input.data.activeCalls ?? config.activeCalls, lastError: input.data.lastError ?? config.lastError, lastErrorAt: input.data.lastError ? new Date() : config.lastErrorAt, lastRegisteredAt: input.data.registrationState === "registered" ? new Date() : config.lastRegisteredAt, updatedAt: new Date() }).where(and(eq(sipConfigsTable.id, config.id), eq(sipConfigsTable.tenantId, bot.tenantId)));
  if (input.data.callId && input.data.callState) {
    const status = input.data.callState === "ringing" ? "RINGING" : input.data.callState === "answered" ? "IN_PROGRESS" : input.data.callState === "failed" ? "FAILED" : "COMPLETED";
    const terminal = status === "FAILED" || status === "COMPLETED";
    // MySQL cannot RETURNING the updated row. `affectedRows` tells us whether
    // this delivery actually performed the transition — a duplicate delivery
    // arriving after a terminal state matches no row and must stay a no-op.
    const lifecycleUpdate = await db.update(callsTable).set({ status, sipCode: input.data.sipCode, finalDisposition: input.data.disposition, ...(terminal ? { endedAt: new Date(), hangupReason: input.data.callState === "failed" ? "FAILED" : "REMOTE_HANGUP" } : {}) })
      .where(and(eq(callsTable.id, input.data.callId), eq(callsTable.tenantId, bot.tenantId), terminal ? inArray(callsTable.status, ["INITIATING", "RINGING", "IN_PROGRESS"]) : inArray(callsTable.status, ["INITIATING", "RINGING", "IN_PROGRESS"])));
    const call = lifecycleUpdate[0].affectedRows > 0
      ? await selectOne(callsTable, and(eq(callsTable.id, input.data.callId), eq(callsTable.tenantId, bot.tenantId)))
      : undefined;
    if (!call) {
      const [existingCall] = await db.select({ id: callsTable.id }).from(callsTable).where(and(eq(callsTable.id, input.data.callId), eq(callsTable.tenantId, bot.tenantId))).limit(1);
      if (!existingCall) return void res.status(404).json({ error: "Call not found for tenant" });
      // Duplicate worker delivery after a terminal state is intentionally a no-op.
    }
    if (terminal && call) {
      await db.update(botsTable).set({ activeCalls: sql`greatest(0, ${botsTable.activeCalls} - 1)`, status: sql`CASE WHEN ${botsTable.activeCalls} <= 1 THEN 'ONLINE' ELSE 'BUSY' END` })
        .where(and(eq(botsTable.id, bot.id), eq(botsTable.tenantId, bot.tenantId)));
      await db.update(sipConfigsTable).set({ activeCalls: sql`greatest(0, ${sipConfigsTable.activeCalls} - 1)`, updatedAt: new Date() })
        .where(and(eq(sipConfigsTable.id, config.id), eq(sipConfigsTable.tenantId, bot.tenantId)));
      const [contact] = await db.select().from(campaignContactsTable).where(and(eq(campaignContactsTable.callId, call.id), eq(campaignContactsTable.tenantId, bot.tenantId))).limit(1);
      if (contact) {
        const [campaign] = await db.select().from(campaignsTable).where(and(eq(campaignsTable.id, contact.campaignId), eq(campaignsTable.tenantId, bot.tenantId))).limit(1);
        if (campaign) {
          const requested = input.data.disposition;
          const code = requested === "NO_ANSWER" || requested === "BUSY" || requested === "FAILED" ? requested : input.data.callState === "failed" ? "FAILED" : "CONNECTED_GOAL_MET";
          const retry = campaign.retryPolicyJson as { max_attempts?: number; spacing_minutes?: number; per_outcome?: Record<string, string> };
          const retryable = ["NO_ANSWER", "BUSY", "FAILED"].includes(code) && contact.attempts < (retry.max_attempts ?? 3) && retry.per_outcome?.[code] !== "skip";
          await db.transaction(async (tx) => {
            await tx.update(campaignContactsTable).set(retryable
              ? { state: "PENDING", nextAttemptAt: new Date(Date.now() + (retry.spacing_minutes ?? 30) * 60_000), lastDisposition: code, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }
              : { state: "DONE", lastDisposition: code, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() })
              .where(and(eq(campaignContactsTable.id, contact.id), eq(campaignContactsTable.tenantId, bot.tenantId), eq(campaignContactsTable.state, "IN_FLIGHT")));
            await tx.insert(dispositionsTable).values({ id: randomUUID(), tenantId: bot.tenantId, campaignId: campaign.id, campaignContactId: contact.id, callId: call.id, code, summaryText: `SIP campaign call completed: ${code}`, extractedFieldsJson: {} }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
            await tx.update(callbacksTable).set({ fulfilled: true, callId: call.id }).where(and(eq(callbacksTable.campaignContactId, contact.id), eq(callbacksTable.tenantId, bot.tenantId)));
          });
        }
      }
    }
  }
  if (input.data.callId && (input.data.dtmfDigit || input.data.mediaEvent)) {
    const [call] = await db.select().from(callsTable).where(and(eq(callsTable.id, input.data.callId), eq(callsTable.tenantId, bot.tenantId), eq(callsTable.botId, bot.id))).limit(1);
    if (!call) return void res.status(404).json({ error: "Call not found for tenant" });
    if (input.data.dtmfDigit) {
      const [session] = await db.select().from(sipWorkerSessionsTable).where(and(
        eq(sipWorkerSessionsTable.callId, call.id),
        eq(sipWorkerSessionsTable.tenantId, bot.tenantId),
        eq(sipWorkerSessionsTable.botId, bot.id),
        ...(input.data.freeswitchUuid ? [eq(sipWorkerSessionsTable.freeswitchUuid, input.data.freeswitchUuid)] : []),
      )).limit(1);
      if (!session) return void res.status(404).json({ error: "Active voice session mapping not found for tenant" });
      const dtmfEventId = input.data.eventId ? `dtmf:${input.data.eventId}` : randomUUID();
      const [existingDtmf] = await db.select({ id: complianceMediaEventsTable.id }).from(complianceMediaEventsTable)
        .where(and(eq(complianceMediaEventsTable.id, dtmfEventId), eq(complianceMediaEventsTable.tenantId, bot.tenantId))).limit(1);
      if (!existingDtmf) {
        await dispatchDtmfToSession({
          tenantId: bot.tenantId, botId: bot.id, callId: call.id, freeswitchUuid: session.freeswitchUuid,
          digit: input.data.dtmfDigit, eventId: input.data.eventId ?? null,
        });
        await db.insert(complianceMediaEventsTable).values({
        id: dtmfEventId, tenantId: bot.tenantId, callId: call.id, eventType: "DTMF",
        evidence: input.data.dtmfDigit, occurredAt: new Date(),
        }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
        await insertSipEvent({ id: dtmfEventId, tenantId: bot.tenantId, botId: bot.id, level: "info", direction: "inbound", methodResponse: "DTMF", summary: `DTMF received: ${input.data.dtmfDigit}` });
      }
    }
    if (input.data.mediaEvent) {
      if (!input.data.evidence) return void res.status(400).json({ error: "Media event evidence is required" });
      await db.insert(complianceMediaEventsTable).values({ id: input.data.eventId ?? randomUUID(), tenantId: bot.tenantId, callId: call.id, eventType: input.data.mediaEvent, evidence: redactSip(input.data.evidence) ?? "[REDACTED]", occurredAt: new Date() }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
      await db.update(callsTable).set(input.data.mediaEvent === "DISCLOSURE_PLAYED" ? { disclosurePlayedAt: new Date() } : { recordingConsentStatus: input.data.mediaEvent === "RECORDING_CONSENT_GRANTED" ? "GRANTED" : "DECLINED", recordingConsentAt: new Date() }).where(and(eq(callsTable.id, call.id), eq(callsTable.tenantId, bot.tenantId)));
    }
  }
  // A worker retry carrying the same eventId must not duplicate the event log.
  if (input.data.event) {
    const alreadyRecorded = input.data.eventId
      ? (await db.select({ id: sipEventsTable.id }).from(sipEventsTable)
        .where(and(eq(sipEventsTable.id, input.data.eventId), eq(sipEventsTable.tenantId, bot.tenantId))).limit(1))[0]
      : undefined;
    if (!alreadyRecorded) await insertSipEvent({ id: input.data.eventId, tenantId: bot.tenantId, botId: bot.id, ...input.data.event, rawSnippet: redactSip(input.data.event.rawSnippet) });
  }
  res.status(200).json({ accepted: true });
});
router.get("/internal/freeswitch/bootstrap", async (req, res) => {
  if (!workerAuthorized(req)) return void res.status(401).json({ error: "Unauthorized worker" });
  const rows = await db.select({ config: sipConfigsTable }).from(sipConfigsTable).innerJoin(botsTable, and(eq(botsTable.id, sipConfigsTable.botId), eq(botsTable.tenantId, sipConfigsTable.tenantId)))
    .where(and(eq(sipConfigsTable.enabled, true), eq(botsTable.telephonyType, "sip")));
  const configs = rows.map((row) => row.config);
  res.json({ configs: configs.map(workerConfig) });
});
router.get("/internal/freeswitch/bots/:tenantId/:botId/config", async (req, res) => {
  if (!workerAuthorized(req)) return void res.status(401).json({ error: "Unauthorized worker" });
  const config = await configForTenant(String(req.params.botId), String(req.params.tenantId));
  if (!config?.enabled) return void res.status(404).json({ error: "Enabled SIP configuration not found" });
  res.json(workerConfig(config));
});
router.post("/internal/freeswitch/inbound-map", async (req, res) => {
  if (!workerAuthorized(req)) return void res.status(401).json({ error: "Unauthorized worker" });
  const input = z.object({ tenantId: z.string(), botId: z.string(), gatewayIdentity: z.string() }).safeParse(req.body);
  if (!input.success) return void res.status(400).json({ error: input.error.message });
  const config = await configForTenant(input.data.botId, input.data.tenantId);
  if (!config?.enabled || `${config.registrarHost}:${config.registrarPort}:${config.extension}` !== input.data.gatewayIdentity) return void res.status(404).json({ error: "Inbound gateway mapping not found" });
  res.json({ tenantId: config.tenantId, botId: config.botId });
});
router.get("/internal/freeswitch/bots/:tenantId/:botId/session-config", async (req, res) => {
  if (!workerAuthorized(req)) return void res.status(401).json({ error: "Unauthorized worker" });
  const bot = await botForTenant(String(req.params.botId), String(req.params.tenantId));
  if (!bot || bot.telephonyType !== "sip") return void res.status(404).json({ error: "SIP bot not found" });
  res.json({ botId: bot.id, tenantId: bot.tenantId, direction: bot.direction, directionConfig: bot.directionConfig, supportedLanguages: bot.supportedLanguages, defaultGreetingLanguage: bot.defaultGreetingLanguage, timezone: bot.timezone, llmChainJson: bot.llmChainJson, sttMapJson: bot.sttMapJson, ttsMapJson: bot.ttsMapJson, activePersonaId: bot.activePersonaId });
});
router.post("/internal/freeswitch/inbound-session", async (req, res) => {
  if (!workerAuthorized(req)) return void res.status(401).json({ error: "Unauthorized worker" });
  const input = z.object({ tenantId: z.string(), botId: z.string(), gatewayIdentity: z.string(), freeswitchUuid: z.string(), from: did, to: z.string().min(1), eventId: z.string() }).safeParse(req.body);
  if (!input.success) return void res.status(400).json({ error: input.error.message });
  const bot = await botForTenant(input.data.botId, input.data.tenantId);
  const config = bot && await configForTenant(bot.id, bot.tenantId);
  if (!bot || bot.telephonyType !== "sip" || !config?.enabled || `${config.registrarHost}:${config.registrarPort}:${config.extension}` !== input.data.gatewayIdentity) return void res.status(404).json({ error: "Enabled inbound gateway mapping not found" });
  // Authorize the requested gateway before consulting globally unique delivery
  // identifiers; otherwise an attacker could use a duplicate ID to distinguish
  // capacity or event state belonging to another gateway/tenant.
  const previous = await db.select().from(sipWorkerSessionsTable).where(or(eq(sipWorkerSessionsTable.eventId, input.data.eventId), eq(sipWorkerSessionsTable.freeswitchUuid, input.data.freeswitchUuid))).limit(1);
  if (previous[0]) {
    if (previous[0].tenantId !== input.data.tenantId || previous[0].botId !== input.data.botId) return void res.status(409).json({ error: "Worker event identity conflict" });
    try { return void res.json(await durableSessionConfig(bot, previous[0].callId, previous[0].freeswitchUuid)); } catch (error) { return void res.status(503).json({ error: error instanceof Error ? error.message : "Media bridge unavailable" }); }
  }
  if (!process.env.MEDIA_BRIDGE_URL || !process.env.MEDIA_BRIDGE_TOKEN_SECRET) return void res.status(503).json({ error: "Media bridge is not configured" });
  const compliance = await evaluateCompliance({ tenantId: bot.tenantId, botId: bot.id, phoneNumber: input.data.from, direction: "INBOUND", botTimezone: bot.timezone });
  if (!compliance.allowed) return void res.status(403).json({ error: compliance.reason, reasonCode: compliance.reasonCode });
  const persona = await resolvePersona(bot, bot.tenantId);
  const callId = randomUUID();
  try {
    await db.transaction(async (tx) => {
      const [lockedBot] = await tx.select().from(botsTable).where(and(eq(botsTable.id, bot.id), eq(botsTable.tenantId, bot.tenantId))).for("update");
      const [lockedConfig] = await tx.select().from(sipConfigsTable).where(and(eq(sipConfigsTable.id, config.id), eq(sipConfigsTable.tenantId, bot.tenantId))).for("update");
      if (!lockedBot || lockedBot.telephonyType !== "sip" || !lockedConfig?.enabled ||
        `${lockedConfig.registrarHost}:${lockedConfig.registrarPort}:${lockedConfig.extension}` !== input.data.gatewayIdentity) {
        throw new Error("INBOUND_GATEWAY_NOT_FOUND");
      }
      if (lockedConfig.activeCalls >= lockedConfig.maxConcurrentCalls) throw new Error("SIP concurrency limit reached");
      await tx.insert(callsTable).values({ id: callId, botId: bot.id, tenantId: bot.tenantId, direction: "INBOUND", status: "RINGING", customerNumber: compliance.normalizedPhone, startedAt: new Date(), ...persona, disclosureText: compliance.disclosureText, recordingConsentStatus: compliance.recordingConsentRequired ? "PENDING" : "NOT_REQUIRED", complianceDecisionId: compliance.decisionId });
      await tx.update(complianceDecisionsTable).set({ callId }).where(and(eq(complianceDecisionsTable.id, compliance.decisionId), eq(complianceDecisionsTable.tenantId, bot.tenantId)));
      await tx.insert(sipWorkerSessionsTable).values({ id: randomUUID(), eventId: input.data.eventId, freeswitchUuid: input.data.freeswitchUuid, tenantId: bot.tenantId, botId: bot.id, callId });
      await tx.update(botsTable).set({ activeCalls: sql`${botsTable.activeCalls} + 1`, status: "BUSY" }).where(and(eq(botsTable.id, bot.id), eq(botsTable.tenantId, bot.tenantId)));
      await tx.update(sipConfigsTable).set({ activeCalls: sql`${sipConfigsTable.activeCalls} + 1`, updatedAt: new Date() }).where(and(eq(sipConfigsTable.id, config.id), eq(sipConfigsTable.tenantId, bot.tenantId)));
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INBOUND_GATEWAY_NOT_FOUND") return void res.status(404).json({ error: "Enabled inbound gateway mapping not found" });
    const raced = await db.select().from(sipWorkerSessionsTable).where(or(eq(sipWorkerSessionsTable.eventId, input.data.eventId), eq(sipWorkerSessionsTable.freeswitchUuid, input.data.freeswitchUuid))).limit(1);
    if (raced[0]?.tenantId === bot.tenantId && raced[0]?.botId === bot.id) return void res.json(await durableSessionConfig(bot, raced[0].callId, raced[0].freeswitchUuid));
    return void res.status(409).json({ error: error instanceof Error ? error.message : "Unable to create inbound session" });
  }
  res.status(201).json(await durableSessionConfig(bot, callId, input.data.freeswitchUuid));
});
export default router;