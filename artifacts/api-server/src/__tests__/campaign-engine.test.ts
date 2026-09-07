import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import {
  botsTable, callbacksTable, campaignContactsTable, campaignsTable, db,
  dispositionsTable, tenantsTable,
} from "@workspace/db";
import { evaluateCompliance } from "../lib/compliance-gate.js";

type Finished = (result: { disposition: string; outcome: string }, callId: string) => Promise<void>;
const started: Array<{ phone: string; finished: Finished }> = [];

vi.mock("../lib/compliance-gate.js", () => ({
  normalizeE164: (value: string) => value,
  evaluateCompliance: vi.fn(async ({ phoneNumber }: { phoneNumber: string }) => ({
    allowed: !phoneNumber.endsWith("9999"),
    decision: phoneNumber.endsWith("9999") ? "BLOCKED" : "ALLOWED",
    decisionId: randomUUID(),
    normalizedPhone: phoneNumber,
    reasonCode: phoneNumber.endsWith("9999") ? "DNC_LISTED" : "ALLOWED",
    reason: phoneNumber.endsWith("9999") ? "Number is on the DNC list" : "Allowed",
    disclosureText: null, recordingConsentRequired: false,
  })),
}));

vi.mock("../routes/calls-router.js", () => ({
  startCampaignOutboundCall: vi.fn(async (input: { phoneNumber: string; onFinished: Finished }) => {
    started.push({ phone: input.phoneNumber, finished: input.onFinished });
    return { id: randomUUID() };
  }),
}));

const { reserveTriggeredContact, runCampaignTick } = await import("../routes/campaigns.js");

const ids: string[] = [];
const phone = (suffix: number) => `+155500${String(suffix).padStart(4, "0")}`;

async function seedCampaign(options: { tenantId?: string; cap?: number; status?: string } = {}) {
  const tenantId = options.tenantId ?? `campaign-test-${randomUUID()}`;
  const botId = `bot-${randomUUID()}`;
  const campaignId = `campaign-${randomUUID()}`;
  ids.push(tenantId);
  await db.insert(tenantsTable).values({ id: tenantId, name: "Campaign test", slug: `campaign-${randomUUID()}`, webhookSecret: randomUUID() });
  await db.insert(botsTable).values({ id: botId, tenantId, displayName: "Dialler", sipExtension: `x-${randomUUID()}`, direction: "outbound" });
  await db.insert(campaignsTable).values({
    id: campaignId, tenantId, botId, name: "Campaign test", objectivePrompt: "Qualify the lead",
    status: options.status ?? "RUNNING", concurrencyCap: options.cap ?? 5,
    retryPolicyJson: { max_attempts: 3, spacing_minutes: 1, per_outcome: {} },
    successFieldsJson: ["company"],
  });
  return { tenantId, botId, campaignId };
}

async function contact(tenantId: string, campaignId: string, suffix: number, values: Record<string, unknown> = {}) {
  const id = `contact-${randomUUID()}`;
  await db.insert(campaignContactsTable).values({
    id, tenantId, campaignId, phoneE164: phone(suffix), variablesJson: values, nextAttemptAt: new Date(Date.now() - 1_000),
  });
  return id;
}

beforeEach(() => { started.length = 0; });
afterEach(async () => {
  for (const tenantId of ids.splice(0)) {
    await db.delete(dispositionsTable).where(eq(dispositionsTable.tenantId, tenantId));
    await db.delete(callbacksTable).where(eq(callbacksTable.tenantId, tenantId));
    await db.delete(campaignContactsTable).where(eq(campaignContactsTable.tenantId, tenantId));
    await db.delete(campaignsTable).where(eq(campaignsTable.tenantId, tenantId));
    await db.delete(botsTable).where(eq(botsTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  }
});

describe("campaign dialler claims", () => {
  it("uses parallel SKIP LOCKED claims without exceeding a campaign cap", async () => {
    const fixture = await seedCampaign({ cap: 2 });
    await Promise.all([contact(fixture.tenantId, fixture.campaignId, 1), contact(fixture.tenantId, fixture.campaignId, 2), contact(fixture.tenantId, fixture.campaignId, 3)]);
    await Promise.all([runCampaignTick(), runCampaignTick()]);
    expect(started).toHaveLength(2);
    const rows = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.campaignId, fixture.campaignId));
    expect(rows.filter((row) => row.state === "IN_FLIGHT")).toHaveLength(2);
    expect(new Set(rows.filter((row) => row.state === "IN_FLIGHT").map((row) => row.leaseToken)).size).toBe(2);
  });

  it("recovers an expired lease and gives the recovered contact a new lease", async () => {
    const fixture = await seedCampaign();
    const id = await contact(fixture.tenantId, fixture.campaignId, 4);
    await db.update(campaignContactsTable).set({ state: "IN_FLIGHT", leaseToken: "dead-worker", leaseExpiresAt: new Date(Date.now() - 1_000) }).where(eq(campaignContactsTable.id, id));
    await runCampaignTick();
    const [row] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, id));
    expect(started).toHaveLength(1);
    expect(row.leaseToken).not.toBe("dead-worker");
    expect(row.leaseExpiresAt).toBeInstanceOf(Date);
  });

  it("blocks DNC contacts without starting a call", async () => {
    const fixture = await seedCampaign();
    const id = await contact(fixture.tenantId, fixture.campaignId, 9999);
    await runCampaignTick();
    const [row] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, id));
    expect(started).toHaveLength(0);
    expect(row.state).toBe("BLOCKED");
    expect(row.lastDisposition).toBe("DNC_BLOCKED");
  });

  it("does not claim contacts from paused campaigns", async () => {
    const fixture = await seedCampaign({ status: "PAUSED" });
    const id = await contact(fixture.tenantId, fixture.campaignId, 5);
    await runCampaignTick();
    const [row] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, id));
    expect(started).toHaveLength(0);
    expect(row.state).toBe("PENDING");
  });

  it("requeues retryable outcomes and persists configured success fields", async () => {
    const fixture = await seedCampaign();
    const id = await contact(fixture.tenantId, fixture.campaignId, 6, { company: "Acme", ignored: "no" });
    await runCampaignTick();
    await started[0].finished({ disposition: "NO_RESPONSE", outcome: "NO_RESPONSE" }, "call-retry");
    const [row] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, id));
    const [disposition] = await db.select().from(dispositionsTable).where(eq(dispositionsTable.callId, "call-retry"));
    expect(row.state).toBe("PENDING");
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect(disposition.extractedFieldsJson).toEqual({ company: "Acme" });
  });

  it("claims due callbacks ahead of ordinary queue work and fulfills them", async () => {
    const fixture = await seedCampaign({ cap: 1 });
    const ordinary = await contact(fixture.tenantId, fixture.campaignId, 7);
    const callbackContact = await contact(fixture.tenantId, fixture.campaignId, 8);
    // MySQL has no RETURNING; the id is generated here so the row can be read back.
    const callbackId = randomUUID();
    await db.insert(callbacksTable).values({
      id: callbackId, tenantId: fixture.tenantId, campaignId: fixture.campaignId, campaignContactId: callbackContact,
      scheduledFor: new Date(Date.now() - 1_000),
    });
    const [callback] = await db.select().from(callbacksTable).where(eq(callbacksTable.id, callbackId));
    await runCampaignTick();
    expect(started).toHaveLength(1);
    expect(started[0].phone).toBe(phone(8));
    const [updatedCallback] = await db.select().from(callbacksTable).where(eq(callbacksTable.id, callback.id));
    const [ordinaryRow] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, ordinary));
    expect(updatedCallback.fulfilled).toBe(true);
    expect(ordinaryRow.state).toBe("PENDING");
  });

  it("never claims a second tenant's contacts while processing another tenant", async () => {
    const first = await seedCampaign();
    const second = await seedCampaign({ status: "PAUSED" });
    const firstContact = await contact(first.tenantId, first.campaignId, 9);
    const secondContact = await contact(second.tenantId, second.campaignId, 10);
    await runCampaignTick();
    const [one] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, firstContact));
    const [two] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, secondContact));
    expect(one.state).toBe("IN_FLIGHT");
    expect(two.state).toBe("PENDING");
    expect(started.map((call) => call.phone)).toEqual([phone(9)]);
  });

  it("rejects trigger reservations for draft/stopped campaigns and outside schedules", async () => {
    const draft = await seedCampaign({ status: "DRAFT" });
    const stopped = await seedCampaign({ status: "STOPPED" });
    const scheduled = await seedCampaign();
    await db.update(campaignsTable).set({ scheduleJson: { startAt: new Date(Date.now() + 60_000).toISOString() } }).where(eq(campaignsTable.id, scheduled.campaignId));
    const [draftCampaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, draft.campaignId));
    const [stoppedCampaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, stopped.campaignId));
    const [scheduledCampaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, scheduled.campaignId));
    await expect(reserveTriggeredContact(draftCampaign, phone(11), {})).resolves.toMatchObject({ error: "Campaign is not running" });
    await expect(reserveTriggeredContact(stoppedCampaign, phone(12), {})).resolves.toMatchObject({ error: "Campaign is not running" });
    await expect(reserveTriggeredContact(scheduledCampaign, phone(13), {})).resolves.toMatchObject({ error: "Campaign is outside its scheduled calling window" });
    expect(started).toHaveLength(0);
  });

  it("atomically rejects a trigger reservation once campaign capacity is reserved", async () => {
    const fixture = await seedCampaign({ cap: 1 });
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, fixture.campaignId));
    const [one, two] = await Promise.all([
      reserveTriggeredContact(campaign, phone(14), {}),
      reserveTriggeredContact(campaign, phone(15), {}),
    ]);
    expect([one, two].filter((result) => "contact" in result)).toHaveLength(1);
    expect([one, two].filter((result) => "error" in result)).toHaveLength(1);
  });

  it("does not dial when a campaign is stopped after claim but before the launch fence", async () => {
    const fixture = await seedCampaign();
    await contact(fixture.tenantId, fixture.campaignId, 16);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const enteredGate = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(evaluateCompliance).mockImplementationOnce((async () => {
      entered();
      await gate;
      return { allowed: true, decision: "ALLOWED", decisionId: randomUUID(), normalizedPhone: phone(16), reasonCode: "ALLOWED", reason: "Allowed", disclosureText: null, recordingConsentRequired: false };
    }) as never);
    const ticking = runCampaignTick();
    await enteredGate;
    await db.update(campaignsTable).set({ status: "STOPPED" }).where(eq(campaignsTable.id, fixture.campaignId));
    release();
    await ticking;
    expect(started).toHaveLength(0);
    const [row] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.campaignId, fixture.campaignId));
    expect(row.state).toBe("PENDING");
  });

  it("automatically completes a running campaign with no remaining work", async () => {
    const fixture = await seedCampaign();
    await runCampaignTick();
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, fixture.campaignId));
    expect(campaign.status).toBe("COMPLETED");
  });
});