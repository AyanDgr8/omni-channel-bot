import { afterEach, describe, expect, it } from "vitest";
import {
  _resetSipCredentialKeyCache,
  decryptSipPassword,
  encryptSipPassword,
} from "../lib/sip-credential-crypto.js";

const originalSipSecret = process.env.SIP_CREDENTIAL_SECRET;
const originalProviderSecret = process.env.PROVIDER_KEY_SECRET;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.SIP_CREDENTIAL_SECRET = originalSipSecret;
  process.env.PROVIDER_KEY_SECRET = originalProviderSecret;
  process.env.NODE_ENV = originalNodeEnv;
  _resetSipCredentialKeyCache();
});

describe("SIP credential encryption", () => {
  it("round trips a password and creates non-deterministic ciphertext", () => {
    process.env.NODE_ENV = "test";
    process.env.SIP_CREDENTIAL_SECRET = "sip-test-secret";
    _resetSipCredentialKeyCache();

    const first = encryptSipPassword("correct horse battery staple");
    const second = encryptSipPassword("correct horse battery staple");

    expect(first).not.toBe(second);
    expect(decryptSipPassword(first)).toBe("correct horse battery staple");
    expect(decryptSipPassword(second)).toBe("correct horse battery staple");
  });

  it("rejects tampered ciphertext without exposing or logging the password", () => {
    process.env.NODE_ENV = "test";
    process.env.SIP_CREDENTIAL_SECRET = "sip-test-secret";
    _resetSipCredentialKeyCache();

    const ciphertext = encryptSipPassword("super-secret-sip-password");
    const tampered = `${ciphertext.slice(0, -1)}${ciphertext.endsWith("0") ? "1" : "0"}`;

    expect(decryptSipPassword(tampered)).toBeNull();
    expect(decryptSipPassword("malformed")).toBeNull();
  });

  it("requires the dedicated SIP secret in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SIP_CREDENTIAL_SECRET;
    process.env.PROVIDER_KEY_SECRET = "must-not-be-used-in-production";
    _resetSipCredentialKeyCache();

    expect(() => encryptSipPassword("password")).toThrow("SIP_CREDENTIAL_SECRET is required in production");
  });
});