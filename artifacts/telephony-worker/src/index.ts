import { EslClient } from "./esl.js";
import { CallbackClient } from "./callback.js";
import { RegistrationManager } from "./registration.js";
import { parseBootstrap } from "./protocol.js";
import { SofiaProvisioner } from "./sofia.js";
import { createWorkerServer } from "./http.js";

const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const auth = required("FREESWITCH_WORKER_AUTH_SECRET");
const callback = new CallbackClient(required("FREESWITCH_CALLBACK_URL"), required("FREESWITCH_WORKER_CALLBACK_SECRET"));
const esl = new EslClient({ host: required("FREESWITCH_ESL_HOST"), port: Number(process.env.FREESWITCH_ESL_PORT ?? 8021), password: required("FREESWITCH_ESL_PASSWORD"), tls: process.env.FREESWITCH_ESL_TLS === "true", rejectUnauthorized: process.env.FREESWITCH_ESL_REJECT_UNAUTHORIZED !== "false" });
const provisioner = new SofiaProvisioner(required("FREESWITCH_SOFIA_GATEWAY_DIR"), () => { esl.command("api reloadxml"); esl.command("api sofia profile external rescan"); });
const manager = new RegistrationManager(esl, callback, provisioner); esl.connect();
const configUrl = required("FREESWITCH_CONFIG_URL");
const bootstrap = async (): Promise<void> => {
  const response = await fetch(configUrl, { headers: { authorization: `Bearer ${auth}` }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Config retrieval returned HTTP ${response.status}`);
  await manager.reconcile(parseBootstrap(await response.json()));
};
void bootstrap().catch(() => undefined);
const reconcileTimer = setInterval(() => { void bootstrap().catch(() => undefined); }, Number(process.env.FREESWITCH_RECONCILE_MS ?? 60_000));
const server = createWorkerServer({ manager, authSecret: auth, isReady: () => esl.connected });
server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? "0.0.0.0");
const shutdown = (): void => { clearInterval(reconcileTimer); server.close(() => process.exit(0)); esl.close(); setTimeout(() => process.exit(1), 10_000).unref(); };
process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);