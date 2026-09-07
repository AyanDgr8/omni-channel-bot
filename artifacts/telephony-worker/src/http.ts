import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { RegistrationManager } from "./registration.js";
import type { MediaSession, SipConfig } from "./protocol.js";

type Dependencies = { manager: RegistrationManager; authSecret: string; isReady: () => boolean };
const body = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  let data = ""; for await (const chunk of req) { data += String(chunk); if (data.length > 64 * 1024) throw new Error("Request too large"); }
  const parsed = data ? JSON.parse(data) : {}; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required"); return parsed;
};
const validConfig = (value: unknown): value is SipConfig => Boolean(value && typeof value === "object" && typeof (value as SipConfig).tenantId === "string" && typeof (value as SipConfig).botId === "string" && typeof (value as SipConfig).registrarHost === "string");
const validSession = (value: unknown): value is MediaSession => Boolean(value && typeof value === "object" && typeof (value as MediaSession).mediaBridgeUrl === "string" && typeof (value as MediaSession).mediaSessionToken === "string" && typeof (value as MediaSession).sessionConfig === "object");
export function createWorkerServer(deps: Dependencies): Server {
  return createServer(async (req, res) => {
    const reply = (code: number, value: unknown): void => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    if (req.headers.authorization !== `Bearer ${deps.authSecret}`) return reply(401, { error: "Unauthorized" });
    if (req.method === "GET" && req.url === "/health") return reply(deps.isReady() ? 200 : 503, { ok: deps.isReady(), ready: deps.isReady() });
    const dtmf = /^\/v1\/calls\/([^/]+)\/dtmf$/.exec(req.url ?? "");
    try {
      if (req.method === "POST" && dtmf) {
        const input = await body(req), digit = input.digit;
        if (typeof digit !== "string" || !/^[0-9A-D*#]$/i.test(digit)) throw new Error("digit must be one of 0-9, *, #, A-D");
        deps.manager.sendCallDtmf(decodeURIComponent(dtmf[1]!), digit); return reply(202, { accepted: true });
      }
      const action = /^\/v1\/gateways\/(reload|register|unregister|test-call|originate)$/.exec(req.url ?? "")?.[1];
      if (req.method !== "POST" || !action) return reply(404, { error: "Not found" });
      const input = await body(req), config = input.config;
      if (!validConfig(config)) throw new Error("tenantId, botId, registrarHost, and config are required");
      if (action === "reload") await deps.manager.reload(config);
      if (action === "register") await deps.manager.register(config);
      if (action === "unregister") await deps.manager.unregister(config);
      if (action === "originate") {
        if (typeof input.callId !== "string" || typeof input.to !== "string" || !validSession(input.session)) throw new Error("callId, to, and complete session are required");
        return reply(202, { accepted: true, ...deps.manager.placeCall(config, input.to, input.callId, input.session) });
      }
      if (action === "test-call") {
        if (typeof input.callId !== "string" || typeof input.to !== "string" || !validSession(input.session)) throw new Error("callId, to, and complete session are required");
        return reply(202, { accepted: true, ...deps.manager.placeCall(config, input.to, input.callId, input.session, true) });
      }
      return reply(202, { accepted: true, requestId: randomUUID() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request";
      return reply(message === "Active call not found" ? 404 : 400, { error: message });
    }
  });
}