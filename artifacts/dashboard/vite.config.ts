import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// ── TLS ───────────────────────────────────────────────────────────────────────
// Same contract as the API server's lib/ssl.ts — keep the two in step:
//   1. SSL_KEY_PATH + SSL_CERT_PATH — explicit files (the normal case)
//   2. SSL_DIR                      — a folder holding Let's Encrypt's filenames
//   3. <workspace root>/ssl         — the repo's own certificates
// Relative paths resolve against the workspace root, because `pnpm --filter`
// starts this process in artifacts/dashboard rather than at the root.
// Set ENABLE_HTTPS=false to serve plain HTTP even when certificates are present.
const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");

const resolveFromRoot = (p: string) =>
  path.isAbsolute(p) ? p : path.resolve(workspaceRoot, p);

function resolveTlsPaths() {
  const { SSL_KEY_PATH: keyEnv, SSL_CERT_PATH: certEnv, SSL_DIR } = process.env;

  if (keyEnv || certEnv) {
    if (!keyEnv || !certEnv) {
      throw new Error(
        `SSL_KEY_PATH and SSL_CERT_PATH must be set together — got only ${keyEnv ? "SSL_KEY_PATH" : "SSL_CERT_PATH"}.`,
      );
    }
    return { keyPath: resolveFromRoot(keyEnv), certPath: resolveFromRoot(certEnv) };
  }

  const dir = SSL_DIR ? resolveFromRoot(SSL_DIR) : path.join(workspaceRoot, "ssl");
  const certPath = ["fullchain.pem", "cert.pem"]
    .map((f) => path.join(dir, f))
    .find((f) => fs.existsSync(f));

  return { keyPath: path.join(dir, "privkey.pem"), certPath: certPath ?? null };
}

function loadHttpsConfig() {
  if (process.env.ENABLE_HTTPS === "false" || process.env.ENABLE_HTTPS === "0") {
    return undefined;
  }

  const { keyPath, certPath } = resolveTlsPaths();
  const keyExists = fs.existsSync(keyPath);

  if (!keyExists || !certPath) {
    // A typo in SSL_KEY_PATH must fail loudly rather than silently downgrade to
    // plain HTTP; an absent default ssl/ folder just means "no TLS configured".
    if (!process.env.SSL_KEY_PATH && !keyExists) return undefined;
    throw new Error(
      `TLS is configured but unreadable — missing ${!keyExists ? keyPath : "certificate"}`,
    );
  }

  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

const httpsConfig = loadHttpsConfig();

// The dashboard always calls the API at `/api` on its own origin; this proxy is
// what forwards those calls to the API server.
//
// BACKEND_URL is the API's public address. When the two servers share a machine
// its hostname may not resolve back to that machine (split-horizon DNS, or a
// laptop behind NAT), so API_PROXY_TARGET overrides the hop the proxy actually
// dials — e.g. https://localhost:8677.
const proxyTarget = (
  process.env.API_PROXY_TARGET ??
  process.env.BACKEND_URL ??
  "http://localhost:8677"
).replace(/\/+$/, "");

// A loopback target is reached by an address the certificate does not name, so
// hostname verification has to be off there — and only there.
const isLoopbackTarget = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$|\/)/.test(
  proxyTarget,
);

const apiProxy = {
  "/api": {
    target: proxyTarget,
    changeOrigin: false,
    secure: !isLoopbackTarget,
  },
};

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    ...(httpsConfig ? { https: httpsConfig } : {}),
    proxy: apiProxy,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    ...(httpsConfig ? { https: httpsConfig } : {}),
    proxy: apiProxy,
  },
});
