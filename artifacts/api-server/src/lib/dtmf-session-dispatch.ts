import { createHmac } from "node:crypto";

export type DtmfSessionEvent = {
  tenantId: string;
  botId: string;
  callId: string;
  freeswitchUuid: string;
  digit: string;
  eventId: string | null;
};

export type DtmfSessionConsumer = (event: DtmfSessionEvent) => void | Promise<void>;

const consumers = new Set<DtmfSessionConsumer>();

export class DtmfSessionDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DtmfSessionDeliveryError";
  }
}

function deliveryUrl(): string | null {
  return process.env.MEDIA_BRIDGE_DTMF_URL?.trim() || null;
}

async function deliverToMediaService(event: DtmfSessionEvent): Promise<void> {
  const target = deliveryUrl();
  if (!target) {
    if (process.env.NODE_ENV === "production") {
      throw new DtmfSessionDeliveryError("MEDIA_BRIDGE_DTMF_URL is required in production");
    }
    return;
  }
  const secret = process.env.MEDIA_BRIDGE_TOKEN_SECRET;
  if (!secret) throw new DtmfSessionDeliveryError("MEDIA_BRIDGE_TOKEN_SECRET is required for DTMF delivery");
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new DtmfSessionDeliveryError("MEDIA_BRIDGE_DTMF_URL is invalid");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new DtmfSessionDeliveryError("MEDIA_BRIDGE_DTMF_URL must use HTTPS in production");
  }
  if (process.env.NODE_ENV !== "production" && url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new DtmfSessionDeliveryError("HTTP MEDIA_BRIDGE_DTMF_URL is allowed only for localhost development");
  }
  const body = JSON.stringify(event);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${signature}` },
      body,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new DtmfSessionDeliveryError("Media session DTMF delivery failed");
  }
  if (!response.ok) throw new DtmfSessionDeliveryError(`Media session DTMF delivery returned HTTP ${response.status}`);
}

/** Registers the active voice-engine boundary that consumes inbound DTMF. */
export function registerDtmfSessionConsumer(consumer: DtmfSessionConsumer): () => void {
  consumers.add(consumer);
  return () => consumers.delete(consumer);
}

/** Dispatches only after the API has authenticated and resolved a durable session mapping. */
export async function dispatchDtmfToSession(event: DtmfSessionEvent): Promise<void> {
  await Promise.all([
    deliverToMediaService(event),
    ...[...consumers].map((consumer) => consumer(event)),
  ]);
}