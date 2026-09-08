import { randomUUID } from "node:crypto";

export type SipConfig = {
  id?: string; tenantId?: string; botId?: string; enabled?: boolean;
  registrarHost: string; registrarPort?: number; transport?: "udp" | "tcp" | "tls" | "wss";
  sipDomain?: string | null; extension: string; authUsername: string; password?: string | null;
  displayName?: string | null; callerIdNumber?: string | null; registerExpirySeconds?: number;
  keepaliveIntervalSeconds?: number; codecs?: string[]; inboundDids?: string[];
  maxConcurrentCalls?: number; outboundEnabled?: boolean; outboundPrefix?: string | null;
  allowSelfSigned?: boolean; externalIp?: string | null;
  outboundProxyHost?: string | null; outboundProxyPort?: number | null; ptimeMs?: number;
  srtpMode?: "disabled" | "optional" | "required"; dtmfMode?: "rfc2833" | "sip_info" | "inband";
  natTraversal?: "none" | "stun" | "force_rport"; stunServer?: string | null; localBindIp?: string | null;
  rtpPortMin?: number; rtpPortMax?: number; answerDelayMs?: number; recordCalls?: boolean;
  mediaBridgeUrl?: string; mediaSessionToken?: string;
};
export type WorkerEvent = {
  eventId: string; tenantId: string; botId: string;
  registrationState?: "unregistered" | "registering" | "registered" | "failed";
  activeCalls?: number; lastError?: string | null; callId?: string; freeswitchUuid?: string;
  callState?: "ringing" | "answered" | "failed" | "ended";
  eventType?: "dtmf" | "media_attached" | "media_detached" | "log";
  dtmfDigit?: string; mediaState?: "attached" | "detached" | "failed";
  event?: { level: "debug" | "info" | "warn" | "error"; summary: string; direction?: "inbound" | "outbound"; methodResponse?: string };
};
export type InboundSessionRequest = { tenantId: string; botId: string; gatewayIdentity: string; freeswitchUuid: string; from: string; to: string; eventId: string };
export type InboundSession = { accepted: boolean; callId?: string; freeswitchUuid?: string; mediaBridgeUrl?: string; mediaSessionToken?: string; sessionConfig?: Record<string, unknown>; reason?: string };
export type MediaSession = { mediaBridgeUrl: string; mediaSessionToken: string; sessionConfig?: Record<string, unknown> };

/** ESL values are command-line tokens, never SIP display values or SDP. */
export function token(value: string, label = "value"): string {
  if (!/^[A-Za-z0-9_.:+@/-]{1,253}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
export function digits(value: string, label = "number"): string {
  if (!/^\+?[0-9*#]{1,32}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
export function gatewayName(config: SipConfig): string {
  const tenant = token(config.tenantId ?? "unknown", "tenant ID").replace(/[^A-Za-z0-9_]/g, "_");
  const bot = token(config.botId ?? config.id ?? "unknown", "bot ID").replace(/[^A-Za-z0-9_]/g, "_");
  return `vox_${tenant}_${bot}`;
}
export function gatewayIdentity(config: SipConfig): string {
  return `${token(config.registrarHost, "registrar host")}:${config.registrarPort ?? 5060}:${token(config.extension, "extension")}`;
}
export function xml(value: string): string { return value.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[c]!); }
export function redact(value: string): string { return value.replace(/(<param name="password" value=")[^"]*(")/gi, "$1[REDACTED]$2").replace(/((?:password|mediaSessionToken|token)[=:]?\s*["']?)[^,"'\s}]+/gi, "$1[REDACTED]"); }
export function parseBootstrap(value: unknown): SipConfig[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { configs?: unknown }).configs)) throw new Error("Config retrieval response requires configs");
  return (value as { configs: SipConfig[] }).configs;
}
export function originate(config: SipConfig, to: string, callId: string = randomUUID()): { command: string; callId: string } {
  if (!config.outboundEnabled && config.outboundEnabled !== undefined) throw new Error("Outbound calling disabled");
  const destination = `${config.outboundPrefix ?? ""}${digits(to, "destination")}`;
  const cid = digits(config.callerIdNumber ?? config.extension, "caller ID");
  const variables = `{origination_uuid=${token(callId, "call ID")},origination_caller_id_number=${cid},vox_bot_id=${token(config.botId ?? "", "bot ID")},vox_tenant_id=${token(config.tenantId ?? "", "tenant ID")}}`;
  return { callId, command: `bgapi originate ${variables}sofia/gateway/${gatewayName(config)}/${destination} &park` };
}
