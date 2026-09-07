import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import app from "../app";
import {
  botsTable,
  callsTable,
  complianceDecisionsTable,
  complianceProfilesTable,
  consentLedgerTable,
  db,
  dncEntriesTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { evaluateCompliance, isWithinWindow } from "../lib/compliance-gate";
import { prependDisclosure } from "../lib/call-connect-service";

const T1_ID = `compliance-t1-${randomUUID()}`;
const T2_ID = `compliance-t2-${randomUUID()}`;
const BOT_ID = `compliance-bot-${randomUUID()}`;
const U1_EMAIL = `compliance-1-${randomUUID().slice(0, 8)}@test.local`;
const U2_EMAIL = `compliance-2-${randomUUID().slice(0, 8)}@test.local`;
const T1_WEBHOOK_SECRET = `secret-${randomUUID()}`;
let cookie1 = "";
let cookie2 = "";

async function login(email: string): Promise<string> {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password: "test1234" });
  expect(response.status).toBe(200);
  const cookie = response.headers["set-cookie"] as string[] | string;
  return Array.isArray(cookie) ? cookie[0] : cookie;
}

async function saveDefaultProfile(values: Partial<typeof complianceProfilesTable.$inferInsert>) {
  await db.update(complianceProfilesTable).set(values).where(and(
    eq(complianceProfilesTable.tenantId, T1_ID),
    eq(complianceProfilesTable.jurisdictionCode, "DEFAULT"),
  ));
}

beforeAll(async () => {
  const hash = await bcrypt.hash("test1234", 10);
  await db.insert(tenantsTable).values([
    { id: T1_ID, name: "Compliance Test 1", slug: `compliance-1-${T1_ID.slice(-8)}`, status: "active", region: "global", webhookSecret: T1_WEBHOOK_SECRET },
    { id: T2_ID, name: "Compliance Test 2", slug: `compliance-2-${T2_ID.slice(-8)}`, status: "active", region: "global", webhookSecret: `secret-${randomUUID()}` },
  ]);
  await db.insert(usersTable).values([
    { id: `user-${randomUUID()}`, tenantId: T1_ID, email: U1_EMAIL, passwordHash: hash, role: "ADMIN", status: "active" },
    { id: `user-${randomUUID()}`, tenantId: T2_ID, email: U2_EMAIL, passwordHash: hash, role: "ADMIN", status: "active" },
  ]);
  await db.insert(botsTable).values({
    id: BOT_ID, tenantId: T1_ID, displayName: "Compliance Bot", sipExtension: "2201",
    status: "ONLINE", direction: "outbound", timezone: "UTC",
  });
  cookie1 = await login(U1_EMAIL);
  cookie2 = await login(U2_EMAIL);

  // Create the default and India profiles through the service endpoint so all
  // later gate tests share deterministic rules.
  await request(app).get("/api/v1/compliance/profiles").set("Cookie", cookie1);
  await saveDefaultProfile({
    timezone: "UTC", callingWindowStart: "00:00", callingWindowEnd: "23:59",
    allowedDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
    holidays: [], requireConsent: false, requireRecordingConsent: false, blockOnHoliday: true,
  });
});

afterAll(async () => {
  await db.delete(complianceDecisionsTable).where(eq(complianceDecisionsTable.tenantId, T1_ID));
  await db.delete(complianceDecisionsTable).where(eq(complianceDecisionsTable.tenantId, T2_ID));
  await db.delete(dncEntriesTable).where(eq(dncEntriesTable.tenantId, T1_ID));
  await db.delete(dncEntriesTable).where(eq(dncEntriesTable.tenantId, T2_ID));
  await db.delete(consentLedgerTable).where(eq(consentLedgerTable.tenantId, T1_ID));
  await db.delete(complianceProfilesTable).where(eq(complianceProfilesTable.tenantId, T1_ID));
  await db.delete(complianceProfilesTable).where(eq(complianceProfilesTable.tenantId, T2_ID));
  await db.delete(callsTable).where(eq(callsTable.tenantId, T1_ID));
  await db.delete(botsTable).where(eq(botsTable.id, BOT_ID));
  await db.delete(usersTable).where(eq(usersTable.tenantId, T1_ID));
  await db.delete(usersTable).where(eq(usersTable.tenantId, T2_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, T1_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, T2_ID));
});

describe("tenant-scoped compliance gate", () => {
  it("blocks DNC numbers before creating a live call and persists the blocked evidence", async () => {
    const number = "+14155550111";
    const dnc = await request(app).post("/api/v1/compliance/dnc").set("Cookie", cookie1).send({ phoneNumber: number, reason: "test" });
    expect(dnc.status).toBe(201);

    const dial = await request(app).post("/api/v1/calls/dial").set("Cookie", cookie1).send({ botId: BOT_ID, to: number });
    expect(dial.status).toBe(409);
    expect(dial.body.reasonCode).toBe("DNC_LISTED");
    const [evidence] = await db.select().from(complianceDecisionsTable).where(and(
      eq(complianceDecisionsTable.tenantId, T1_ID),
      eq(complianceDecisionsTable.phoneNumber, number),
      eq(complianceDecisionsTable.reasonCode, "DNC_LISTED"),
    ));
    expect(evidence?.callId).toBeNull();
    await request(app).delete(`/api/v1/compliance/dnc/${dnc.body.id}`).set("Cookie", cookie1);
  });

  it("blocks a retry immediately after an in-call opt-out", async () => {
    const number = "+14155550112";
    const optOut = await request(app).post("/api/v1/compliance/opt-out").set("Cookie", cookie1).send({ phoneNumber: number });
    expect(optOut.status).toBe(201);
    const retry = await request(app).post("/api/v1/calls/dial").set("Cookie", cookie1).send({ botId: BOT_ID, to: number });
    expect(retry.status).toBe(409);
    expect(retry.body.reasonCode).toBe("DNC_LISTED");
  });

  it("blocks required calling consent when no active consent exists", async () => {
    await saveDefaultProfile({ requireConsent: true });
    const dial = await request(app).post("/api/v1/calls/dial").set("Cookie", cookie1).send({ botId: BOT_ID, to: "+14155550113" });
    expect(dial.status).toBe(409);
    expect(dial.body.reasonCode).toBe("CONSENT_MISSING");
    await saveDefaultProfile({ requireConsent: false });
  });

  it("fails closed when the default compliance policy is disabled", async () => {
    await saveDefaultProfile({ enabled: false });
    const dial = await request(app).post("/api/v1/calls/dial").set("Cookie", cookie1)
      .send({ botId: BOT_ID, to: "+14155550120" });
    expect(dial.status).toBe(400);
    expect(dial.body.error).toContain("No enabled compliance profile");
    await saveDefaultProfile({ enabled: true });
  });

  it("handles ordinary and overnight calling windows", () => {
    expect(isWithinWindow("10:30", "09:00", "17:00")).toBe(true);
    expect(isWithinWindow("18:00", "09:00", "17:00")).toBe(false);
    expect(isWithinWindow("23:30", "22:00", "06:00")).toBe(true);
    expect(isWithinWindow("05:59", "22:00", "06:00")).toBe(true);
    expect(isWithinWindow("12:00", "22:00", "06:00")).toBe(false);
  });

  it("blocks a configured local holiday", async () => {
    await saveDefaultProfile({ holidays: ["2026-01-01"], blockOnHoliday: true });
    const decision = await evaluateCompliance({
      tenantId: T1_ID, botId: BOT_ID, phoneNumber: "+14155550114", direction: "OUTBOUND",
      now: new Date("2026-01-01T12:00:00.000Z"),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("HOLIDAY");
    await saveDefaultProfile({ holidays: [] });
  });

  it("injects the India disclosure and always places it first", async () => {
    const inbound = await request(app).post("/api/v1/calls/inbound").set("Cookie", cookie1)
      .send({ botId: BOT_ID, from: "+919876543210" });
    expect(inbound.status).toBe(201);
    expect(inbound.body.disclosureText).toContain("AI assistant");
    const setup = prependDisclosure(inbound.body.disclosureText, "Good morning, how can I help?");
    expect(setup.startsWith(inbound.body.disclosureText)).toBe(true);
    const played = await request(app).post(`/api/v1/calls/${inbound.body.id}/media-events`)
      .set("X-Webhook-Secret", T1_WEBHOOK_SECRET)
      .send({ event: "DISCLOSURE_PLAYED", evidence: "telephony-playback-ack" });
    expect(played.status).toBe(200);
    expect(played.body.disclosurePlayedAt).toBeTruthy();
    const duplicate = await request(app).post(`/api/v1/calls/${inbound.body.id}/media-events`)
      .set("X-Webhook-Secret", T1_WEBHOOK_SECRET)
      .send({ event: "DISCLOSURE_PLAYED", evidence: "duplicate-ack" });
    expect(duplicate.status).toBe(409);
  });

  it("records an in-call recording-consent response on the call and ledger", async () => {
    await saveDefaultProfile({ requireRecordingConsent: true });
    const inbound = await request(app).post("/api/v1/calls/inbound").set("Cookie", cookie1)
      .send({ botId: BOT_ID, from: "+14155550117" });
    const response = await request(app).post(`/api/v1/calls/${inbound.body.id}/media-events`)
      .set("X-Webhook-Secret", T1_WEBHOOK_SECRET)
      .send({ event: "RECORDING_CONSENT_GRANTED", evidence: "Caller said yes" });
    expect(response.status).toBe(200);
    expect(response.body.recordingConsentStatus).toBe("GRANTED");
    const [ledgerEntry] = await db.select().from(consentLedgerTable).where(and(
      eq(consentLedgerTable.tenantId, T1_ID),
      eq(consentLedgerTable.phoneNumber, "+14155550117"),
      eq(consentLedgerTable.consentType, "RECORDING"),
    ));
    expect(ledgerEntry?.status).toBe("GRANTED");
    await saveDefaultProfile({ requireRecordingConsent: false });
  });

  it("requires disclosure playback before recording consent", async () => {
    await saveDefaultProfile({
      requireRecordingConsent: true,
      mandatoryDisclosureText: "Test disclosure required before recording consent.",
    });
    const inbound = await request(app).post("/api/v1/calls/inbound").set("Cookie", cookie1)
      .send({ botId: BOT_ID, from: "+14155550118" });
    const early = await request(app).post(`/api/v1/calls/${inbound.body.id}/media-events`)
      .set("X-Webhook-Secret", T1_WEBHOOK_SECRET)
      .send({ event: "RECORDING_CONSENT_GRANTED", evidence: "early" });
    expect(early.status).toBe(409);
    await saveDefaultProfile({ requireRecordingConsent: false, mandatoryDisclosureText: null });
  });

  it("allows only one of two concurrent recording-consent callbacks", async () => {
    await saveDefaultProfile({ requireRecordingConsent: true });
    const inbound = await request(app).post("/api/v1/calls/inbound").set("Cookie", cookie1)
      .send({ botId: BOT_ID, from: "+14155550119" });
    const [granted, declined] = await Promise.all([
      request(app).post(`/api/v1/calls/${inbound.body.id}/media-events`)
        .set("X-Webhook-Secret", T1_WEBHOOK_SECRET)
        .send({ event: "RECORDING_CONSENT_GRANTED", evidence: "concurrent-grant" }),
      request(app).post(`/api/v1/calls/${inbound.body.id}/media-events`)
        .set("X-Webhook-Secret", T1_WEBHOOK_SECRET)
        .send({ event: "RECORDING_CONSENT_DECLINED", evidence: "concurrent-decline" }),
    ]);
    expect([granted.status, declined.status].sort()).toEqual([200, 409]);
    await saveDefaultProfile({ requireRecordingConsent: false });
  });

  it("keeps DNC data isolated by tenant and supports CSV import/export", async () => {
    const number = "+14155550115";
    const imported = await request(app).post("/api/v1/compliance/dnc/import").set("Cookie", cookie1)
      .send({ csv: `phone_number,reason\n${number},Imported test` });
    expect(imported.status).toBe(200);
    expect(imported.body.imported).toBe(1);

    const otherTenant = await request(app).get("/api/v1/compliance/dnc").set("Cookie", cookie2);
    expect(otherTenant.status).toBe(200);
    expect(otherTenant.body.some((entry: { phoneNumber: string }) => entry.phoneNumber === number)).toBe(false);

    const exportResponse = await request(app).get("/api/v1/compliance/dnc/export").set("Cookie", cookie1);
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.text).toContain(number);
  });

  it("links allowed decisions to their created call record", async () => {
    const number = "+14155550116";
    const dial = await request(app).post("/api/v1/calls/dial").set("Cookie", cookie1).send({ botId: BOT_ID, to: number });
    expect(dial.status).toBe(201);
    expect(dial.body.complianceDecisionId).toBeTruthy();
    const [evidence] = await db.select().from(complianceDecisionsTable).where(eq(complianceDecisionsTable.id, dial.body.complianceDecisionId));
    expect(evidence?.decision).toBe("ALLOWED");
    expect(evidence?.callId).toBe(dial.body.id);
  });
});