/**
 * AES-256-GCM encryption for SIP passwords.
 *
 * Ciphertext is `iv_hex:auth_tag_hex:ciphertext_hex`. SIP credentials use a
 * separate environment variable and a domain-separated key derivation so they
 * cannot be decrypted with the provider-key encryption context.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { logger } from "./logger.js";

const ALGORITHM = "aes-256-gcm";
const SIP_KEY_ENV = "SIP_CREDENTIAL_SECRET";
const PROVIDER_KEY_ENV = "PROVIDER_KEY_SECRET";
const DOMAIN = "voxagent:sip-credentials:v1\0";
const DEV_SEED = "voxagent-dev-sip-credentials-NOT-for-production";

let keyCache: Buffer | null = null;
let warnedAboutFallback = false;

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(DOMAIN, "utf8").update(secret, "utf8").digest();
}

function getKey(): Buffer {
  if (keyCache) return keyCache;

  const secret = process.env[SIP_KEY_ENV];
  if (secret) {
    keyCache = deriveKey(secret);
    return keyCache;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${SIP_KEY_ENV} is required in production; set a high-entropy secret before storing SIP credentials.`,
    );
  }

  // Provider key material is a development-only compatibility fallback. The
  // domain prefix above ensures it never produces a provider API-key AES key.
  const devSecret = process.env[PROVIDER_KEY_ENV] ?? DEV_SEED;
  if (!warnedAboutFallback) {
    logger.warn(
      `${SIP_KEY_ENV} is not set; using a development-only domain-separated fallback.`,
    );
    warnedAboutFallback = true;
  }
  keyCache = deriveKey(devSecret);
  return keyCache;
}

export function encryptSipPassword(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ciphertext.toString("hex")}`;
}

/** Returns null for malformed or unauthenticated ciphertext; never logs it. */
export function decryptSipPassword(ciphertext: string): string | null {
  try {
    const [ivHex, tagHex, encryptedHex, ...extra] = ciphertext.split(":");
    if (!ivHex || !tagHex || !encryptedHex || extra.length > 0) return null;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) return null;
    const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Test-only cache reset when environment variables are changed. */
export function _resetSipCredentialKeyCache(): void {
  keyCache = null;
  warnedAboutFallback = false;
}