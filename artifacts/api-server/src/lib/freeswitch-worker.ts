import { decryptSipPassword } from "./sip-credential-crypto.js";
import { dtmfRequestSchema, originateRequestSchema } from "./freeswitch-protocol.js";

const workerUrl = (): string | null => process.env.FREESWITCH_WORKER_URL?.replace(/\/$/, "") || null;

export class FreeSwitchWorkerUnavailableError extends Error {
  constructor(message = "FreeSWITCH worker is not configured or unavailable") {
    super(message);
  }
}

async function request(path: string, body?: unknown): Promise<{ requestId?: string }> {
  const baseUrl = workerUrl();
  if (!baseUrl) throw new FreeSwitchWorkerUnavailableError("FreeSWITCH worker is not configured");
  const url = new URL(baseUrl);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new FreeSwitchWorkerUnavailableError("FreeSWITCH worker URL must use HTTPS in production");
  }
  if (process.env.NODE_ENV !== "production" && url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new FreeSwitchWorkerUnavailableError("HTTP FreeSWITCH worker URLs are allowed only for localhost development");
  }
  const token = process.env.FREESWITCH_WORKER_AUTH_SECRET;
  if (!token) throw new FreeSwitchWorkerUnavailableError("FreeSWITCH worker authentication is not configured");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new FreeSwitchWorkerUnavailableError();
  }
  if (!response.ok) throw new FreeSwitchWorkerUnavailableError(`FreeSWITCH worker returned HTTP ${response.status}`);
  const data = await response.json().catch(() => ({})) as { requestId?: string };
  return data;
}

export function workerEnabled(): boolean {
  return Boolean(workerUrl() && process.env.FREESWITCH_WORKER_AUTH_SECRET);
}

export async function workerHealth(): Promise<{ enabled: boolean; reachable: boolean; error: string | null }> {
  if (!workerEnabled()) return { enabled: false, reachable: false, error: "FreeSWITCH worker is not configured" };
  try {
    await request("/health");
    return { enabled: true, reachable: true, error: null };
  } catch (error) {
    return { enabled: true, reachable: false, error: error instanceof Error ? error.message : "Worker unavailable" };
  }
}

export async function controlFreeSwitch(
  action: "register" | "unregister" | "reload" | "test-call",
  config: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<{ requestId?: string }> {
  const encrypted = config.passwordEncrypted;
  const password = typeof encrypted === "string" ? decryptSipPassword(encrypted) : null;
  if (encrypted && !password) throw new FreeSwitchWorkerUnavailableError("Stored SIP credential cannot be decrypted");
  const { passwordEncrypted: _encrypted, ...safeConfig } = config;
  return request(`/v1/gateways/${action}`, { ...extra, config: { ...safeConfig, password } });
}

export async function originateFreeSwitchWithSession(
  config: Record<string, unknown>,
  callId: string,
  to: string,
  session: { mediaBridgeUrl: string; mediaSessionToken: string; sessionConfig: Record<string, unknown> },
): Promise<{ requestId?: string }> {
  const encrypted = config.passwordEncrypted;
  const password = typeof encrypted === "string" ? decryptSipPassword(encrypted) : null;
  if (encrypted && !password) throw new FreeSwitchWorkerUnavailableError("Stored SIP credential cannot be decrypted");
  const { passwordEncrypted: _encrypted, ...safeConfig } = config;
  const body = originateRequestSchema.parse({ config: { ...safeConfig, password }, callId, to, session });
  return request("/v1/gateways/originate", body);
}

export async function sendFreeSwitchDtmf(config: Record<string, unknown>, callId: string, digit: string): Promise<{ requestId?: string }> {
  const encrypted = config.passwordEncrypted;
  const password = typeof encrypted === "string" ? decryptSipPassword(encrypted) : null;
  const { passwordEncrypted: _encrypted, ...safeConfig } = config;
  const body = dtmfRequestSchema.parse({ config: { ...safeConfig, password }, digit });
  return request(`/v1/calls/${encodeURIComponent(callId)}/dtmf`, body);
}