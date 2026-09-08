import test from "node:test";
import assert from "node:assert/strict";
import { parseFrames } from "./esl.js";
import { CallbackClient, callbackHeaders } from "./callback.js";
import { JitterBuffer, PCM16_16K_FRAME_BYTES } from "./media.js";
import { gatewayName, originate, parseBootstrap, redact, token, type InboundSession, type InboundSessionRequest, type SipConfig } from "./protocol.js";
import { gatewayXml } from "./sofia.js";
import { matchesInbound, RegistrationManager, validateDidPatterns } from "./registration.js";
import { EventEmitter } from "node:events";
import { createWorkerServer } from "./http.js";
import type { AddressInfo } from "node:net";

class FakeEsl extends EventEmitter { commands: string[] = []; command(command: string): void { this.commands.push(command); } }
class FakeCallback {
  events: Array<Record<string, unknown>> = []; inbound: InboundSessionRequest[] = [];
  async send(event: Record<string, unknown>): Promise<void> { this.events.push(event); }
  async authorizeInbound(request: InboundSessionRequest): Promise<InboundSession> { this.inbound.push(request); return { accepted: true, callId: "durable_2", freeswitchUuid: request.freeswitchUuid, mediaBridgeUrl: "wss://bridge.example.test/media", mediaSessionToken: "session-secret", sessionConfig: { greeting: true } }; }
}
const flush = async (): Promise<void> => { await new Promise((resolve) => setImmediate(resolve)); };

const config: SipConfig = { tenantId: "tenant_1", botId: "bot_1", registrarHost: "sip.example.com", extension: "1200", authUsername: "1200", password: "secret", outboundEnabled: true };
test("ESL framing accepts split content bodies", () => {
  const frame = "Content-Type: text/event-plain\nContent-Length: 3\n\nabc";
  assert.deepEqual(parseFrames(frame.slice(0, -1)).frames, []);
  assert.equal(parseFrames(frame).frames[0]?.body, "abc");
});
test("commands reject unsafe SIP fields and retain idempotency UUID", () => {
  assert.throws(() => token("a\napi shutdown"));
  const built = originate(config, "+15551234567", "call_1");
  assert.match(built.command, /origination_uuid=call_1/);
  assert.match(built.command, /sofia\/gateway\/vox_tenant_1_bot_1\/\+15551234567/);
  assert.equal(gatewayName(config), "vox_tenant_1_bot_1");
});
test("jitter buffer supplies PLC from prior PCM frame", () => {
  const jitter = new JitterBuffer(), pcm = Buffer.alloc(PCM16_16K_FRAME_BYTES, 7);
  jitter.push(4, pcm); assert.deepEqual(jitter.pull(), pcm); assert.deepEqual(jitter.pull(), pcm);
});
test("callback authorization includes bearer and HMAC", () => {
  const headers = callbackHeaders("secret", "{\"x\":1}");
  assert.equal(headers.authorization, "Bearer secret"); assert.match(headers["x-vox-event-signature"], /^sha256=[a-f0-9]{64}$/);
});
test("bootstrap accepts the fixed direct-config envelope", () => {
  assert.deepEqual(parseBootstrap({ configs: [config] }), [config]); assert.throws(() => parseBootstrap([config]));
});
test("Sofia XML escapes credentials and applies transport policy without leaking password", () => {
  const out = gatewayXml({ ...config, password: "s<&\"'", transport: "tls", codecs: ["PCMU"], srtpMode: "required", keepaliveIntervalSeconds: 20 });
  assert.match(out, /password" value="s&lt;&amp;&quot;&apos;"/); assert.match(out, /tls-verify-policy" value="all"/);
  assert.match(out, /rtp_secure_media" value="mandatory"/); assert.match(out, /options-ping" value="20"/);
});
test("DID matching permits only exact E.164 or one trailing-prefix wildcard", () => {
  const didConfig = { ...config, inboundDids: ["+15551234567", "+4420*", "+1*"] };
  validateDidPatterns(didConfig.inboundDids);
  assert.equal(matchesInbound(didConfig, "", "+15551234567"), true);
  assert.equal(matchesInbound(didConfig, "", "+442079460000"), true);
  assert.equal(matchesInbound(didConfig, "", "+14155550100"), true);
  assert.equal(matchesInbound(didConfig, "", "+33123456789"), false);
  assert.equal(matchesInbound(didConfig, "", "+442"), false);
  assert.throws(() => validateDidPatterns(["+1"])); assert.throws(() => validateDidPatterns(["+1555.*"])); assert.throws(() => validateDidPatterns(["1555*"])); assert.throws(() => validateDidPatterns(["+155*55"]));
});
test("registration changes state only after a Sofia event and retries failures", async () => {
  const esl = new FakeEsl(), callback = new FakeCallback(), manager = new RegistrationManager(esl as never, callback as never);
  await manager.register(config); await flush();
  assert.equal(callback.events.some((e) => e.registrationState === "registered"), false);
  esl.emit("frame", { headers: { "event-name": "CUSTOM" }, body: "Event-Subclass: sofia::register\nGateway-Name: vox_tenant_1_bot_1\nProfile-Name: external\nStatus: 401 Unauthorized" });
  await flush(); assert.equal(callback.events.at(-1)?.registrationState, "failed");
  esl.emit("frame", { headers: { "event-name": "CUSTOM" }, body: "Event-Subclass: sofia::register\nGateway-Name: vox_tenant_1_bot_1\nProfile-Name: external\nStatus: Registered" });
  await flush(); assert.equal(callback.events.at(-1)?.registrationState, "registered");
});
test("inbound matching is gateway-scoped and answer lifecycle attaches and cleans audio bridge", async () => {
  const esl = new FakeEsl(), callback = new FakeCallback(), manager = new RegistrationManager(esl as never, callback as never);
  const other = { ...config, tenantId: "tenant_2", botId: "bot_2" };
  await manager.reconcile([config, other]); esl.commands.length = 0;
  esl.emit("frame", { headers: { "event-name": "CHANNEL_CREATE", "unique-id": "call_2", "call-direction": "inbound", "variable_sip_gateway_name": "vox_tenant_2_bot_2", "variable_sip_to_user": "1200" }, body: "" });
  esl.emit("frame", { headers: { "event-name": "CHANNEL_ANSWER", "unique-id": "call_2", "call-direction": "inbound", "variable_sip_gateway_name": "vox_tenant_2_bot_2" }, body: "" });
  esl.emit("frame", { headers: { "event-name": "DTMF", "unique-id": "call_2", "call-direction": "inbound", "variable_sip_gateway_name": "vox_tenant_2_bot_2", "dtmf-digit": "5" }, body: "" });
  esl.emit("frame", { headers: { "event-name": "CHANNEL_HANGUP", "unique-id": "call_2", "call-direction": "inbound", "variable_sip_gateway_name": "vox_tenant_2_bot_2" }, body: "" });
  await flush();
  assert.equal(esl.commands.filter((c) => c.includes("uuid_answer call_2")).length, 1);
  assert.ok(esl.commands.some((c) => c.includes("uuid_audio_fork call_2 start")));
  assert.ok(esl.commands.some((c) => c.includes("uuid_audio_fork call_2 stop")));
  assert.deepEqual(callback.inbound[0], { tenantId: "tenant_2", botId: "bot_2", gatewayIdentity: "sip.example.com:5060:1200", freeswitchUuid: "call_2", from: "", to: "1200", eventId: callback.inbound[0]?.eventId });
  assert.ok(callback.events.some((e) => e.callId === "durable_2" && e.freeswitchUuid === "call_2" && e.eventType === "dtmf" && e.dtmfDigit === "5"));
  const dtmfBody = JSON.parse(JSON.stringify(callback.events.find((e) => e.eventType === "dtmf")));
  assert.deepEqual(dtmfBody, { tenantId: "tenant_2", botId: "bot_2", activeCalls: 1, callId: "durable_2", freeswitchUuid: "call_2", eventType: "dtmf", dtmfDigit: "5", event: { level: "info", summary: "DTMF received", direction: "inbound" } });
  assert.ok(callback.events.some((e) => e.callId === "durable_2" && e.callState === "answered"));
  assert.ok(callback.events.some((e) => e.callId === "durable_2" && e.callState === "ended"));
  assert.doesNotMatch(redact("mediaSessionToken=session-secret token=other"), /session-secret|other/);
});
test("inbound call is not answered before API authorization", async () => {
  const esl = new FakeEsl(); let approve!: (value: InboundSession) => void;
  const callback = new FakeCallback();
  callback.authorizeInbound = async (request) => { callback.inbound.push(request); return new Promise((resolve) => { approve = resolve; }); };
  const manager = new RegistrationManager(esl as never, callback as never); await manager.reconcile([config]); esl.commands.length = 0;
  esl.emit("frame", { headers: { "event-name": "CHANNEL_CREATE", "unique-id": "pending_1", "call-direction": "inbound", "variable_sip_gateway_name": "vox_tenant_1_bot_1", "variable_sip_to_user": "1200" }, body: "" });
  await flush(); assert.equal(esl.commands.some((c) => c.includes("uuid_answer")), false);
  approve({ accepted: true, callId: "durable_pending", freeswitchUuid: "pending_1", mediaBridgeUrl: "wss://bridge.example.test/media", mediaSessionToken: "token", sessionConfig: {} });
  await flush(); assert.equal(esl.commands.some((c) => c.includes("uuid_answer pending_1")), true);
});
test("HTTP originate and DTMF routes enforce auth and canonical payloads", async () => {
  const calls: unknown[][] = [], active = new Set(["durable_http"]);
  const manager = {
    placeCall(...args: unknown[]) { calls.push(args); return { requestId: "request_1", callId: "durable_http" }; },
    sendCallDtmf(callId: string, digit: string) { if (!active.has(callId)) throw new Error("Active call not found"); calls.push([callId, digit]); },
  };
  const server = createWorkerServer({ manager: manager as never, authSecret: "worker-secret", isReady: () => true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 401);
    const payload = { config, callId: "durable_http", to: "+15551234567", session: { mediaBridgeUrl: "wss://bridge.example.test/media", mediaSessionToken: "secret", sessionConfig: { greeting: "hello" } } };
    const originated = await fetch(`${base}/v1/gateways/originate`, { method: "POST", headers: { authorization: "Bearer worker-secret", "content-type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(originated.status, 202); assert.deepEqual(await originated.json(), { accepted: true, requestId: "request_1", callId: "durable_http" });
    assert.deepEqual(calls[0], [config, "+15551234567", "durable_http", payload.session]);
    const missingTestSession = await fetch(`${base}/v1/gateways/test-call`, { method: "POST", headers: { authorization: "Bearer worker-secret", "content-type": "application/json" }, body: JSON.stringify({ config, callId: "test_1", to: "+15551234567" }) });
    assert.equal(missingTestSession.status, 400);
    const testCall = await fetch(`${base}/v1/gateways/test-call`, { method: "POST", headers: { authorization: "Bearer worker-secret", "content-type": "application/json" }, body: JSON.stringify({ ...payload, callId: "test_1" }) });
    assert.equal(testCall.status, 202); assert.deepEqual(calls[1], [config, "+15551234567", "test_1", payload.session, true]);
    const dtmf = await fetch(`${base}/v1/calls/durable_http/dtmf`, { method: "POST", headers: { authorization: "Bearer worker-secret", "content-type": "application/json" }, body: JSON.stringify({ digit: "#" }) });
    assert.equal(dtmf.status, 202); assert.deepEqual(calls[2], ["durable_http", "#"]);
    const missing = await fetch(`${base}/v1/calls/missing/dtmf`, { method: "POST", headers: { authorization: "Bearer worker-secret", "content-type": "application/json" }, body: JSON.stringify({ digit: "5" }) });
    assert.equal(missing.status, 404);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
test("inbound-session client parses the canonical authorization response", async () => {
  const api = (await import("node:http")).createServer((req, res) => {
    assert.equal(req.url, "/api/internal/freeswitch/inbound-session"); assert.equal(req.headers.authorization, "Bearer callback-secret");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ accepted: true, callId: "durable_api", freeswitchUuid: "fs_api", mediaBridgeUrl: "wss://bridge.example.test/media", mediaSessionToken: "private", sessionConfig: { locale: "en" } }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  try {
    const client = new CallbackClient(`http://127.0.0.1:${(api.address() as AddressInfo).port}/api/internal/freeswitch/callback`, "callback-secret");
    const result = await client.authorizeInbound({ tenantId: "tenant_1", botId: "bot_1", gatewayIdentity: "vox_tenant_1_bot_1", freeswitchUuid: "fs_api", from: "100", to: "1200", eventId: "event_1" });
    assert.equal(result.accepted, true); assert.equal(result.callId, "durable_api"); assert.equal(result.freeswitchUuid, "fs_api");
  } finally { await new Promise<void>((resolve) => api.close(() => resolve())); }
});
