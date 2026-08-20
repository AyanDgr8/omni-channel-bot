import type { Pool as CallbackPool } from "mysql2";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import MySQLSessionStore from "express-mysql-session";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import { httpsEnabled } from "./lib/ssl";
import { tenantScope } from "./middleware/tenant-scope";

const MySQLStore = MySQLSessionStore(session);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Behind TLS the session cookie must carry `Secure`, otherwise browsers drop it.
const isSecure = httpsEnabled() || process.env.NODE_ENV === "production";

// The dashboard normally proxies /api on its own origin, so no CORS is needed.
// FRONTEND_URL covers the case where it calls the API server directly instead;
// without it we reflect the caller's origin (dev convenience only).
const frontendOrigin = process.env.FRONTEND_URL?.replace(/\/+$/, "");

app.use(
  cors({
    origin: frontendOrigin ? [frontendOrigin] : true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session middleware ────────────────────────────────────────────────────────
// The `sessions` table is created by migration 0001, not by the store itself:
// the library's createDatabaseTable helper reads its schema.sql relative to
// __dirname, which does not survive esbuild bundling into dist/index.mjs.
//
// The store reuses the shared @workspace/db pool — hence endConnectionOnClose
// is false, so closing the store never kills the pool the rest of the app uses.
app.use(
  session({
    store: new MySQLStore(
      {
        createDatabaseTable: false,
        endConnectionOnClose: false,
        schema: { tableName: "sessions" },
      },
      // `@types/express-mysql-session` declares this parameter against mysql2's
      // callback API, but the library awaits `connection.query(...)` internally,
      // so it needs the mysql2/promise pool we actually pass here.
      pool as unknown as CallbackPool,
    ),
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isSecure,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    },
  }),
);

// ── Tenant + auth scope (all routes except health / auth / webhook) ───────────
app.use(tenantScope);

app.use("/api", router);

export default app;
