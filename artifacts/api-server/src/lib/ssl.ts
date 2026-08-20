/**
 * Locates and loads the TLS material the app is served with.
 *
 * Resolution order:
 *   1. SSL_KEY_PATH + SSL_CERT_PATH — explicit files (the normal case)
 *   2. SSL_DIR                      — a folder holding Let's Encrypt's filenames
 *   3. <workspace root>/ssl         — the repo's own certificates
 *
 * Relative paths resolve against the **workspace root**, not the working
 * directory: `pnpm --filter @workspace/api-server run dev` starts the process in
 * artifacts/api-server, so `ssl/privkey.pem` relative to cwd would not exist.
 *
 * Finding that root mirrors run-migrations.ts: __dirname is the dist/ directory
 * in the esbuild bundle and artifacts/api-server/src/lib under tsx, so we walk
 * upwards until we reach the folder holding pnpm-workspace.yaml.
 *
 * artifacts/dashboard/vite.config.ts implements the same contract for the
 * frontend — keep the two in step.
 */
import fs from "fs";
import path from "path";

const KEY_FILE = "privkey.pem";
const CERT_FILES = ["fullchain.pem", "cert.pem"];

export interface TlsMaterial {
  key: Buffer;
  cert: Buffer;
  keyPath: string;
  certPath: string;
}

/** Absolute path of the workspace root, or null if we somehow aren't inside it. */
function findWorkspaceRoot(): string | null {
  let cursor = __dirname;
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(cursor, "pnpm-workspace.yaml"))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

/** Resolves a possibly-relative path against the workspace root. */
function resolveFromRoot(p: string): string {
  if (path.isAbsolute(p)) return p;
  const root = findWorkspaceRoot();
  return root ? path.resolve(root, p) : path.resolve(p);
}

/** The key + certificate paths TLS would be loaded from, whether or not they exist. */
export function resolveTlsPaths(): { keyPath: string; certPath: string | null } {
  const keyEnv = process.env["SSL_KEY_PATH"];
  const certEnv = process.env["SSL_CERT_PATH"];

  if (keyEnv || certEnv) {
    if (!keyEnv || !certEnv) {
      throw new Error(
        "SSL_KEY_PATH and SSL_CERT_PATH must be set together — got only " +
          (keyEnv ? "SSL_KEY_PATH" : "SSL_CERT_PATH") +
          ".",
      );
    }
    return { keyPath: resolveFromRoot(keyEnv), certPath: resolveFromRoot(certEnv) };
  }

  const dir = process.env["SSL_DIR"]
    ? resolveFromRoot(process.env["SSL_DIR"])
    : path.join(findWorkspaceRoot() ?? process.cwd(), "ssl");

  const certPath = CERT_FILES.map((f) => path.join(dir, f)).find((f) =>
    fs.existsSync(f),
  );

  return { keyPath: path.join(dir, KEY_FILE), certPath: certPath ?? null };
}

/**
 * Reads key + certificate chain, or returns null when TLS is not configured.
 * Throws when the paths are configured but unreadable, so a typo in
 * SSL_KEY_PATH fails loudly instead of silently downgrading to plain HTTP.
 */
export function loadTlsMaterial(): TlsMaterial | null {
  const { keyPath, certPath } = resolveTlsPaths();

  const explicit = !!process.env["SSL_KEY_PATH"];
  const keyExists = fs.existsSync(keyPath);

  if (!keyExists || !certPath) {
    if (!explicit && !keyExists) return null; // no certificates here — plain HTTP
    throw new Error(
      `TLS is configured but unreadable — missing ${!keyExists ? keyPath : "certificate"}${
        certPath ? "" : ` (expected ${CERT_FILES.join(" or ")})`
      }`,
    );
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    keyPath,
    certPath,
  };
}

/**
 * True when the server should speak HTTPS. Set `ENABLE_HTTPS=false` to force
 * plain HTTP even with certificates present (e.g. behind a TLS-terminating proxy).
 */
export function httpsEnabled(): boolean {
  const flag = process.env["ENABLE_HTTPS"];
  if (flag !== undefined) return flag !== "false" && flag !== "0";
  return fs.existsSync(resolveTlsPaths().keyPath);
}
