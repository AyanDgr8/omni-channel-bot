import { createHmac, randomUUID } from "node:crypto";
import type { InboundSession, InboundSessionRequest, WorkerEvent } from "./protocol.js";
export function callbackHeaders(secret: string, body: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${secret}`, "x-vox-event-signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` };
}
export class CallbackClient {
  constructor(private readonly url: string, private readonly secret: string) {}
  async send(event: Omit<WorkerEvent, "eventId"> & { eventId?: string }): Promise<void> {
    const payload = JSON.stringify({ ...event, eventId: event.eventId ?? randomUUID() });
    const response = await fetch(this.url, { method: "POST", headers: callbackHeaders(this.secret, payload), body: payload, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Callback returned HTTP ${response.status}`);
  }
  async authorizeInbound(request: InboundSessionRequest): Promise<InboundSession> {
    const payload = JSON.stringify(request);
    const url = new URL(this.url);
    url.pathname = url.pathname.replace(/\/callback\/?$/, "/inbound-session");
    const response = await fetch(url, { method: "POST", headers: callbackHeaders(this.secret, payload), body: payload, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return { accepted: false, reason: `Inbound authorization returned HTTP ${response.status}` };
    const session = await response.json() as InboundSession;
    if (session.accepted !== true || !session.callId || session.freeswitchUuid !== request.freeswitchUuid || !session.mediaBridgeUrl || !session.mediaSessionToken || !session.sessionConfig) return { accepted: false, reason: session.reason ?? "Incomplete inbound media session" };
    return session;
  }
}
