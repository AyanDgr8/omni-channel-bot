/**
 * AES-256-GCM encryption/decryption for provider API keys.
 *
 * Keys are stored as:  <iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 *
 * The AES-256 key is derived from PROVIDER_KEY_SECRET via SHA-256 so the
 * input length doesn't constrain security.
 *
 * Production requirement: set PROVIDER_KEY_SECRET to a high-entropy string
 * (≥32 random chars from a CSPRNG). If it is absent in production
 * (NODE_ENV=production), any attempt to store a new key throws rather than
 * silently downgrading to an insecure fallback.
 *
 * Development: a fixed seed is used so keys survive server restarts; a
 * warning is logged on every startup so engineers know to set the variable
 * before going live.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { logger } from "./logger.js";

const ALGORITHM = "aes-256-gcm";
const KEY_ENV = "PROVIDER_KEY_SECRET";

// A human-memorable sentinel so dev builds log a visible warning.
const DEV_SEED = "voxagent-dev-seed-NOT-for-production";

let _keyCache: Buffer | null = null;
let _warnedAboutFallback = false;

/**
 * Derive a 32-byte AES-256 key from a secret string via SHA-256.
 * SHA-256 on arbitrary-length input → always 32 bytes, no truncation/padding.
 */
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function getKey(): Buffer {
  if (_keyCache) return _keyCache;

  const secret = process.env[KEY_ENV];
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      // Production: refuse to operate without a proper secret.
      // Do NOT fall back — decryptKey() returns null for unreadable ciphertexts
      // so callers can handle this gracefully, but we must not silently store
      // new keys under a predictable fallback.
      throw new Error(
        `${KEY_ENV} is required in production. ` +
          "Set it to a high-entropy string (≥32 chars from a CSPRNG) before starting the server."
      );
    }
    // Development: derive from a fixed seed (stable across restarts) + warn once.
    if (!_warnedAboutFallback) {
      logger.warn(
        `${KEY_ENV} is not set — using insecure dev seed. ` +
          "Set this env var to a high-entropy secret before storing real API keys or going to production."
      );
      _warnedAboutFallback = true;
    }
    _keyCache = deriveKey(DEV_SEED);
  } else {
    _keyCache = deriveKey(secret);
  }
  return _keyCache;
}

/**
 * Encrypt a plaintext API key.
 *
 * Throws in production when PROVIDER_KEY_SECRET is not set.
 * Returns an iv:tag:ciphertext hex triple.
 */
export function encryptKey(plaintext: string): string {
  const key = getKey(); // may throw in production
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a stored iv:tag:ciphertext triple.
 * Returns null (instead of throwing) on malformed input or auth-tag failure
 * so callers can gracefully handle keys encrypted under an old secret.
 */
export function decryptKey(ciphertext: string): string | null {
  try {
    // getKey() in production will throw if secret is missing, which is
    // intentional — if we can't decrypt we must not silently serve garbage.
    const key = getKey();
    const parts = ciphertext.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, encHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Mask a decrypted key for safe display: first 6 chars + dots + last 4 chars. */
export function maskKey(plaintext: string): string {
  if (plaintext.length <= 10) return "••••••••";
  return `${plaintext.slice(0, 6)}••••••••${plaintext.slice(-4)}`;
}

/** Invalidate the cached derived key (useful in tests that swap the env var). */
export function _resetKeyCache(): void {
  _keyCache = null;
  _warnedAboutFallback = false;
}
