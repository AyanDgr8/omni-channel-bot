import http from "http";
import https from "https";
import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/run-migrations";
import { provisionAdmins } from "./lib/provision-admins";
import { httpsEnabled, loadTlsMaterial } from "./lib/ssl";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * HTTPS whenever the workspace `ssl/` folder holds a key + chain (see lib/ssl.ts).
 * Falls back to plain HTTP for local development without certificates.
 */
function createServer(): { server: http.Server; protocol: "http" | "https" } {
  if (!httpsEnabled()) return { server: http.createServer(app), protocol: "http" };

  const tls = loadTlsMaterial();

  if (!tls) {
    throw new Error(
      "ENABLE_HTTPS is set but no TLS material was found — point SSL_KEY_PATH and SSL_CERT_PATH at your key and certificate chain.",
    );
  }

  logger.info(
    { keyPath: tls.keyPath, certPath: tls.certPath },
    "Loaded TLS certificate",
  );
  return {
    server: https.createServer({ key: tls.key, cert: tls.cert }, app),
    protocol: "https",
  };
}

// Run pending DB migrations before opening the HTTP port.
runMigrations()
  .then(provisionAdmins)
  .then(() => {
    const { server, protocol } = createServer();

    server.on("error", (err) => {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    });

    server.listen(port, () => {
      logger.info({ port, protocol }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Startup failed");
    process.exit(1);
  });
