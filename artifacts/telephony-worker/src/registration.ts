import { randomUUID } from "node:crypto";
import type { CallbackClient } from "./callback.js";
import type { EslClient, EslFrame } from "./esl.js";
import { gatewayIdentity, originate, token, type MediaSession, type SipConfig, gatewayName } from "./protocol.js";
import type { SofiaProvisioner } from "./sofia.js";

type State = "unregistered" | "registering" | "registered" | "failed";
type Agent = { config: SipConfig; fingerprint: string; state: State; retryMs: number; timer?: NodeJS.Timeout; calls: Set<string>; sessions: Set<string> };
type CallContext = { agent: Agent; callId: string; freeswitchUuid: string; mediaBridgeUrl?: string; mediaSessionToken?: string; sessionConfig?: Record<string, unknown> };
const registrationFailure = /(?:^|[^0-9])(401|403|407|408|503)(?:[^0-9]|$)/;
export function eventHeaders(frame: EslFrame): Record<string, string> {
  const h = { ...frame.headers }; for (const line of frame.body.split(/\r?\n/)) { const i = line.indexOf(":"); if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = decodeURIComponent(line.slice(i + 1).trim()); } return h;
}
export function validateDidPatterns(patterns: string[] = []): void {
  for (const pattern of patterns) if (!/^\+(?:[1-9][0-9]{7,14}|[1-9][0-9]{0,14}\*)$/.test(pattern)) throw new Error(`Invalid inbound DID pattern: ${pattern}`);
}
export function matchesInbound(config: SipConfig, toUser: string, destination: string): boolean {
  if (toUser === config.extension) return true;
  return (config.inboundDids ?? []).some((pattern) => pattern.endsWith("*") ? destination.startsWith(pattern.slice(0, -1)) : destination === pattern);
}
export class RegistrationManager {
  private agents = new Map<string, Agent>();
  private callOwners = new Map<string, CallContext>();
  private eventQueue: Promise<void> = Promise.resolve();
  constructor(private readonly esl: EslClient, private readonly callback: CallbackClient, private readonly provisioner?: SofiaProvisioner) {
    esl.on("frame", (frame: EslFrame) => { this.eventQueue = this.eventQueue.then(() => this.onFrame(frame)).catch(() => undefined); }); esl.on("ready", () => void this.reconcile());
  }
  private key(c: SipConfig): string { return `${token(c.tenantId ?? "", "tenant ID")}:${token(c.botId ?? "", "bot ID")}`; }
  private fingerprint(c: SipConfig): string { return JSON.stringify(c); }
  async reconcile(configs?: SipConfig[]): Promise<void> {
    if (configs) {
      const wanted = new Set(configs.map((c) => this.key(c)));
      for (const key of this.agents.keys()) if (!wanted.has(key)) await this.unregisterByKey(key);
      for (const config of configs) {
        const existing = this.agents.get(this.key(config));
        if (!existing || existing.fingerprint !== this.fingerprint(config)) await this.reload(config);
      }
      return;
    }
    for (const agent of this.agents.values()) if (agent.config.enabled) await this.provision(agent);
  }
  async reload(config: SipConfig): Promise<void> {
    validateDidPatterns(config.inboundDids);
    const key = this.key(config); const existing = this.agents.get(key);
    if (existing?.timer) clearTimeout(existing.timer);
    const agent: Agent = { config, fingerprint: this.fingerprint(config), state: "unregistered", retryMs: 1_000, calls: existing?.calls ?? new Set(), sessions: existing?.sessions ?? new Set() };
    this.agents.set(key, agent); await this.provision(agent);
  }
  async register(config: SipConfig): Promise<void> {
    let agent = this.agents.get(this.key(config));
    if (!agent || agent.fingerprint !== this.fingerprint(config)) { await this.reload(config); agent = this.agents.get(this.key(config)); }
    if (agent) this.requestRegister(agent);
  }
  async unregister(config: SipConfig): Promise<void> { await this.unregisterByKey(this.key(config)); }
  private async unregisterByKey(key: string): Promise<void> {
    const agent = this.agents.get(key); if (!agent) return; if (agent.timer) clearTimeout(agent.timer);
    try { await this.provisioner?.remove(agent.config); this.esl.command(`api sofia profile external killgw ${gatewayName(agent.config)}`); } catch { /* local deletion takes precedence while disconnected */ }
    this.agents.delete(key); await this.report(agent, "unregistered");
  }
  private async provision(agent: Agent): Promise<void> {
    if (!agent.config.enabled) return;
    agent.state = "registering"; await this.report(agent, "registering");
    try { await this.provisioner?.put(agent.config); this.esl.command("api reloadxml"); this.esl.command("api sofia profile external rescan"); }
    catch (error) { this.fail(agent, error instanceof Error ? error.message : "Gateway provisioning failed"); }
    // Deliberately no registered state here: only Sofia events/status establish it.
  }
  private requestRegister(agent: Agent): void {
    try { this.esl.command(`api sofia profile external register ${gatewayName(agent.config)}`); } catch (error) { this.fail(agent, error instanceof Error ? error.message : "Registration command failed"); }
  }
  private fail(agent: Agent, message: string): void {
    if (!this.agents.has(this.key(agent.config))) return;
    agent.state = "failed"; void this.report(agent, "failed", message);
    if (agent.timer) clearTimeout(agent.timer); const delay = agent.retryMs; agent.retryMs = Math.min(agent.retryMs * 2, 300_000);
    agent.timer = setTimeout(() => this.requestRegister(agent), delay); agent.timer.unref();
  }
  private registered(agent: Agent): void {
    agent.state = "registered"; agent.retryMs = 1_000; if (agent.timer) clearTimeout(agent.timer);
    agent.timer = setTimeout(() => this.requestRegister(agent), Math.max(1_000, Math.floor((agent.config.registerExpirySeconds ?? 300) * 800))); agent.timer.unref();
    void this.report(agent, "registered");
  }
  placeCall(config: SipConfig, to: string, callId?: string, session?: MediaSession, greeting = true): { requestId: string; callId: string } {
    const agent = this.agents.get(this.key(config)); if (!agent || agent.state !== "registered") throw new Error("SIP gateway is not registered");
    const built = originate(config, to, callId); if (agent.calls.has(built.callId)) return { requestId: built.callId, callId: built.callId };
    agent.calls.add(built.callId); this.callOwners.set(built.callId, { agent, callId: built.callId, freeswitchUuid: built.callId, mediaBridgeUrl: session?.mediaBridgeUrl ?? config.mediaBridgeUrl, mediaSessionToken: session?.mediaSessionToken ?? config.mediaSessionToken, sessionConfig: session?.sessionConfig });
    this.esl.command(built.command.replace(" &park", greeting ? " &park" : " &park"));
    void this.event(agent, "info", "Outbound call requested", "outbound", this.callOwners.get(built.callId)); return { requestId: randomUUID(), callId: built.callId };
  }
  sendDtmf(config: SipConfig, uuid: string, tones: string): void { if (!/^[0-9A-D*#w]{1,64}$/i.test(tones)) throw new Error("Invalid DTMF tones"); this.esl.command(`api uuid_send_dtmf ${token(uuid, "call UUID")} ${tones}`); }
  sendCallDtmf(callId: string, digit: string): void {
    if (!/^[0-9A-D*#]$/i.test(digit)) throw new Error("Invalid DTMF digit");
    const call = [...this.callOwners.values()].find((item) => item.callId === callId);
    if (!call || !call.agent.calls.has(call.freeswitchUuid)) throw new Error("Active call not found");
    this.esl.command(`api uuid_send_dtmf ${token(call.freeswitchUuid, "call UUID")} ${digit}`);
  }
  private async report(agent: Agent, state: State, error: string | null = null): Promise<void> { await this.callback.send({ tenantId: agent.config.tenantId!, botId: agent.config.botId!, registrationState: state, activeCalls: agent.calls.size, lastError: error }); }
  private async event(agent: Agent, level: "debug" | "info" | "warn" | "error", summary: string, direction?: "inbound" | "outbound", call?: CallContext, callState?: "ringing" | "answered" | "failed" | "ended", eventType?: "dtmf" | "media_attached" | "media_detached" | "log", dtmfDigit?: string): Promise<void> {
    await this.callback.send({ tenantId: agent.config.tenantId!, botId: agent.config.botId!, activeCalls: agent.calls.size, callId: call?.callId, freeswitchUuid: call?.freeswitchUuid, callState, eventType, dtmfDigit, mediaState: eventType === "media_attached" ? "attached" : eventType === "media_detached" ? "detached" : undefined, event: { level, summary, direction } });
  }
  private async onFrame(frame: EslFrame): Promise<void> {
    const h = eventHeaders(frame), name = h["event-name"], gateway = h["gateway-name"] ?? h["variable_sip_gateway_name"] ?? h["variable_sip_gateway"];
    const subclass = h["event-subclass"]?.toLowerCase();
    if (subclass === "sofia::register" || subclass === "sofia::gateway_state" || name === "SOFIA::REGISTER") {
      const gatewayId = gateway ?? h.gateway;
      const agent = [...this.agents.values()].find((a) => gatewayId === gatewayName(a.config) && (h["profile-name"] ?? h["sofia-profile-name"] ?? "external") === "external");
      if (!agent) return;
      const status = `${h.state ?? h.status ?? h["reply-text"] ?? frame.body}`;
      if (registrationFailure.test(status) || /\b(?:failed|failure|fail_wait|error|denied|expired)\b/i.test(status)) this.fail(agent, status.replace(/[\r\n]/g, " ").slice(0, 300));
      else if (/\b(?:reged|registered|success|ok)\b/i.test(status)) this.registered(agent);
      return;
    }
    if (!name) return; const uuid = h["unique-id"] ?? h["caller-unique-id"]; if (!uuid) return;
    // An inbound call must identify a provisioned gateway. Extension/DID matching is scoped to it.
    const inbound = h["call-direction"] === "inbound";
    const existingCall = this.callOwners.get(uuid);
    const agent = existingCall?.agent ?? [...this.agents.values()].find((a) => gateway === gatewayName(a.config) && (!inbound || matchesInbound(a.config, h["variable_sip_to_user"] ?? "", h["variable_destination_number"] ?? "")));
    if (!agent) return;
    if (name === "CHANNEL_CREATE") {
      if (inbound && agent.calls.size >= (agent.config.maxConcurrentCalls ?? 1)) { this.esl.command(`api uuid_kill ${token(uuid, "call UUID")} 486`); await this.event(agent, "warn", "Inbound call rejected: concurrency limit", "inbound"); return; }
      let call: CallContext;
      if (inbound) {
        const session = await this.callback.authorizeInbound({ tenantId: agent.config.tenantId!, botId: agent.config.botId!, gatewayIdentity: gatewayIdentity(agent.config), freeswitchUuid: uuid, from: h["caller-caller-id-number"] ?? h["variable_sip_from_user"] ?? "", to: h["variable_destination_number"] ?? h["variable_sip_to_user"] ?? "", eventId: randomUUID() });
        if (session.accepted !== true || !session.callId || session.freeswitchUuid !== uuid || !session.mediaBridgeUrl || !session.mediaSessionToken || !session.sessionConfig) { this.esl.command(`api uuid_kill ${token(uuid, "call UUID")} 486`); return; }
        call = { agent, callId: session.callId, freeswitchUuid: uuid, mediaBridgeUrl: session.mediaBridgeUrl, mediaSessionToken: session.mediaSessionToken, sessionConfig: session.sessionConfig };
      } else call = existingCall ?? { agent, callId: h["variable_vox_call_id"] ?? uuid, freeswitchUuid: uuid, mediaBridgeUrl: agent.config.mediaBridgeUrl, mediaSessionToken: agent.config.mediaSessionToken };
      agent.calls.add(uuid); this.callOwners.set(uuid, call);
      if (inbound) this.esl.command(`api uuid_answer ${token(uuid, "call UUID")}`);
      await this.event(agent, "info", inbound ? "Inbound call authorized" : "Outbound call requested", inbound ? "inbound" : "outbound", call);
    } else if (name === "CHANNEL_PROGRESS") await this.event(agent, "info", "Call ringing", inbound ? "inbound" : "outbound", existingCall, "ringing");
    else if (name === "CHANNEL_ANSWER" && existingCall) { this.attachMedia(existingCall); await this.event(agent, "info", "Call answered", inbound ? "inbound" : "outbound", existingCall, "answered"); }
    else if (name === "DTMF" && existingCall) { const digit = String(h["dtmf-digit"] ?? "").replace(/[^0-9A-D*#]/gi, ""); await this.event(agent, "info", "DTMF received", inbound ? "inbound" : "outbound", existingCall, undefined, "dtmf", digit); }
    else if ((name === "CHANNEL_HANGUP" || name === "CHANNEL_HANGUP_COMPLETE") && existingCall) { this.detachMedia(existingCall); agent.calls.delete(uuid); this.callOwners.delete(uuid); const failed = Boolean(h["hangup-cause"] && !["NORMAL_CLEARING", "ORIGINATOR_CANCEL"].includes(h["hangup-cause"])); await this.event(agent, failed ? "error" : "info", failed ? `Call failed: ${h["hangup-cause"]}` : "Call ended", inbound ? "inbound" : "outbound", existingCall, failed ? "failed" : "ended"); }
  }
  private attachMedia(call: CallContext): void {
    const { agent, freeswitchUuid: uuid } = call; if (!call.mediaBridgeUrl || !call.mediaSessionToken || agent.sessions.has(uuid)) return;
    const url = new URL(call.mediaBridgeUrl); if (url.protocol !== "wss:" && url.protocol !== "https:") return;
    agent.sessions.add(uuid); const metadata = Buffer.from(JSON.stringify({ tenantId: agent.config.tenantId, botId: agent.config.botId, callId: call.callId, freeswitchUuid: uuid, sampleRate: 16000, encoding: "pcm_s16le", token: call.mediaSessionToken, sessionConfig: call.sessionConfig })).toString("base64url");
    this.esl.command(`api uuid_audio_fork ${token(uuid, "call UUID")} start ${token(url.host, "media bridge host")}${token(url.pathname || "/", "media bridge path")} ${metadata}`);
    void this.event(agent, "info", "Media bridge attached", undefined, call, undefined, "media_attached");
  }
  private detachMedia(call: CallContext): void { if (call.agent.sessions.delete(call.freeswitchUuid)) { this.esl.command(`api uuid_audio_fork ${token(call.freeswitchUuid, "call UUID")} stop`); void this.event(call.agent, "info", "Media bridge detached", undefined, call, undefined, "media_detached"); } }
}
