/**
 * auditMiddleware(entity)
 *
 * Returns an Express middleware that, after every successful mutating request
 * (POST / PUT / PATCH / DELETE), writes a row to the audit_log table.
 *
 * Usage:
 *   router.use(auditMiddleware("persona"));
 *   // or per-route:
 *   router.delete("/v1/personas/:id", auditMiddleware("persona"), handler);
 */
import type { Request, Response, NextFunction } from "express";
import { db, auditLogTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

export function auditMiddleware(entity: string) {
  return function auditHandler(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      next();
      return;
    }

    const tenantId = req.tenantId;
    const actorUserId = req.userId ?? null;
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? req.socket?.remoteAddress
      ?? null;

    // Capture the entity ID from URL params (best-effort)
    const entityId = (req.params.id ?? req.params.botId ?? req.params.personaId ?? null) as string | null;

    const action =
      req.method === "DELETE" ? "DELETE"
      : req.method === "POST" ? "CREATE"
      : "UPDATE";

    // Intercept res.json to capture the response body for afterJson
    const _origJson = res.json.bind(res);
    res.json = function (body: unknown): Response {
      if (res.statusCode >= 200 && res.statusCode < 300 && tenantId) {
        // Fire-and-forget — do not block the response
        db.insert(auditLogTable).values({
          tenantId,
          actorUserId,
          action,
          entity,
          entityId,
          afterJson: body as Record<string, unknown>,
          ip,
        }).catch((err: unknown) => {
          logger.error({ err }, "Failed to write audit log entry");
        });
      }
      return _origJson(body);
    };

    next();
  };
}
