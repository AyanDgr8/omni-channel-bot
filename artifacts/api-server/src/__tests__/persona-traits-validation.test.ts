/**
 * Integration tests for manual persona trait validation.
 *
 * These tests exercise the mounted route against the real database to ensure
 * malformed traits never get persisted.
 */

import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  personaTraitsTable,
  personasTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";

const tenantId = `traits-test-tenant-${randomUUID()}`;
const userId = `traits-test-user-${randomUUID()}`;
const email = `traits-${randomUUID()}@test.local`;
const password = "test1234";

let cookie: string;
let personaId: string;

const validTraits = {
  identity: {
    role_title: "Customer support specialist",
    backstory: "An experienced support agent who resolves account questions.",
    goals: ["Resolve the caller's issue", "Leave clear next steps"],
  },
  language: {
    jargon: ["account ID"],
    greeting_phrases: ["Thanks for calling support."],
    closing_phrases: ["Is there anything else I can help with?"],
    forbidden_phrases: ["I guarantee"],
    sample_utterances: ["Let me look into that for you."],
  },
  tone: {
    warmth: 8,
    formality: 5,
    energy: 6,
    empathy: 9,
    verbosity: 4,
  },
  voice: {
    suggested_gender: "neutral",
    pace: "moderate",
    pitch: "medium",
    deepgram_voice_hint: "aura-asteria-en",
  },
  behavior: {
    interrupt_tolerance: "medium",
    silence_strategy: "Wait briefly, then ask if the caller is still there.",
    escalation_rule: "Escalate when the caller requests a human.",
    do_rules: ["Confirm the caller's request"],
    dont_rules: ["Invent account details"],
  },
};

async function updateTraits(body: Record<string, unknown>) {
  return request(app)
    .put(`/api/v1/personas/${personaId}/traits`)
    .set("Cookie", cookie)
    .send(body);
}

beforeAll(async () => {
  await db.insert(tenantsTable).values({
    id: tenantId,
    name: "Persona Traits Validation Test",
    slug: `traits-validation-${randomUUID()}`,
    status: "active",
    region: "global",
    webhookSecret: `test-secret-${randomUUID()}`,
  });

  await db.insert(usersTable).values({
    id: userId,
    tenantId,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role: "OWNER",
    status: "active",
  });

  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password });
  expect(login.status).toBe(200);
  const setCookie = login.headers["set-cookie"] as string[] | string;
  cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;

  // MySQL has no RETURNING, so the primary key is assigned here rather than
  // relying on the schema's client-side default.
  personaId = randomUUID();
  await db.insert(personasTable).values({
    id: personaId,
    name: `Traits Test Persona ${randomUUID()}`,
    source: "manual",
    version: 1,
    isActive: false,
    tenantId,
  });
});

afterAll(async () => {
  await db.delete(personasTable).where(eq(personasTable.id, personaId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId)).catch(() => {});
});

describe("PUT /api/v1/personas/:id/traits validation", () => {
  it("returns 400 when a required field is missing", async () => {
    const { identity: _identity, ...missingIdentity } = validTraits;

    const response = await updateTraits(missingIdentity);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Trait validation failed");
    expect(response.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["identity"] }),
    ]));
  });

  it("returns 400 when a tone value is outside the 1-10 range", async () => {
    const response = await updateTraits({
      ...validTraits,
      tone: { ...validTraits.tone, warmth: 11 },
    });

    expect(response.status).toBe(400);
    expect(response.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["tone", "warmth"] }),
    ]));
  });

  it.each([
    ["pace", { voice: { ...validTraits.voice, pace: "racing" } }, ["voice", "pace"]],
    ["pitch", { voice: { ...validTraits.voice, pitch: "ultrasonic" } }, ["voice", "pitch"]],
    [
      "interrupt tolerance",
      { behavior: { ...validTraits.behavior, interrupt_tolerance: "sometimes" } },
      ["behavior", "interrupt_tolerance"],
    ],
  ])("returns 400 for an invalid %s enum value", async (_label, replacement, path) => {
    const response = await updateTraits({ ...validTraits, ...replacement });

    expect(response.status).toBe(400);
    expect(response.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path }),
    ]));
  });

  it("saves valid traits and returns 200", async () => {
    const response = await updateTraits(validTraits);

    expect(response.status).toBe(200);
    expect(response.body.version).toBe(2);
    expect(response.body.source).toBe("manual");
    expect(response.body.traits).toEqual(validTraits);

    const saved = await db
      .select()
      .from(personaTraitsTable)
      .where(eq(personaTraitsTable.personaId, personaId));
    expect(saved).toHaveLength(1);
    expect(saved[0].version).toBe(2);
    expect(saved[0].traits).toEqual(validTraits);
  });
});