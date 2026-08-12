/**
 * Auth routes
 *   POST /v1/auth/login   — email + password → session
 *   POST /v1/auth/logout  — destroy session
 *   GET  /v1/auth/me      — current user (no password hash)
 */
import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { db, usersTable, tenantsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ─── Login ────────────────────────────────────────────────────────────────────

router.post("/v1/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email?.trim() || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.email, email.toLowerCase().trim()), eq(usersTable.status, "active")))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Verify tenant is active
  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, user.tenantId))
    .limit(1);

  if (!tenant || tenant.status !== "active") {
    res.status(403).json({ error: "Tenant account is not active" });
    return;
  }

  // Persist to session
  req.session.userId = user.id;
  req.session.tenantId = user.tenantId;
  req.session.role = user.role;

  logger.info({ userId: user.id, tenantId: user.tenantId, role: user.role }, "User logged in");

  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

router.post("/v1/auth/logout", (req, res): void => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "Failed to destroy session" });
      return;
    }
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// ─── Me ───────────────────────────────────────────────────────────────────────

router.get("/v1/auth/me", async (req, res): Promise<void> => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId))
    .limit(1);

  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Session user no longer exists" });
    return;
  }

  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, user.tenantId))
    .limit(1);

  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    tenantName: tenant?.name ?? null,
    tenantSlug: tenant?.slug ?? null,
  });
});

export default router;
