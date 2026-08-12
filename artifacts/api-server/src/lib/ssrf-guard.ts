/**
 * SSRF guard for user-controlled URL inputs (e.g. provider baseUrl).
 *
 * Call sites:
 *  - routes/providers.ts  POST/PATCH  — before persisting any custom baseUrl
 *  - provider-registry.ts  — ssrfSafeFetch() wraps all outbound calls for custom URLs
 *  - routes/providers.ts  POST /:id/test-key — before connectivity test
 *
 * DNS-rebinding protection strategy
 * -----------------------------------
 * Validate-then-fetch has an inherent TOCTOU window: the hostname resolves to a
 * public IP at validation time, but DNS can rebind to a private IP before the TCP
 * connection is made.  `redirect:"error"` does not close this window.
 *
 * The correct approach (implemented in ssrfSafeFetch):
 *  1. Resolve ALL A and AAAA records for the hostname.
 *  2. Reject if ANY returned address is private/reserved.
 *  3. Pin the connection to the first vetted IP by replacing the hostname in the
 *     URL with the IP address, and setting the Host header to preserve TLS SNI and
 *     virtual hosting.
 *  4. Use redirect:"error" so a redirect cannot introduce a new hostname.
 *
 * validateBaseUrl() is still called at store time so operators get early errors
 * and bad URLs never reach the database.  But all runtime outbound requests MUST
 * go through ssrfSafeFetch() — that is the binding protection.
 */

import { resolve } from "dns/promises";
import { lookup } from "dns/promises";

// ─── IPv4 range table ────────────────────────────────────────────────────────

const PRIVATE_V4_RANGES: Array<{ base: number; mask: number }> = [
  { base: cidrBase("10.0.0.0"),       mask: 0xff000000 },  // 10.0.0.0/8
  { base: cidrBase("172.16.0.0"),     mask: 0xfff00000 },  // 172.16.0.0/12
  { base: cidrBase("192.168.0.0"),    mask: 0xffff0000 },  // 192.168.0.0/16
  { base: cidrBase("127.0.0.0"),      mask: 0xff000000 },  // 127.0.0.0/8  loopback
  { base: cidrBase("169.254.0.0"),    mask: 0xffff0000 },  // 169.254.0.0/16 link-local
  { base: cidrBase("0.0.0.0"),        mask: 0xff000000 },  // 0.0.0.0/8 "this" network
  { base: cidrBase("100.64.0.0"),     mask: 0xffc00000 },  // 100.64.0.0/10 CGNAT
  { base: cidrBase("192.0.2.0"),      mask: 0xffffff00 },  // 192.0.2.0/24 TEST-NET-1
  { base: cidrBase("198.51.100.0"),   mask: 0xffffff00 },  // 198.51.100.0/24 TEST-NET-2
  { base: cidrBase("203.0.113.0"),    mask: 0xffffff00 },  // 203.0.113.0/24 TEST-NET-3
  { base: cidrBase("240.0.0.0"),      mask: 0xf0000000 },  // 240.0.0.0/4 reserved
  { base: cidrBase("255.255.255.255"),mask: 0xffffffff },   // broadcast
];

function cidrBase(ip: string): number {
  const p = ip.split(".").map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function isPrivateV4(ip: string): boolean {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return false;
  const addr = cidrBase(ip);
  return PRIVATE_V4_RANGES.some(({ base, mask }) => (addr & mask) >>> 0 === base);
}

// ─── IPv6 classification ─────────────────────────────────────────────────────

/**
 * Classify a BARE IPv6 address (no brackets, already lower-cased).
 *
 * Ranges blocked:
 *  ::1             — loopback (RFC 4291)
 *  ::              — unspecified (RFC 4291)
 *  fc00::/7        — unique-local ULA (covers fc:: and fd::)
 *  fe80::/10       — link-local (fe80:: through febf::, third nibble 8-b)
 *  ::ffff:x.x.x.x  — IPv4-mapped; recheck the embedded IPv4 address
 *  64:ff9b::/96    — IPv4/IPv6 translation (RFC 6052)
 *  100::/64        — discard (RFC 6666)
 */
function isPrivateV6Bare(ip: string): boolean {
  // Loopback and unspecified
  if (ip === "::1" || ip === "::") return true;

  // fc00::/7 unique-local (ULA) — first byte is fc or fd
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true;

  // fe80::/10 link-local — covers fe80:: through febf::
  // Third hex nibble in 'fe??:...' must be 8, 9, a, or b for the 10-bit prefix.
  if (ip.startsWith("fe")) {
    const thirdNibble = ip[2]?.toLowerCase();
    if (thirdNibble && "89ab".includes(thirdNibble)) return true;
  }

  // IPv4-mapped: ::ffff:x.x.x.x  (DNS may return this for dual-stack hosts)
  if (ip.startsWith("::ffff:")) {
    const v4Part = ip.slice(7);
    // Dotted-decimal notation e.g. ::ffff:192.168.1.1
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4Part)) {
      return isPrivateV4(v4Part);
    }
    // Hex-group notation e.g. ::ffff:c0a8:0101 (= 192.168.1.1)
    const hexParts = v4Part.split(":");
    if (hexParts.length === 2) {
      const high = hexParts[0].padStart(4, "0");
      const low  = hexParts[1].padStart(4, "0");
      const a = parseInt(high.slice(0, 2), 16);
      const b = parseInt(high.slice(2, 4), 16);
      const c = parseInt(low.slice(0, 2), 16);
      const d = parseInt(low.slice(2, 4), 16);
      return isPrivateV4(`${a}.${b}.${c}.${d}`);
    }
  }

  // 64:ff9b::/96 — NAT64 translation prefix; embedded IPv4 should be checked.
  // Handles both dotted-decimal (64:ff9b::192.168.1.1) and hex-group notation
  // (64:ff9b::c0a8:0101 = 192.168.1.1) to prevent NAT64 bypass attacks.
  if (ip.startsWith("64:ff9b::")) {
    const suffix = ip.slice("64:ff9b::".length);
    // Dotted-decimal e.g. 64:ff9b::192.168.1.1
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(suffix)) {
      return isPrivateV4(suffix);
    }
    // Hex-group e.g. 64:ff9b::c0a8:0101  (two 16-bit groups = one IPv4 address)
    const hexParts = suffix.split(":");
    if (hexParts.length === 2) {
      const high = hexParts[0].padStart(4, "0");
      const low  = hexParts[1].padStart(4, "0");
      const a = parseInt(high.slice(0, 2), 16);
      const b = parseInt(high.slice(2, 4), 16);
      const c = parseInt(low.slice(0, 2), 16);
      const d = parseInt(low.slice(2, 4), 16);
      if (!isNaN(a) && !isNaN(b) && !isNaN(c) && !isNaN(d)) {
        return isPrivateV4(`${a}.${b}.${c}.${d}`);
      }
    }
  }

  // 100::/64 — discard prefix (RFC 6666)
  if (ip.startsWith("100:") || ip === "100::") return true;

  return false;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Strip RFC-2732 brackets from bracketed IPv6 literals.
 * url.hostname for "http://[::1]/api" returns "[::1]", not "::1".
 */
function stripBrackets(s: string): string {
  return s.startsWith("[") && s.endsWith("]") ? s.slice(1, -1) : s;
}

/**
 * Returns true if the IP address (v4 or v6, with or without brackets) is
 * private, loopback, link-local, or otherwise restricted.
 * Exported for unit testing.
 */
export function isPrivateIp(ip: string): boolean {
  const clean = stripBrackets(ip).toLowerCase();
  return isPrivateV4(clean) || isPrivateV6Bare(clean);
}

// ─── Resolve all addresses (A + AAAA) ────────────────────────────────────────

async function resolveAllAddresses(hostname: string): Promise<string[]> {
  const [v4Result, v6Result] = await Promise.allSettled([
    resolve(hostname, "A"),
    resolve(hostname, "AAAA"),
  ]);
  return [
    ...(v4Result.status === "fulfilled" ? v4Result.value : []),
    ...(v6Result.status === "fulfilled" ? v6Result.value : []),
  ];
}

// ─── Validate URL (store-time check) ─────────────────────────────────────────

/**
 * Validate that a custom provider base URL is safe to connect to.
 *
 * This is a store-time guard — it catches obviously bad URLs before they reach
 * the database.  Runtime protection is handled by ssrfSafeFetch().
 *
 * Throws a human-readable Error if the URL:
 * - Uses a non-http(s) scheme
 * - Has a hostname that is or resolves to a private/reserved address (all answers)
 * - Cannot be resolved via DNS
 */
export async function validateBaseUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Custom endpoint must use http(s); got scheme: ${url.protocol}`);
  }

  // url.hostname includes brackets for IPv6: "[::1]" → strip them.
  const hostname = url.hostname;
  const bareHostname = stripBrackets(hostname);

  // Raw IPv4 address in URL — check immediately
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bareHostname)) {
    if (isPrivateIp(bareHostname)) {
      throw new Error(`Custom endpoint points to a private/reserved IPv4 address: ${bareHostname}`);
    }
    return;
  }

  // Raw IPv6 address in URL (bare, after bracket strip) — check immediately
  if (bareHostname.includes(":")) {
    if (isPrivateIp(bareHostname)) {
      throw new Error(`Custom endpoint points to a private/reserved IPv6 address: ${bareHostname}`);
    }
    return;
  }

  // Hostname — resolve ALL A and AAAA answers and reject if any is private
  let addresses: string[];
  try {
    addresses = await resolveAllAddresses(bareHostname);
  } catch (err) {
    throw new Error(
      `Cannot resolve hostname ${bareHostname}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (addresses.length === 0) {
    throw new Error(`No DNS records found for hostname: ${bareHostname}`);
  }

  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new Error(
        `Custom endpoint ${bareHostname} resolves to a private/reserved address (${addr}). ` +
          "Only publicly routable endpoints are permitted."
      );
    }
  }
}

// ─── SSRF-safe runtime fetch ──────────────────────────────────────────────────

import https from "node:https";
import http from "node:http";
import { IncomingMessage } from "node:http";

/**
 * An SSRF-safe replacement for fetch() for custom (tenant-supplied) provider URLs.
 *
 * Security guarantees:
 *  1. Resolves ALL A + AAAA records; rejects if any is private.  This closes
 *     the multi-answer attack (one safe record + one internal record).
 *  2. Pins the TCP connection to the vetted IP via a custom Agent.lookup()
 *     callback.  The callback intercepts OS DNS resolution and always returns the
 *     pre-validated address — no re-resolution happens at connect time.
 *  3. The original hostname is preserved for the HTTPS request so TLS SNI and
 *     certificate validation use the correct name (not the IP address).
 *  4. Redirects are not followed — HTTP 3xx causes an immediate error.
 *
 * This uses Node.js `http.request` / `https.request` directly so that the
 * lookup() hook is honoured; the global `fetch` API does not expose a DNS
 * override path in Node 24 without importing undici directly.
 *
 * Only for use with custom (tenant-supplied) base URLs.
 */
export async function ssrfSafeFetch(rawUrl: string, init: RequestInit): Promise<Response> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Only http/https URLs are allowed; got: ${url.protocol}`);
  }

  const hostname = url.hostname;
  const bareHostname = stripBrackets(hostname);
  let pinnedIp: string;

  // For raw IPs in the URL: validate in place (no DNS needed, no rebinding possible).
  const isRawIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(bareHostname);
  const isRawIpv6 = bareHostname.includes(":");

  if (isRawIpv4 || isRawIpv6) {
    if (isPrivateIp(bareHostname)) {
      throw new Error(`Blocked: endpoint points to a private/reserved address: ${bareHostname}`);
    }
    pinnedIp = bareHostname; // already an IP, use directly
  } else {
    // Hostname: resolve ALL A + AAAA records, reject if any is private.
    let addresses: string[];
    try {
      addresses = await resolveAllAddresses(bareHostname);
    } catch (err) {
      throw new Error(
        `Cannot resolve hostname ${bareHostname}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (addresses.length === 0) {
      throw new Error(`No DNS records returned for: ${bareHostname}`);
    }

    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        throw new Error(
          `Blocked: ${bareHostname} resolves to a private/reserved address (${addr})`
        );
      }
    }

    pinnedIp = addresses[0]; // use first vetted address
  }

  // Build custom agent that pins DNS to the pre-validated IP.
  // The lookup() callback is called by the HTTP/HTTPS stack instead of the OS DNS,
  // so the connection goes to pinnedIp while the URL still carries the original
  // hostname for TLS SNI and virtual-host routing.
  const isHttps = url.protocol === "https:";
  const family = pinnedIp.includes(":") ? 6 : 4;
  const lookupFn = (
    _: string,
    __: { family?: number; hints?: number; all?: boolean; verbatim?: boolean },
    callback: (err: Error | null, address: string, family: number) => void
  ) => callback(null, pinnedIp, family);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = isHttps
    ? new https.Agent({ lookup: lookupFn as any })
    : new http.Agent({ lookup: lookupFn as any });

  // Collect headers from RequestInit
  const reqHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (init.headers) {
    const h = new Headers(init.headers as HeadersInit);
    h.forEach((v, k) => { reqHeaders[k] = v; });
  }

  // Parse method and body
  const method = (init.method ?? "GET").toUpperCase();
  const bodyStr = init.body != null ? String(init.body) : undefined;

  const reqOptions: http.RequestOptions = {
    hostname: bareHostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: {
      ...reqHeaders,
      ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr).toString() } : {}),
    },
    agent,
  };

  // Make the request, reject on 3xx redirects.
  return new Promise<Response>((resolve, reject) => {
    const signal = init.signal as AbortSignal | undefined | null;
    const requestFn = isHttps ? https.request : http.request;

    const req = requestFn(reqOptions, (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;

      // Reject redirects — prevents redirect-based SSRF bypasses.
      if (status >= 300 && status < 400) {
        req.destroy();
        reject(new Error(`Redirect (${status}) from custom endpoint is not allowed (SSRF protection)`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const responseHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v) responseHeaders.set(k, Array.isArray(v) ? v.join(", ") : v);
        }
        resolve(new Response(body, { status, headers: responseHeaders }));
      });
      res.on("error", reject);
    });

    req.on("error", reject);

    if (signal) {
      const onAbort = () => { req.destroy(); reject(new Error("Request aborted")); };
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => signal.removeEventListener("abort", onAbort));
    }

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
