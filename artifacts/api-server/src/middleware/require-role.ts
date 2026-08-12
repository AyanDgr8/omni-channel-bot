/**
 * requireRole(minRole)
 *
 * Express middleware factory.  Rejects requests whose authenticated user does
 * not meet the minimum role threshold.
 *
 * Role hierarchy (ascending privilege):
 *   ANALYST=1  SUPERVISOR=2  ADMIN=3  OWNER=4
 */
import type { Request, Response, NextFunction } from "express";
import { ROLE_RANK, type UserRole } from "@workspace/db";

export function requireRole(minRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.userRole as UserRole | undefined;
    const rank = role ? (ROLE_RANK[role] ?? 0) : 0;

    if (rank < ROLE_RANK[minRole]) {
      res.status(403).json({
        error: `Requires ${minRole} role or higher`,
        yourRole: role ?? "none",
      });
      return;
    }

    next();
  };
}
