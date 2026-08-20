import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger.js";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const LEGACY_ADMIN_EMAIL = "admin@voxagent.local";

export async function provisionAdmins(): Promise<void> {
  const rawIds = process.env.ADMIN_IDS ?? process.env.admin_ids;
  const password = process.env.ADMIN_PASSWORD ?? process.env.admin_password;

  if (!rawIds && !password) return;
  if (!rawIds || !password) {
    throw new Error("ADMIN_IDS and ADMIN_PASSWORD must be provided together");
  }

  const emails = [...new Set(
    rawIds.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean),
  )];
  if (emails.length === 0) throw new Error("ADMIN_IDS must contain at least one email");
  if (password.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters");

  const passwordHash = await bcrypt.hash(password, 10);

  for (const email of emails) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existing) {
      await db.update(usersTable).set({
        tenantId: DEFAULT_TENANT_ID,
        passwordHash,
        role: "OWNER",
        status: "active",
      }).where(eq(usersTable.id, existing.id));
    } else {
      await db.insert(usersTable).values({
        id: randomUUID(),
        tenantId: DEFAULT_TENANT_ID,
        email,
        passwordHash,
        role: "OWNER",
        status: "active",
      });
    }
  }

  if (!emails.includes(LEGACY_ADMIN_EMAIL)) {
    await db.update(usersTable)
      .set({ status: "inactive" })
      .where(eq(usersTable.email, LEGACY_ADMIN_EMAIL));
  }

  logger.info({ adminCount: emails.length }, "Environment admins provisioned");
}
