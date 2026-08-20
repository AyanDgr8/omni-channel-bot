/**
 * Locates and loads the TLS material the app is served with.
 *
 * The certificates live in the workspace-root `ssl/` folder and nowhere else —
 * `SSL_DIR` may point at a different directory, but the layout inside it is
 * always Let's Encrypt's: privkey.pem + fullchain.pem (cert.pem as a fallback).
 *
 * Resolution mirrors run-migrations.ts: __dirname is the dist/ directory in the
 * esbuild bundle and artifacts/api-server/src/lib under tsx, so we walk upwards
 * until we find an `ssl/` folder that actually holds a private key.
 */
import fs from "fs";
import path from "path";

const KEY_FILE = "privkey.pem";
const CERT_FILES = ["fullchain.pem", "cert.pem"];

export interface TlsMaterial {
  key: Buffer;
  cert: Buffer;
  /** Absolute path of the folder the material was read from. */
  dir: string;
}

/** Absolute path of the `ssl/` folder, or null when there isn't one. */
export function findSslDir(): string | null {
  const fromEnv = process.env["SSL_DIR"];
  if (fromEnv) {
    const dir = path.resolve(fromEnv);
    return fs.existsSync(path.join(dir, KEY_FILE)) ? dir : null;
  }

  // Walk up from the running file: dist/ (bundle) or src/lib (tsx) → workspace root.
  let cursor = __dirname;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(cursor, "ssl");
    if (fs.existsSync(path.join(candidate, KEY_FILE))) return candidate;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

/**
 * Reads key + certificate chain, or returns null when TLS is not configured.
 * Throws only when an `ssl/` folder exists but is missing its certificate.
 */
export function loadTlsMaterial(): TlsMaterial | null {
  const dir = findSslDir();
  if (!dir) return null;

  const certFile = CERT_FILES.map((f) => path.join(dir, f)).find((f) =>
    fs.existsSync(f),
  );

  if (!certFile) {
    throw new Error(
      `Found ${path.join(dir, KEY_FILE)} but no certificate — expected one of ${CERT_FILES.join(", ")} in ${dir}`,
    );
  }

  return {
    key: fs.readFileSync(path.join(dir, KEY_FILE)),
    cert: fs.readFileSync(certFile),
    dir,
  };
}

/**
 * True when the server should speak HTTPS. Set `ENABLE_HTTPS=false` to force
 * plain HTTP even with certificates present (e.g. behind a TLS-terminating proxy).
 */
export function httpsEnabled(): boolean {
  const flag = process.env["ENABLE_HTTPS"];
  if (flag !== undefined) return flag !== "false" && flag !== "0";
  return findSslDir() !== null;
}
