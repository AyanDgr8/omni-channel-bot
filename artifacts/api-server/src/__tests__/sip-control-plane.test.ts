import request from "supertest";
import bcrypt from "bcryptjs";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../app.js";
import {
  botsTable,
  callbacksTable,
  callsTable,
  campaignContactsTable,
  campaignsTable,
  complianceDecisionsTable,
  complianceMediaEventsTable,
  complianceProfilesTable,
  db,
  dispositionsTable,
  sipConfigsTable,
  sipEventsTable,
  sipWorkerSessionsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { encryptSipPassword } from "../lib/sip-credential-crypto.js";
import { dtmfRequestSchema, originateRequestSchema } from "../lib/freeswitch-protocol.js";
import { dispatchDtmfToSession, registerDtmfSessionConsumer, type DtmfSessionEvent } from "../lib/dtmf-session-dispatch.js";

const tenantId = `sip-api-t1-${randomUUID()}`;
const otherTenantId = `sip-api-t2-${randomUUID()}`;
const sipBotId = `sip-api-bot-${randomUUID()}`;
const webRtcBotId = `sip-api-webrtc-${randomUUID()}`;
const disabledBotId = `sip-api-disabled-${randomUUID()}`;
const otherBotId = `sip-api-other-${randomUUID()}`;
const configId = `sip-api-config-${randomUUID()}`;
const workerToken = `worker-${randomUUID()}`;
const password = `sip-password-${randomUUID()}`;
const email = `sip-api-${randomUUID()}@test.local`;
let cookie = "";

const workerHeaders = { Authorization: `Bearer ${workerToken}` };
const gatewayIdentity = "pbx.test.local:5061:4100";

function workerOk(requestId: string = randomUUID()) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const payload = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === "/v1/gateways/originate") originateRequestSchema.parse(payload);
    if (/^\/v1\/calls\/[^/]+\/dtmf$/.test(path)) dtmfRequestSchema.parse(payload);
    return new Response(JSON.stringify({ requestId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

async function login() {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password: "test1234" });
  expect(response.status).toBe(200);
  const header = response.headers["set-cookie"] as string[] | string;
  return Array.isArray(header) ? header[0] : header;
}

beforeAll(async () => {
  process.env.FREESWITCH_WORKER_URL = "http://localhost:18081";
  process.env.FREESWITCH_WORKER_AUTH_SECRET = `outbound-${randomUUID()}`;
  process.env.FREESWITCH_WORKER_CALLBACK_SECRET = workerToken;
  process.env.MEDIA_BRIDGE_URL = "wss://media.test.local/bridge";
  process.env.MEDIA_BRIDGE_TOKEN_SECRET = `media-${randomUUID()}`;
  process.env.MEDIA_BRIDGE_DTMF_URL = "http://localhost:18082/v1/media/dtmf";

  const hash = await bcrypt.hash("test1234", 10);
  await db.insert(tenantsTable).values([
    { id: tenantId, name: "SIP API tenant", slug: `sip-api-${randomUUID()}`, webhookSecret: randomUUID() },
    { id: otherTenantId, name: "Other SIP tenant", slug: `sip-api-other-${randomUUID()}`, webhookSecret: randomUUID() },
  ]);
  await db.insert(usersTable).values({ id: randomUUID(), tenantId, email, passwordHash: hash, role: "OWNER", status: "active" });
  await db.insert(botsTable).values([
    { id: sipBotId, tenantId, displayName: "Registered SIP", sipExtension: "4100", telephonyType: "sip", direction: "outbound", status: "ONLINE" },
    { id: webRtcBotId, tenantId, displayName: "WebRTC retained config", sipExtension: "4101", telephonyType: "webrtc" },
    { id: disabledBotId, tenantId, displayName: "Disabled SIP", sipExtension: "4102", telephonyType: "sip" },
    { id: otherBotId, tenantId: otherTenantId, displayName: "Other SIP", sipExtension: "4100", telephonyType: "sip" },
  ]);
  const base = {
    registrarHost: "pbx.test.local",
    registrarPort: 5061,
    transport: "tls",
    authUsername: "auth-user",
    passwordEncrypted: encryptSipPassword(password),
    registrationState: "registered",
    outboundEnabled: true,
  } as const;
  await db.insert(sipConfigsTable).values([
    { id: configId, tenantId, botId: sipBotId, extension: "4100", maxConcurrentCalls: 1, ...base },
    { id: randomUUID(), tenantId, botId: webRtcBotId, extension: "4101", ...base },
    { id: randomUUID(), tenantId, botId: disabledBotId, extension: "4102", enabled: false, ...base },
    { id: randomUUID(), tenantId: otherTenantId, botId: otherBotId, extension: "4100", ...base },
  ]);
  await db.insert(complianceProfilesTable).values([
    { id: randomUUID(), tenantId, jurisdictionCode: "DEFAULT", displayName: "Default", timezone: "UTC", callingWindowStart: "00:00", callingWindowEnd: "23:59", allowedDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], requireConsent: false, requireRecordingConsent: false },
    { id: randomUUID(), tenantId: otherTenantId, jurisdictionCode: "DEFAULT", displayName: "Default", timezone: "UTC", callingWindowStart: "00:00", callingWindowEnd: "23:59", allowedDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], requireConsent: false, requireRecordingConsent: false },
  ]);
  cookie = await login();
});

beforeEach(async () => {
  process.env.NODE_ENV = "test";
  process.env.MEDIA_BRIDGE_DTMF_URL = "http://localhost:18082/v1/media/dtmf";
  vi.stubGlobal("fetch", workerOk());
  await db.update(botsTable).set({ activeCalls: 0, status: "ONLINE" }).where(eq(botsTable.id, sipBotId));
  await db.update(sipConfigsTable).set({ activeCalls: 0, registrationState: "registered", outboundEnabled: true, enabled: true }).where(eq(sipConfigsTable.id, configId));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db.delete(complianceMediaEventsTable).where(eq(complianceMediaEventsTable.tenantId, tenantId)).catch(() => {});
  await db.delete(sipEventsTable).where(eq(sipEventsTable.tenantId, tenantId)).catch(() => {});
  await db.delete(dispositionsTable).where(eq(dispositionsTable.tenantId, tenantId)).catch(() => {});
  await db.delete(callbacksTable).where(eq(callbacksTable.tenantId, tenantId)).catch(() => {});
  await db.delete(sipWorkerSessionsTable).where(eq(sipWorkerSessionsTable.tenantId, tenantId)).catch(() => {});
  await db.delete(campaignContactsTable).where(eq(campaignContactsTable.tenantId, tenantId)).catch(() => {});
  await db.delete(campaignsTable).where(eq(campaignsTable.tenantId, tenantId)).catch(() => {});
  await db.delete(complianceDecisionsTable).where(eq(complianceDecisionsTable.tenantId, tenantId)).catch(() => {});
  await db.delete(complianceDecisionsTable).where(eq(complianceDecisionsTable.tenantId, otherTenantId)).catch(() => {});
  await db.delete(callsTable).where(eq(callsTable.tenantId, tenantId)).catch(() => {});
  await db.delete(callsTable).where(eq(callsTable.tenantId, otherTenantId)).catch(() => {});
  await db.delete(complianceProfilesTable).where(eq(complianceProfilesTable.tenantId, tenantId)).catch(() => {});
  await db.delete(complianceProfilesTable).where(eq(complianceProfilesTable.tenantId, otherTenantId)).catch(() => {});
  await db.delete(sipConfigsTable).where(eq(sipConfigsTable.tenantId, tenantId)).catch(() => {});
  await db.delete(sipConfigsTable).where(eq(sipConfigsTable.tenantId, otherTenantId)).catch(() => {});
  await db.delete(botsTable).where(eq(botsTable.tenantId, tenantId)).catch(() => {});
  await db.delete(botsTable).where(eq(botsTable.tenantId, otherTenantId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.tenantId, tenantId)).catch(() => {});
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId)).catch(() => {});
  await db.delete(tenantsTable).where(eq(tenantsTable.id, otherTenantId)).catch(() => {});
});

describe("SIP API control plane", () => {
  it("authenticates bootstrap and returns only enabled SIP configs in the direct envelope", async () => {
    expect((await request(app).get("/api/internal/freeswitch/bootstrap")).status).toBe(401);
    const response = await request(app).get("/api/internal/freeswitch/bootstrap").set(workerHeaders);
    expect(response.status).toBe(200);
    expect(Object.keys(response.body)).toEqual(["configs"]);
    const config = response.body.configs.find((item: { botId: string }) => item.botId === sipBotId);
    expect(config).toMatchObject({ tenantId, botId: sipBotId, registrarHost: "pbx.test.local", extension: "4100", password });
    expect(config).not.toHaveProperty("config");
    expect(JSON.stringify(response.body)).not.toContain("passwordEncrypted");
    expect(response.body.configs.some((item: { botId: string }) => item.botId === webRtcBotId || item.botId === disabledBotId)).toBe(false);
  });

  it("never exposes a public SIP credential", async () => {
    const response = await request(app).get(`/api/v1/bots/${sipBotId}/sip`).set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ passwordIsSet: true, passwordMasked: "••••••••" });
    expect(response.body).not.toHaveProperty("password");
    expect(response.body).not.toHaveProperty("passwordEncrypted");
  });

  it("persists exact and trailing-star DID patterns and sends them to the worker", async () => {
    const response = await request(app).put(`/api/v1/bots/${sipBotId}/sip`).set("Cookie", cookie).send({
      registrarHost: "pbx.test.local", registrarPort: 5061, transport: "tls", extension: "4100",
      authUsername: "auth-user", inboundDids: ["+14155550123", "+1415*"], srtpMode: "required",
      dtmfMode: "sip_info", debugLogging: true, outboundEnabled: true, allowSelfSigned: false,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ inboundDids: ["+14155550123", "+1415*"], srtpMode: "required", dtmfMode: "sip_info", debugLogging: true });
    const [stored] = await db.select().from(sipConfigsTable).where(eq(sipConfigsTable.id, configId));
    expect(stored.inboundDids).toEqual(["+14155550123", "+1415*"]);
    const bootstrap = await request(app).get("/api/internal/freeswitch/bootstrap").set(workerHeaders);
    expect(bootstrap.body.configs.find((item: { botId: string }) => item.botId === sipBotId).inboundDids).toEqual(["+14155550123", "+1415*"]);
    const invalid = await request(app).put(`/api/v1/bots/${sipBotId}/sip`).set("Cookie", cookie).send({
      registrarHost: "pbx.test.local", extension: "4100", authUsername: "auth-user", inboundDids: ["+1415**"],
    });
    expect(invalid.status).toBe(400);
  });

  it("creates a durable media-enabled test call through canonical originate", async () => {
    const fetchMock = workerOk("test-call-request");
    vi.stubGlobal("fetch", fetchMock);
    const response = await request(app).post(`/api/v1/bots/${sipBotId}/sip/test-call`).set("Cookie", cookie).send({ to: "+14155550100" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ accepted: true, requestId: "test-call-request", callId: expect.any(String) });
    const [call] = await db.select().from(callsTable).where(eq(callsTable.id, response.body.callId));
    const [mapping] = await db.select().from(sipWorkerSessionsTable).where(eq(sipWorkerSessionsTable.callId, response.body.callId));
    expect(call).toMatchObject({ tenantId, botId: sipBotId, status: "INITIATING", summary: "SIP gateway test call" });
    expect(mapping).toMatchObject({ tenantId, botId: sipBotId, freeswitchUuid: response.body.callId });
    const payload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(payload).toMatchObject({ callId: response.body.callId, to: "+14155550100", session: { mediaBridgeUrl: "wss://media.test.local/bridge", mediaSessionToken: expect.any(String), sessionConfig: { callId: response.body.callId } } });
  });

  it("rolls back a temporary test call and mapping when originate fails", async () => {
    const mappingsBefore = (await db.select().from(sipWorkerSessionsTable).where(eq(sipWorkerSessionsTable.tenantId, tenantId))).length;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const response = await request(app).post(`/api/v1/bots/${sipBotId}/sip/test-call`).set("Cookie", cookie).send({ to: "+14155550999" });
    expect(response.status).toBe(503);
    expect(await db.select().from(callsTable).where(and(eq(callsTable.tenantId, tenantId), eq(callsTable.customerNumber, "+14155550999")))).toHaveLength(0);
    expect((await db.select().from(sipWorkerSessionsTable).where(eq(sipWorkerSessionsTable.tenantId, tenantId))).length).toBe(mappingsBefore);
  });

  it("originates direct SIP calls without running synthetic completion and enforces registration", async () => {
    const fetchMock = workerOk("originate-test");
    vi.stubGlobal("fetch", fetchMock);
    const response = await request(app).post("/api/v1/calls/dial").set("Cookie", cookie).send({ botId: sipBotId, to: "+14155550101" });
    expect(response.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/gateways/originate");
    expect(JSON.parse(String(init.body))).toMatchObject({ callId: response.body.id, to: "+14155550101" });
    expect(JSON.parse(String(init.body)).session).toEqual(expect.objectContaining({
      mediaBridgeUrl: "wss://media.test.local/bridge",
      mediaSessionToken: expect.any(String),
      sessionConfig: expect.objectContaining({ callId: response.body.id, tenantId, botId: sipBotId }),
    }));
    const dtmf = await request(app).post(`/api/v1/calls/${response.body.id}/dtmf`).set("Cookie", cookie).send({ digit: "A" });
    expect(dtmf.status).toBe(200);
    expect(String(fetchMock.mock.calls[1][0])).toContain(`/v1/calls/${response.body.id}/dtmf`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const [persisted] = await db.select().from(callsTable).where(eq(callsTable.id, response.body.id));
    expect(persisted.status).toBe("INITIATING");

    await db.update(sipConfigsTable).set({ registrationState: "unregistered" }).where(eq(sipConfigsTable.id, configId));
    const rejected = await request(app).post("/api/v1/calls/dial").set("Cookie", cookie).send({ botId: sipBotId, to: "+14155550102" });
    expect(rejected.status).toBe(502);
  });

  it("rolls back the call and bot state when the worker is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const number = "+14155550103";
    const response = await request(app).post("/api/v1/calls/dial").set("Cookie", cookie).send({ botId: sipBotId, to: number });
    expect(response.status).toBe(502);
    expect(await db.select().from(callsTable).where(and(eq(callsTable.tenantId, tenantId), eq(callsTable.customerNumber, number)))).toHaveLength(0);
    const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, sipBotId));
    expect(bot).toMatchObject({ activeCalls: 0, status: "ONLINE" });
    const [config] = await db.select().from(sipConfigsTable).where(eq(sipConfigsTable.id, configId));
    expect(config.activeCalls).toBe(0);
  });

  it("creates one isolated inbound session and enforces gateway and concurrency", async () => {
    const body = { tenantId, botId: sipBotId, gatewayIdentity, freeswitchUuid: randomUUID(), from: "+14155550104", to: "+14155554100", eventId: randomUUID() };
    const first = await request(app).post("/api/internal/freeswitch/inbound-session").set(workerHeaders).send(body);
    expect(first.status).toBe(201);
    expect(Object.keys(first.body).sort()).toEqual(["accepted", "callId", "freeswitchUuid", "mediaBridgeUrl", "mediaSessionToken", "sessionConfig"].sort());
    expect(first.body).toMatchObject({ accepted: true, freeswitchUuid: body.freeswitchUuid, mediaBridgeUrl: "wss://media.test.local/bridge" });
    const retryByEvent = await request(app).post("/api/internal/freeswitch/inbound-session").set(workerHeaders).send({ ...body, freeswitchUuid: randomUUID() });
    expect(retryByEvent.status).toBe(200);
    expect(retryByEvent.body.callId).toBe(first.body.callId);
    const second = await request(app).post("/api/internal/freeswitch/inbound-session").set(workerHeaders).send({ ...body, eventId: randomUUID(), freeswitchUuid: randomUUID() });
    expect(second.status).toBe(409);
    const foreign = await request(app).post("/api/internal/freeswitch/inbound-session").set(workerHeaders).send({ ...body, tenantId: otherTenantId, botId: otherBotId, gatewayIdentity: "foreign-pbx.test.local:5061:4100" });
    expect(foreign.status).toBe(404);
  });

  it("applies terminal lifecycle once and rejects a foreign mapping", async () => {
    const dial = await request(app).post("/api/v1/calls/dial").set("Cookie", cookie).send({ botId: sipBotId, to: "+14155550105" });
    const uuid = dial.body.id;
    const payload = { tenantId, botId: sipBotId, callId: dial.body.id, freeswitchUuid: uuid, eventId: randomUUID(), callState: "ended" };
    expect((await request(app).post("/api/internal/freeswitch/callback").set(workerHeaders).send(payload)).status).toBe(200);
    expect((await request(app).post("/api/internal/freeswitch/callback").set(workerHeaders).send({ ...payload, eventId: randomUUID() })).status).toBe(200);
    const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, sipBotId));
    expect(bot.activeCalls).toBe(0);
    const [config] = await db.select().from(sipConfigsTable).where(eq(sipConfigsTable.id, configId));
    expect(config.activeCalls).toBe(0);
    const rejected = await request(app).post("/api/internal/freeswitch/callback").set(workerHeaders)
      .send({ tenantId: otherTenantId, botId: otherBotId, callId: dial.body.id, freeswitchUuid: uuid, callState: "ended" });
    expect(rejected.status).toBe(404);
  });

  it("persists tenant-scoped DTMF/media events and redacts SIP material", async () => {
    const callRowId = randomUUID();
    await db.insert(callsTable).values({ id: callRowId, tenantId, botId: sipBotId, direction: "INBOUND", status: "IN_PROGRESS", recordingConsentStatus: "PENDING" });
    const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callRowId));
    const uuid = randomUUID();
    await db.insert(sipWorkerSessionsTable).values({ id: randomUUID(), tenantId, botId: sipBotId, callId: call.id, eventId: randomUUID(), freeswitchUuid: uuid });
    const delivered: DtmfSessionEvent[] = [];
    const unregister = registerDtmfSessionConsumer((event) => { delivered.push(event); });
    const fetchMock = workerOk();
    vi.stubGlobal("fetch", fetchMock);
    const eventId = randomUUID();
    const response = await request(app).post("/api/internal/freeswitch/callback").set(workerHeaders).send({
      tenantId, botId: sipBotId, callId: call.id, freeswitchUuid: uuid, eventId, dtmfDigit: "5",
      mediaEvent: "RECORDING_CONSENT_GRANTED", evidence: "Authorization: Digest secret password=hunter2\nv=0\r\nm=audio 4000 RTP/AVP 0",
      event: { level: "info", summary: "worker event", rawSnippet: "Authorization: Bearer token\npassword=secret\nv=0\r\nm=audio 5000" },
    });
    expect(response.status).toBe(200);
    const foreign = await request(app).post("/api/internal/freeswitch/callback").set(workerHeaders).send({
      tenantId: otherTenantId, botId: otherBotId, callId: call.id, freeswitchUuid: uuid,
      eventId: randomUUID(), eventType: "dtmf", dtmfDigit: "9",
    });
    expect(foreign.status).toBe(404);
    unregister();
    expect(delivered).toEqual([expect.objectContaining({ tenantId, botId: sipBotId, callId: call.id, freeswitchUuid: uuid, digit: "5", eventId })]);
    const mediaDelivery = fetchMock.mock.calls.find((entry) => String(entry[0]).includes("/v1/media/dtmf"));
    expect(mediaDelivery).toBeTruthy();
    const deliveryInit = mediaDelivery?.[1] as RequestInit;
    const deliveryBody = String(deliveryInit.body);
    expect(JSON.parse(deliveryBody)).toEqual(expect.objectContaining({ tenantId, botId: sipBotId, callId: call.id, freeswitchUuid: uuid, digit: "5", eventId }));
    expect((deliveryInit.headers as Record<string, string>).Authorization).toBe(`Bearer ${createHmac("sha256", process.env.MEDIA_BRIDGE_TOKEN_SECRET!).update(deliveryBody).digest("hex")}`);
    const media = await db.select().from(complianceMediaEventsTable).where(and(eq(complianceMediaEventsTable.callId, call.id), eq(complianceMediaEventsTable.tenantId, tenantId)));
    expect(media.some((event) => event.eventType === "DTMF" && event.evidence === "5")).toBe(true);
    const consentEvent = media.find((event) => event.eventType === "RECORDING_CONSENT_GRANTED");
    expect(consentEvent?.evidence).toContain("[REDACTED]");
    expect(consentEvent?.evidence).not.toContain("hunter2");
    const events = await db.select().from(sipEventsTable).where(and(eq(sipEventsTable.botId, sipBotId), eq(sipEventsTable.tenantId, tenantId)));
    expect(events.some((event) => event.methodResponse === "DTMF" && event.summary.includes("5"))).toBe(true);
    expect(JSON.stringify(events)).not.toContain("Bearer token");
  });

  it("fails production DTMF without a secure target and reports delivery failures while retaining test consumers", async () => {
    const event: DtmfSessionEvent = { tenantId, botId: sipBotId, callId: randomUUID(), freeswitchUuid: randomUUID(), digit: "7", eventId: randomUUID() };
    process.env.NODE_ENV = "production";
    delete process.env.MEDIA_BRIDGE_DTMF_URL;
    await expect(dispatchDtmfToSession(event)).rejects.toThrow("MEDIA_BRIDGE_DTMF_URL is required in production");

    process.env.MEDIA_BRIDGE_DTMF_URL = "https://media.test.local/v1/dtmf";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    const consumed: DtmfSessionEvent[] = [];
    const unregister = registerDtmfSessionConsumer((value) => { consumed.push(value); });
    await expect(dispatchDtmfToSession(event)).rejects.toThrow("HTTP 503");
    unregister();
    expect(consumed).toEqual([event]);
  });

  it("reconciles a failed SIP campaign terminal callback exactly once", async () => {
    const campaignId = randomUUID();
    await db.insert(campaignsTable).values({ id: campaignId, tenantId, botId: sipBotId, name: "SIP callback campaign", status: "RUNNING", concurrencyCap: 1, retryPolicyJson: { max_attempts: 2, spacing_minutes: 1, per_outcome: {} } });
    const trigger = await request(app).post(`/api/v1/campaigns/${campaignId}/trigger-call`).set("Cookie", cookie).send({ phone: "+14155550106", variables: {} });
    expect(trigger.status).toBe(201);
    const [contact] = await db.select().from(campaignContactsTable).where(and(eq(campaignContactsTable.campaignId, campaignId), eq(campaignContactsTable.tenantId, tenantId)));
    const payload = { tenantId, botId: sipBotId, callId: trigger.body.call.id, freeswitchUuid: trigger.body.call.id, eventId: randomUUID(), callState: "failed", disposition: "FAILED" };
    await request(app).post("/api/internal/freeswitch/callback").set(workerHeaders).send(payload).expect(200);
    await request(app).post("/api/internal/freeswitch/callback").set(workerHeaders).send({ ...payload, eventId: randomUUID() }).expect(200);
    const [updated] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, contact.id));
    expect(updated).toMatchObject({ state: "PENDING", lastDisposition: "FAILED", leaseToken: null });
    expect(await db.select().from(dispositionsTable).where(eq(dispositionsTable.callId, trigger.body.call.id))).toHaveLength(1);
  });
});