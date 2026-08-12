/**
 * User management routes (OWNER role required)
 *   GET    /v1/users           — list users in current tenant
 *   POST   /v1/users           — create user
 *   GET    /v1/users/:id       — get user
 *   PATCH  /v1/users/:id       — update role / status
 */
import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { db, usersTable, USER_ROLES } from "@workspace/db";
import { requireRole } from "../middleware/require-role.js";
import { auditMiddleware } from "../middleware/audit.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// All user-management endpoints require OWNER
router.use("/v1/users", requireRole("OWNER"));
router.use("/v1/users", auditMiddleware("user"));

// ─── List ─────────────────────────────────────────────────────────────────────

router.get("/v1/users", async (req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.tenantId, req.tenantId!));

  res.json(users);
});

// ─── Get single ───────────────────────────────────────────────────────────────

router.get("/v1/users/:id", async (req, res): Promise<void> => {
  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(and(eq(usersTable.id, req.params.id), eq(usersTable.tenantId, req.tenantId!)))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(user);
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post("/v1/users", async (req, res): Promise<void> => {
  const { email, password, role = "ANALYST" } = req.body as {
    email?: string;
    password?: string;
    role?: string;
  };

  if (!email?.trim() || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  if (!USER_ROLES.includes(role as typeof USER_ROLES[number])) {
    res.status(400).json({ error: `role must be one of: ${USER_ROLES.join(", ")}` });
    return;
  }

  // Check email uniqueness (global — emails are unique across all tenants)
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const [user] = await db
    .insert(usersTable)
    .values({
      tenantId: req.tenantId!,
      email: email.toLowerCase().trim(),
      passwordHash,
      role: role as typeof USER_ROLES[number],
      status: "active",
    })
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    });

  logger.info({ userId: user.id, tenantId: req.tenantId }, "User created");

  res.status(201).json(user);
});

// ─── Update ───────────────────────────────────────────────────────────────────

router.patch("/v1/users/:id", async (req, res): Promise<void> => {
  // Prevent demoting self
  if (req.params.id === req.userId) {
    res.status(400).json({ error: "Cannot modify your own account" });
    return;
  }

  const { role, status } = req.body as { role?: string; status?: string };
  const updates: Partial<{ role: typeof USER_ROLES[number]; status: string }> = {};

  if (role !== undefined) {
    if (!USER_ROLES.includes(role as typeof USER_ROLES[number])) {
      res.status(400).json({ error: `role must be one of: ${USER_ROLES.join(", ")}` });
      return;
    }
    updates.role = role as typeof USER_ROLES[number];
  }

  if (status !== undefined) {
    if (!["active", "inactive"].includes(status)) {
      res.status(400).json({ error: "status must be 'active' or 'inactive'" });
      return;
    }
    updates.status = status;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set(updates)
    .where(and(eq(usersTable.id, req.params.id), eq(usersTable.tenantId, req.tenantId!)))
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(user);
});

export default router;
