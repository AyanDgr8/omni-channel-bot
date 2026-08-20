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
// Certificates come from the workspace-root `ssl/` folder and nowhere else
// (override the location with SSL_DIR; the file names stay Let's Encrypt's).
// Set ENABLE_HTTPS=false to serve plain HTTP even when they are present.
const sslDir = path.resolve(
  process.env.SSL_DIR ?? path.resolve(import.meta.dirname, "..", "..", "ssl"),
);

function loadHttpsConfig() {
  if (process.env.ENABLE_HTTPS === "false" || process.env.ENABLE_HTTPS === "0") {
    return undefined;
  }

  const keyPath = path.join(sslDir, "privkey.pem");
  const certPath = ["fullchain.pem", "cert.pem"]
    .map((f) => path.join(sslDir, f))
    .find((f) => fs.existsSync(f));

  if (!fs.existsSync(keyPath) || !certPath) return undefined;

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
