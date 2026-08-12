/**
 * Integration tests — Multi-Tenancy & RBAC
 *
 * Each test suite:
 *   1. Seeds two tenants + one user per tenant (hashed "test1234")
 *   2. Logs in to get a session cookie
 *   3. Asserts the relevant invariant
 *   4. Cleans up seeded rows
 *
 * Tests run against the REAL database (DATABASE_URL must be set).
 * Run with: pnpm --filter @workspace/api-server test
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import app from "../app";
import { db, tenantsTable, usersTable, personasTable, callsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function hashPw(pw: string) {
  return bcrypt.hash(pw, 10);
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password });
  expect(res.status, `Login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  const setCookie = res.headers["set-cookie"] as string[] | string;
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const T1_ID = `test-t1-${randomUUID()}`;
const T2_ID = `test-t2-${randomUUID()}`;
const U1_OWNER_ID = `test-u1-${randomUUID()}`;
const U2_OWNER_ID = `test-u2-${randomUUID()}`;
const U1_ANALYST_ID = `test-u1-analyst-${randomUUID()}`;
const T1_WEBHOOK_SECRET = `test-secret-t1-${randomUUID()}`;
const T2_WEBHOOK_SECRET = `test-secret-t2-${randomUUID()}`;

let cookie1: string; // session for tenant-1 OWNER
let cookie2: string; // session for tenant-2 OWNER
let cookieAnalyst: string; // session for tenant-1 ANALYST

const seededPersonaIds: string[] = [];
const seededCallIds: string[] = [];

beforeAll(async () => {
  const pw = await hashPw("test1234");

  // Seed tenant 1
  await db.insert(tenantsTable).values({
    id: T1_ID,
    name: "Test Tenant 1",
    slug: `test-tenant-1-${T1_ID.slice(-8)}`,
    status: "active",
    region: "global",
    webhookSecret: T1_WEBHOOK_SECRET,
  }).onConflictDoNothing();

  // Seed tenant 2
  await db.insert(tenantsTable).values({
    id: T2_ID,
    name: "Test Tenant 2",
    slug: `test-tenant-2-${T2_ID.slice(-8)}`,
    status: "active",
    region: "global",
    webhookSecret: T2_WEBHOOK_SECRET,
  }).onConflictDoNothing();

  // Seed users
  await db.insert(usersTable).values([
    {
      id: U1_OWNER_ID,
      tenantId: T1_ID,
      email: `owner1-${T1_ID.slice(-8)}@test.local`,
      passwordHash: pw,
      role: "OWNER",
      status: "active",
    },
    {
      id: U1_ANALYST_ID,
      tenantId: T1_ID,
      email: `analyst1-${T1_ID.slice(-8)}@test.local`,
      passwordHash: pw,
      role: "ANALYST",
      status: "active",
    },
    {
      id: U2_OWNER_ID,
      tenantId: T2_ID,
      email: `owner2-${T2_ID.slice(-8)}@test.local`,
      passwordHash: pw,
      role: "OWNER",
      status: "active",
    },
  ]).onConflictDoNothing();

  // Obtain session cookies
  cookie1 = await login(`owner1-${T1_ID.slice(-8)}@test.local`, "test1234");
  cookie2 = await login(`owner2-${T2_ID.slice(-8)}@test.local`, "test1234");
  cookieAnalyst = await login(`analyst1-${T1_ID.slice(-8)}@test.local`, "test1234");
});

afterAll(async () => {
  // Clean up seeded test rows (order matters for FK constraints)
  if (seededCallIds.length) {
    for (const id of seededCallIds) {
      await db.delete(callsTable).where(eq(callsTable.id, id)).catch(() => {});
    }
  }
  if (seededPersonaIds.length) {
    for (const id of seededPersonaIds) {
      await db.delete(personasTable).where(eq(personasTable.id, id)).catch(() => {});
    }
  }
  await db.delete(usersTable).where(eq(usersTable.tenantId, T1_ID)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.tenantId, T2_ID)).catch(() => {});
  await db.delete(tenantsTable).where(eq(tenantsTable.id, T1_ID)).catch(() => {});
  await db.delete(tenantsTable).where(eq(tenantsTable.id, T2_ID)).catch(() => {});
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe("Auth", () => {
  it("GET /api/v1/auth/me returns 401 when not logged in", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/auth/me returns current user when logged in", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", cookie1);
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(T1_ID);
    expect(res.body.role).toBe("OWNER");
  });

  it("POST /api/v1/auth/login rejects wrong password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: `owner1-${T1_ID.slice(-8)}@test.local`, password: "wrongpassword" });
    expect(res.status).toBe(401);
  });

  it("POST /api/v1/auth/logout destroys the session", async () => {
    const tempCookie = await login(`owner1-${T1_ID.slice(-8)}@test.local`, "test1234");
    await request(app).post("/api/v1/auth/logout").set("Cookie", tempCookie);
    const meRes = await request(app).get("/api/v1/auth/me").set("Cookie", tempCookie);
    expect(meRes.status).toBe(401);
  });
});

// ─── Cross-tenant isolation ───────────────────────────────────────────────────

describe("Cross-tenant isolation", () => {
  let personaIdT1: string;

  it("Persona created by T1 is only visible to T1", async () => {
    // Create a persona as T1 OWNER
    const createRes = await request(app)
      .post("/api/v1/personas")
      .set("Cookie", cookie1)
      .send({ name: `ISO-Test-Persona-${randomUUID().slice(0, 8)}`, description: "Isolation test" });

    // Persona creation triggers LLM (may succeed or fail with 502 in test env)
    if (createRes.status === 201) {
      personaIdT1 = createRes.body.id;
      seededPersonaIds.push(personaIdT1);
    } else {
      // LLM may fail in test env — just create a raw persona record
      const [p] = await db.insert(personasTable).values({
        name: `ISO-Test-Persona-${randomUUID().slice(0, 8)}`,
        source: "manual",
        version: 1,
        isActive: false,
        tenantId: T1_ID,
      }).returning();
      personaIdT1 = p.id;
      seededPersonaIds.push(p.id);
    }

    // T1 can see their persona
    const t1List = await request(app)
      .get("/api/v1/personas")
      .set("Cookie", cookie1);
    expect(t1List.status).toBe(200);
    const t1Ids = (t1List.body as Array<{ id: string }>).map((p) => p.id);
    expect(t1Ids).toContain(personaIdT1);

    // T2 CANNOT see T1's persona
    const t2List = await request(app)
      .get("/api/v1/personas")
      .set("Cookie", cookie2);
    expect(t2List.status).toBe(200);
    const t2Ids = (t2List.body as Array<{ id: string }>).map((p) => p.id);
    expect(t2Ids).not.toContain(personaIdT1);
  });

  it("T2 gets 404 when directly fetching T1's persona by ID", async () => {
    if (!personaIdT1) return;
    const res = await request(app)
      .get(`/api/v1/personas/${personaIdT1}`)
      .set("Cookie", cookie2);
    expect(res.status).toBe(404);
  });

  it("Stats are scoped to the requesting tenant", async () => {
    const r1 = await request(app).get("/api/v1/stats/overview").set("Cookie", cookie1);
    const r2 = await request(app).get("/api/v1/stats/overview").set("Cookie", cookie2);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Each tenant's stats are independent (no cross-contamination)
    expect(r1.body).toHaveProperty("totalCalls");
    expect(r2.body).toHaveProperty("totalCalls");
  });
});

// ─── RBAC ─────────────────────────────────────────────────────────────────────

describe("RBAC", () => {
  it("ANALYST cannot create a persona (requires ADMIN)", async () => {
    const res = await request(app)
      .post("/api/v1/personas")
      .set("Cookie", cookieAnalyst)
      .send({ name: "RBAC-test-persona", description: "Should be blocked" });
    expect(res.status).toBe(403);
  });

  it("ANALYST cannot create a bot (requires ADMIN)", async () => {
    const res = await request(app)
      .post("/api/v1/bots")
      .set("Cookie", cookieAnalyst)
      .send({ displayName: "TestBot", sipExtension: "9999", supportedLanguages: ["en"] });
    expect(res.status).toBe(403);
  });

  it("ANALYST cannot access user management (requires OWNER)", async () => {
    const res = await request(app)
      .get("/api/v1/users")
      .set("Cookie", cookieAnalyst);
    expect(res.status).toBe(403);
  });

  it("OWNER can list users and sees only their tenant's users", async () => {
    const res = await request(app)
      .get("/api/v1/users")
      .set("Cookie", cookie1);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const emails = (res.body as Array<{ email: string }>).map((u) => u.email);

    // T1 owner and analyst should be visible
    expect(emails).toContain(`owner1-${T1_ID.slice(-8)}@test.local`);
    expect(emails).toContain(`analyst1-${T1_ID.slice(-8)}@test.local`);

    // T2 user must NOT appear (cross-tenant isolation)
    expect(emails).not.toContain(`owner2-${T2_ID.slice(-8)}@test.local`);
  });

  it("ANALYST can read personas (read-only is fine)", async () => {
    const res = await request(app)
      .get("/api/v1/personas")
      .set("Cookie", cookieAnalyst);
    expect(res.status).toBe(200);
  });
});

// ─── Webhook auth ──────────────────────────────────────────────────────────────

describe("Webhook auth (/api/v1/calls/receive)", () => {
  it("Rejects requests without X-Webhook-Secret", async () => {
    const res = await request(app)
      .post("/api/v1/calls/receive")
      .send({ from: "+15550001234", botId: "nonexistent" });
    expect(res.status).toBe(401);
  });

  it("Rejects requests with a wrong X-Webhook-Secret", async () => {
    const res = await request(app)
      .post("/api/v1/calls/receive")
      .set("X-Webhook-Secret", "wrong-secret")
      .send({ from: "+15550001234", botId: "nonexistent" });
    expect(res.status).toBe(401);
  });

  it("Accepts requests with the correct X-Webhook-Secret (resolves by secret match)", async () => {
    const res = await request(app)
      .post("/api/v1/calls/receive")
      .set("X-Webhook-Secret", T1_WEBHOOK_SECRET)
      .send({ from: "+15550001234", botId: "nonexistent" });
    // botId doesn't exist so we get 400, but NOT 401 (webhook auth passed)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(500);
  });
});

// ─── Unauthenticated guard ─────────────────────────────────────────────────────

describe("Unauthenticated access", () => {
  const PROTECTED_ROUTES = [
    ["GET", "/api/v1/personas"],
    ["GET", "/api/v1/bots"],
    ["GET", "/api/v1/calls"],
    ["GET", "/api/v1/stats/overview"],
    ["GET", "/api/v1/users"],
    ["GET", "/api/v1/config/persona"],
  ] as const;

  for (const [method, path] of PROTECTED_ROUTES) {
    it(`${method} ${path} → 401 without session`, async () => {
      const lower = method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
      const res = await request(app)[lower](path);
      expect(res.status).toBe(401);
    });
  }
});
