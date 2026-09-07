import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gatewayName, token, xml, type SipConfig } from "./protocol.js";

const bool = (v: boolean | undefined): string => v ? "true" : "false";
const safe = (v: string | null | undefined, label: string): string => v ? token(v, label) : "";
/** Generates a single gateway file; credentials are XML escaped and never logged. */
export function gatewayXml(config: SipConfig): string {
  const host = token(config.registrarHost, "registrar host"), name = gatewayName(config);
  const transport = config.transport ?? "udp", port = config.registrarPort ?? (transport === "tls" ? 5061 : 5060);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid registrar port");
  const codecs = (config.codecs ?? ["PCMU", "PCMA"]).map((v) => token(v, "codec")).join(",");
  const srtp = config.srtpMode ?? "disabled"; if (!["disabled", "optional", "required"].includes(srtp)) throw new Error("Invalid SRTP mode");
  const dtmf = config.dtmfMode ?? "rfc2833"; if (!["rfc2833", "sip_info", "inband"].includes(dtmf)) throw new Error("Invalid DTMF mode");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<include><gateway name="${xml(name)}">\n` +
    `<param name="proxy" value="${xml(host)}:${port}"/><param name="realm" value="${xml(config.sipDomain || host)}"/>` +
    `<param name="username" value="${xml(token(config.authUsername, "auth username"))}"/><param name="password" value="${xml(config.password ?? "")}"/>` +
    `<param name="register" value="true"/><param name="register-transport" value="${xml(transport)}"/><param name="expire-seconds" value="${config.registerExpirySeconds ?? 300}"/>` +
    `<param name="options-ping" value="${config.keepaliveIntervalSeconds ?? 30}"/><param name="codec-prefs" value="${xml(codecs)}"/><param name="inbound-codec-prefs" value="${xml(codecs)}"/>` +
    `<param name="rtp-timer-name" value="soft"/><param name="ptime" value="${config.ptimeMs ?? 20}"/><param name="rtp_secure_media" value="${xml(srtp === "required" ? "mandatory" : srtp)}"/><param name="dtmf-type" value="${dtmf === "sip_info" ? "info" : dtmf}"/>` +
    `<param name="aggressive-nat-detection" value="${bool(config.natTraversal !== undefined && config.natTraversal !== "none")}"/><param name="sip-sticky-contact" value="${bool(config.natTraversal !== undefined && config.natTraversal !== "none")}"/>` +
    (config.stunServer ? `<param name="stun-server" value="${xml(safe(config.stunServer, "STUN server"))}"/>` : "") +
    (config.outboundProxyHost ? `<param name="outbound-proxy" value="${xml(safe(config.outboundProxyHost, "outbound proxy"))}:${config.outboundProxyPort ?? 5060}"/>` : "") +
    (transport === "tls" ? `<param name="tls-verify-date" value="true"/><param name="tls-verify-policy" value="${config.allowSelfSigned ? "none" : "all"}"/>` : "") +
    `</gateway></include>\n`;
}
export class SofiaProvisioner {
  constructor(private readonly directory: string, private readonly reload: () => void) {}
  async put(config: SipConfig): Promise<void> { await mkdir(this.directory, { recursive: true, mode: 0o700 }); await writeFile(join(this.directory, `${gatewayName(config)}.xml`), gatewayXml(config), { encoding: "utf8", mode: 0o600 }); this.reload(); }
  async remove(config: SipConfig): Promise<void> { await rm(join(this.directory, `${gatewayName(config)}.xml`), { force: true }); this.reload(); }
}