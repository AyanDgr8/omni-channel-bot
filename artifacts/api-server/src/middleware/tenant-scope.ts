/**
 * tenantScope middleware
 *
 * – Exempted routes (no auth required):
 *     GET  /api/v1/health
 *     POST /api/v1/calls/receive  (uses X-Webhook-Secret + DID instead)
 *
 * – All other routes: require a valid session; attach tenantId / userId /
 *   userRole to req so downstream handlers can use them for tenant filtering.
 *
 * – Webhook requests (/v1/calls/receive) validate X-Webhook-Secret against
 *   the tenant matched by the called DID (to-number). Tenant is then attached
 *   to req the same way.
 */
import type { Request, Response, NextFunction } from "express";
import { db, tenantsTable, tenantDidsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import type { UserRole } from "@workspace/db";

/** Routes that never need a session */
const EXEMPT_EXACT: Set<string> = new Set(["/api/v1/health"]);
/** Route prefixes exempted from session auth (handled by webhook secret instead) */
const WEBHOOK_PREFIX = "/api/v1/calls/receive";
const MEDIA_EVENT_PATH = /^\/api\/v1\/calls\/[^/]+\/media-events$/;

export async function tenantScope(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const path = req.path;

  // ── 1. Fully exempt routes ──────────────────────────────────────────────
  if (EXEMPT_EXACT.has(req.originalUrl.split("?")[0])) {
    next();
    return;
  }

  // ── 2. Login / logout / me (auth routes) ────────────────────────────────
  if (req.originalUrl.startsWith("/api/v1/auth/")) {
    next();
    return;
  }

  // Worker callbacks authenticate themselves in the SIP router with a distinct
  // bearer secret; sessions must not be required for this machine-to-machine path.
  if (req.originalUrl.startsWith("/api/internal/freeswitch/")) {
    next();
    return;
  }

  // ── 3. Telephony webhook — authenticate by secret + DID resolution ──────
  if (req.originalUrl.startsWith(WEBHOOK_PREFIX) || MEDIA_EVENT_PATH.test(req.path)) {
    const secret = req.headers["x-webhook-secret"] as string | undefined;
    const toNumber = (req.body as Record<string, unknown>)?.to as string | undefined;

    if (!secret) {
      res.status(401).json({ error: "Missing X-Webhook-Secret header" });
      return;
    }

    try {
      let tenant = null;

      if (toNumber) {
        // Resolve tenant from the called DID
        const [did] = await db
          .select()
          .from(tenantDidsTable)
          .where(eq(tenantDidsTable.didE164, toNumber))
          .limit(1);
        if (did) {
          const [t] = await db
            .select()
            .from(tenantsTable)
            .where(eq(tenantsTable.id, did.tenantId))
            .limit(1);
          tenant = t ?? null;
        }
      }

      if (!tenant) {
        // Fallback: find any tenant whose webhook_secret matches
        const [t] = await db
          .select()
          .from(tenantsTable)
          .where(eq(tenantsTable.webhookSecret, secret))
          .limit(1);
        tenant = t ?? null;
      }

      if (!tenant || tenant.webhookSecret !== secret) {
        res.status(401).json({ error: "Invalid webhook secret" });
        return;
      }

      req.tenantId = tenant.id;
      req.userId = undefined; // system-initiated, no user actor
      req.userRole = "ADMIN" as UserRole; // grant admin scope for webhooks
    } catch (err) {
      logger.error({ err }, "Webhook tenant resolution failed");
      res.status(500).json({ error: "Internal error resolving tenant" });
      return;
    }

    next();
    return;
  }

  // ── 4. All other routes — require a valid session ────────────────────────
  if (!req.session?.userId || !req.session?.tenantId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  req.tenantId = req.session.tenantId;
  req.userId = req.session.userId;
  req.userRole = req.session.role;

  void path; // suppress unused-var lint
  next();
}
