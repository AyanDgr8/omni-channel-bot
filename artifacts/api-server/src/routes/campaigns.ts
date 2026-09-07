import { Router, type IRouter } from "express";
import { and, asc, count, eq, isNull, lte, sql } from "drizzle-orm";
import { botsTable, callbacksTable, campaignContactsTable, campaignsTable, db, dispositionsTable, tenantsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import { z } from "zod";
import { evaluateCompliance, normalizeE164 } from "../lib/compliance-gate.js";
import { startCampaignOutboundCall } from "./calls-router.js";
import { requireRole } from "../middleware/require-role.js";
import { rowsOf, selectOne } from "../lib/db-returning.js";

const router: IRouter = Router();
const lifecycle = z.enum(["DRAFT", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED", "STOPPED"]);
const dispositionCodes = ["CONNECTED_GOAL_MET", "CONNECTED_REFUSED", "CALLBACK_BOOKED", "VOICEMAIL_DROPPED", "NO_ANSWER", "BUSY", "WRONG_NUMBER", "DNC_BLOCKED", "FAILED"] as const;
const TENANT_CONCURRENCY_CAP = 20;
const CLAIM_LEASE_MS = 5 * 60_000;
const transitions: Record<z.infer<typeof lifecycle>, z.infer<typeof lifecycle>[]> = {
  DRAFT: ["SCHEDULED", "RUNNING", "STOPPED"],
  SCHEDULED: ["DRAFT", "RUNNING", "STOPPED"],
  RUNNING: ["PAUSED", "COMPLETED", "STOPPED"],
  PAUSED: ["RUNNING", "STOPPED"],
  COMPLETED: ["STOPPED"],
  STOPPED: [],
};
const campaignInput = z.object({
  name: z.string().min(2).max(120), botId: z.string().min(1), objectivePrompt: z.string().max(6000).default(""),
  scheduleJson: z.record(z.string(), z.unknown()).default({}), callingWindowOverride: z.record(z.string(), z.unknown()).nullable().optional(),
  concurrencyCap: z.coerce.number().int().min(1).max(50).default(1),
  retryPolicyJson: z.record(z.string(), z.unknown()).default({ max_attempts: 3, spacing_minutes: 30, per_outcome: {} }),
  successFieldsJson: z.array(z.string().min(1)).default([]), cliNumber: z.string().nullable().optional(), voicemailScript: z.string().nullable().optional(),
});

function csvRows(csv: string) {
  const records: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === "\"") {
      if (quoted && csv[index + 1] === "\"") { value += "\""; index += 1; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(value); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(value); if (row.some((cell) => cell.length > 0)) records.push(row); row = []; value = "";
    } else value += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted value");
  row.push(value); if (row.some((cell) => cell.length > 0)) records.push(row);
  if (records.length < 2) return { headers: [] as string[], rows: [] as Record<string, string>[] };
  const headers = records[0].map((header, index) => header.replace(/^\uFEFF/, "").trim() || `column_${index + 1}`);
  if (new Set(headers).size !== headers.length) throw new Error("CSV headers must be unique");
  return { headers, rows: records.slice(1).map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""]))) };
}

async function scopedCampaign(tenantId: string, campaignId: string) {
  const [campaign] = await db.select().from(campaignsTable).where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.tenantId, tenantId)));
  return campaign ?? null;
}

function campaignContext(campaign: typeof campaignsTable.$inferSelect, variables: unknown) {
  return [
    `Campaign objective:\n${campaign.objectivePrompt}`,
    `Contact variables:\n${JSON.stringify(variables ?? {})}`,
    `Success fields to capture:\n${JSON.stringify(campaign.successFieldsJson ?? [])}`,
    campaign.voicemailScript ? `Voicemail script (only after machine detection):\n${campaign.voicemailScript}` : "",
  ].filter(Boolean).join("\n\n");
}

function extractSuccessFields(campaign: typeof campaignsTable.$inferSelect, variables: unknown) {
  const source = variables && typeof variables === "object" && !Array.isArray(variables) ? variables as Record<string, unknown> : {};
  const requested = Array.isArray(campaign.successFieldsJson) ? campaign.successFieldsJson.map(String) : [];
  return Object.fromEntries(requested.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]));
}

type ClaimedContact = typeof campaignContactsTable.$inferSelect & { leaseToken: string };

function isCampaignScheduledNow(campaign: typeof campaignsTable.$inferSelect, now: Date) {
  const schedule = (campaign.scheduleJson ?? {}) as Record<string, unknown>;
  const override = (campaign.callingWindowOverride ?? {}) as Record<string, unknown>;
  const startAt = String(schedule.startAt ?? "");
  const endAt = String(schedule.endAt ?? "");
  const localTime = now.toISOString().slice(11, 16);
  const allowedDays = Array.isArray(schedule.allowedDays) ? schedule.allowedDays.map(String) : [];
  const day = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][now.getUTCDay()];
  const windowStart = String(override.start ?? schedule.callingWindowStart ?? "");
  const windowEnd = String(override.end ?? schedule.callingWindowEnd ?? "");
  const inWindow = !windowStart || !windowEnd || (windowStart <= windowEnd ? localTime >= windowStart && localTime <= windowEnd : localTime >= windowStart || localTime <= windowEnd);
  return !(startAt && now < new Date(startAt)) && !(endAt && now > new Date(endAt)) && !(allowedDays.length && !allowedDays.includes(day)) && inWindow;
}

async function releaseLease(contact: ClaimedContact, reason: string) {
  await db.transaction(async (tx) => {
    await tx.update(campaignContactsTable).set({ state: "PENDING", leaseToken: null, leaseExpiresAt: null, leaseError: reason, updatedAt: new Date() })
      .where(and(eq(campaignContactsTable.id, contact.id), eq(campaignContactsTable.tenantId, contact.tenantId), eq(campaignContactsTable.leaseToken, contact.leaseToken)));
    await tx.update(callbacksTable).set({ fulfilled: false }).where(and(eq(callbacksTable.campaignContactId, contact.id), eq(callbacksTable.tenantId, contact.tenantId), eq(callbacksTable.fulfilled, true), isNull(callbacksTable.callId)));
  });
}

/** Final fence before a side effect: validates the current state under locks. */
async function authorizeLeaseStart(campaign: typeof campaignsTable.$inferSelect, contact: ClaimedContact) {
  return db.transaction(async (tx) => {
    const tenant = await tx.execute(sql`SELECT 1 FROM ${tenantsTable} WHERE ${tenantsTable.id} = ${campaign.tenantId} FOR UPDATE`);
    if (!rowsOf(tenant).length) return false;
    await tx.execute(sql`SELECT 1 FROM ${campaignsTable} WHERE ${campaignsTable.id} = ${campaign.id} AND ${campaignsTable.tenantId} = ${campaign.tenantId} FOR UPDATE`);
    const [current] = await tx.select().from(campaignsTable).where(and(eq(campaignsTable.id, campaign.id), eq(campaignsTable.tenantId, campaign.tenantId)));
    if (!current || current.status !== "RUNNING" || !isCampaignScheduledNow(current, new Date())) return false;
    const [lease] = await tx.select().from(campaignContactsTable).where(and(eq(campaignContactsTable.id, contact.id), eq(campaignContactsTable.tenantId, campaign.tenantId), eq(campaignContactsTable.state, "IN_FLIGHT"), eq(campaignContactsTable.leaseToken, contact.leaseToken))).for("update");
    if (!lease) return false;
    const [campaignInFlight] = await tx.select({ total: count() }).from(campaignContactsTable).where(and(eq(campaignContactsTable.campaignId, campaign.id), eq(campaignContactsTable.state, "IN_FLIGHT")));
    const [tenantInFlight] = await tx.select({ total: count() }).from(campaignContactsTable).where(and(eq(campaignContactsTable.tenantId, campaign.tenantId), eq(campaignContactsTable.state, "IN_FLIGHT")));
    return Number(campaignInFlight?.total ?? 0) <= current.concurrencyCap && Number(tenantInFlight?.total ?? 0) <= TENANT_CONCURRENCY_CAP;
  });
}

async function claimDueContacts(campaign: typeof campaignsTable.$inferSelect, now: Date): Promise<ClaimedContact[]> {
  return db.transaction(async (tx) => {
    // Locking the tenant serializes capacity calculations across its campaigns.
    await tx.execute(sql`SELECT 1 FROM ${tenantsTable} WHERE ${tenantsTable.id} = ${campaign.tenantId} FOR UPDATE`);
    const lockedCampaign = await tx.execute(sql`SELECT status FROM ${campaignsTable} WHERE ${campaignsTable.id} = ${campaign.id} AND ${campaignsTable.tenantId} = ${campaign.tenantId} FOR UPDATE`);
    if (rowsOf<{ status: string }>(lockedCampaign)[0]?.status !== "RUNNING") return [];
    await tx.update(campaignContactsTable).set({ state: "PENDING", leaseToken: null, leaseExpiresAt: null, leaseError: "Dial lease expired before completion", updatedAt: now })
      .where(and(eq(campaignContactsTable.campaignId, campaign.id), eq(campaignContactsTable.state, "IN_FLIGHT"), lte(campaignContactsTable.leaseExpiresAt, now)));
    await tx.execute(sql`UPDATE ${callbacksTable} SET fulfilled = false
      WHERE campaign_id = ${campaign.id} AND fulfilled = true AND call_id IS NULL
        AND campaign_contact_id IN (SELECT id FROM ${campaignContactsTable}
          WHERE campaign_id = ${campaign.id} AND state = 'PENDING'
            AND lease_error = 'Dial lease expired before completion')`);
    const [campaignInFlight] = await tx.select({ total: count() }).from(campaignContactsTable).where(and(eq(campaignContactsTable.campaignId, campaign.id), eq(campaignContactsTable.state, "IN_FLIGHT")));
    const [tenantInFlight] = await tx.select({ total: count() }).from(campaignContactsTable).where(and(eq(campaignContactsTable.tenantId, campaign.tenantId), eq(campaignContactsTable.state, "IN_FLIGHT")));
    const capacity = Math.max(0, Math.min(campaign.concurrencyCap - Number(campaignInFlight?.total ?? 0), TENANT_CONCURRENCY_CAP - Number(tenantInFlight?.total ?? 0)));
    if (!capacity) return [];
    const result = await tx.execute(sql`
      SELECT cc.* FROM ${campaignContactsTable} cc WHERE cc.campaign_id = ${campaign.id} AND cc.tenant_id = ${campaign.tenantId}
        AND cc.state = 'PENDING' AND cc.next_attempt_at <= ${now}
      ORDER BY EXISTS (SELECT 1 FROM ${callbacksTable} cb WHERE cb.campaign_contact_id = cc.id
        AND cb.tenant_id = ${campaign.tenantId} AND cb.fulfilled = false AND cb.scheduled_for <= ${now}) DESC, cc.next_attempt_at ASC
      LIMIT ${capacity} FOR UPDATE SKIP LOCKED`);
    // MySQL requires LIMIT before FOR UPDATE / SKIP LOCKED, unlike PostgreSQL.
    // Only `id` and `attempts` are read below, and those names are identical in
    // the raw snake_case rows, so no key remapping is needed.
    const rows = rowsOf<{ id: string; attempts: number }>(result);
    const claimed: ClaimedContact[] = [];
    for (const row of rows) {
      const leaseToken = randomUUID();
      const claim = await tx.update(campaignContactsTable).set({
        state: "IN_FLIGHT", attempts: row.attempts + 1, leaseToken, leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS), leaseError: null, updatedAt: now,
      }).where(and(eq(campaignContactsTable.id, row.id), eq(campaignContactsTable.state, "PENDING")));
      // The guarded UPDATE is the claim; `affectedRows` reports whether it won.
      if (claim[0].affectedRows === 0) continue;
      const [updated] = await tx.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, row.id)).limit(1);
      if (!updated) continue;
      await tx.update(callbacksTable).set({ fulfilled: true }).where(and(eq(callbacksTable.campaignContactId, row.id), eq(callbacksTable.tenantId, campaign.tenantId), eq(callbacksTable.fulfilled, false), lte(callbacksTable.scheduledFor, now)));
      claimed.push({ ...updated, leaseToken });
    }
    return claimed;
  });
}

export async function reserveTriggeredContact(campaign: typeof campaignsTable.$inferSelect, phoneE164: string, variables: Record<string, unknown>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM ${tenantsTable} WHERE ${tenantsTable.id} = ${campaign.tenantId} FOR UPDATE`);
    await tx.execute(sql`SELECT 1 FROM ${campaignsTable} WHERE ${campaignsTable.id} = ${campaign.id} AND ${campaignsTable.tenantId} = ${campaign.tenantId} FOR UPDATE`);
    const [current] = await tx.select().from(campaignsTable).where(and(eq(campaignsTable.id, campaign.id), eq(campaignsTable.tenantId, campaign.tenantId)));
    if (!current || current.status !== "RUNNING") return { error: "Campaign is not running" as const };
    const now = new Date();
    if (!isCampaignScheduledNow(current, now)) return { error: "Campaign is outside its scheduled calling window" as const };
    const [campaignInFlight] = await tx.select({ total: count() }).from(campaignContactsTable).where(and(eq(campaignContactsTable.campaignId, campaign.id), eq(campaignContactsTable.state, "IN_FLIGHT")));
    const [tenantInFlight] = await tx.select({ total: count() }).from(campaignContactsTable).where(and(eq(campaignContactsTable.tenantId, campaign.tenantId), eq(campaignContactsTable.state, "IN_FLIGHT")));
    if (Number(campaignInFlight?.total ?? 0) >= current.concurrencyCap || Number(tenantInFlight?.total ?? 0) >= TENANT_CONCURRENCY_CAP) return { error: "Campaign or tenant outbound capacity is exhausted" as const };
    await tx.execute(sql`SELECT 1 FROM ${campaignContactsTable} WHERE campaign_id = ${campaign.id} AND phone_e164 = ${phoneE164} FOR UPDATE`);
    const [existing] = await tx.select().from(campaignContactsTable).where(and(eq(campaignContactsTable.campaignId, campaign.id), eq(campaignContactsTable.phoneE164, phoneE164), eq(campaignContactsTable.tenantId, campaign.tenantId)));
    if (existing?.state === "IN_FLIGHT") return { error: "Contact already has an active campaign call" as const };
    const leaseToken = randomUUID();
    const values = { state: "IN_FLIGHT", attempts: (existing?.attempts ?? 0) + 1, variablesJson: variables, leaseToken, leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS), leaseError: null, updatedAt: now };
    let contactId: string;
    if (existing) {
      await tx.update(campaignContactsTable).set(values).where(and(eq(campaignContactsTable.id, existing.id), eq(campaignContactsTable.tenantId, campaign.tenantId)));
      contactId = existing.id;
    } else {
      contactId = randomUUID();
      await tx.insert(campaignContactsTable).values({ id: contactId, tenantId: campaign.tenantId, campaignId: campaign.id, phoneE164, ...values });
    }
    const [contact] = await tx.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, contactId)).limit(1);
    return { contact: { ...contact, leaseToken } as ClaimedContact, campaign: current };
  });
}

async function completeIfDrained(campaign: typeof campaignsTable.$inferSelect) {
  await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT status FROM ${campaignsTable} WHERE ${campaignsTable.id} = ${campaign.id} AND ${campaignsTable.tenantId} = ${campaign.tenantId} FOR UPDATE`);
    if (rowsOf<{ status: string }>(locked)[0]?.status !== "RUNNING") return;
    const work = await tx.execute(sql`SELECT 1 FROM ${campaignContactsTable}
      WHERE campaign_id = ${campaign.id} AND tenant_id = ${campaign.tenantId} AND state IN ('PENDING', 'IN_FLIGHT') LIMIT 1`);
    const callbacks = await tx.execute(sql`SELECT 1 FROM ${callbacksTable}
      WHERE campaign_id = ${campaign.id} AND tenant_id = ${campaign.tenantId} AND fulfilled = false LIMIT 1`);
    if (!rowsOf(work).length && !rowsOf(callbacks).length) {
      await tx.update(campaignsTable).set({ status: "COMPLETED", updatedAt: new Date() })
        .where(and(eq(campaignsTable.id, campaign.id), eq(campaignsTable.tenantId, campaign.tenantId), eq(campaignsTable.status, "RUNNING")));
    }
  });
}

async function campaignView(campaign: typeof campaignsTable.$inferSelect) {
  const contacts = await db.select().from(campaignContactsTable).where(and(eq(campaignContactsTable.tenantId, campaign.tenantId), eq(campaignContactsTable.campaignId, campaign.id)));
  const metric = (state: string) => contacts.filter((contact) => contact.state === state).length;
  const dispositions = await db.select().from(dispositionsTable).where(and(eq(dispositionsTable.tenantId, campaign.tenantId), eq(dispositionsTable.campaignId, campaign.id)));
  return {
    ...campaign,
    metrics: {
      total: contacts.length, queued: metric("PENDING"), dialing: metric("IN_FLIGHT"), blocked: metric("BLOCKED"), done: metric("DONE"),
      goalMet: dispositions.filter((item) => item.code === "CONNECTED_GOAL_MET").length, dispositions: dispositions.length,
    },
  };
}

router.get("/v1/campaigns", async (req, res) => {
  const campaigns = await db.select().from(campaignsTable).where(eq(campaignsTable.tenantId, req.tenantId!)).orderBy(asc(campaignsTable.createdAt));
  res.json(await Promise.all(campaigns.map(campaignView)));
});

router.post("/v1/campaigns", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const parsed = campaignInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [bot] = await db.select().from(botsTable).where(and(eq(botsTable.id, parsed.data.botId), eq(botsTable.tenantId, req.tenantId!)));
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  const campaignId = randomUUID();
  await db.insert(campaignsTable).values({
    id: campaignId, tenantId: req.tenantId!, botId: bot.id, name: parsed.data.name, objectivePrompt: parsed.data.objectivePrompt,
    scheduleJson: parsed.data.scheduleJson, callingWindowOverride: parsed.data.callingWindowOverride ?? null, concurrencyCap: parsed.data.concurrencyCap,
    retryPolicyJson: parsed.data.retryPolicyJson, successFieldsJson: parsed.data.successFieldsJson, cliNumber: parsed.data.cliNumber ?? null, voicemailScript: parsed.data.voicemailScript ?? null,
  });
  const campaign = (await selectOne(campaignsTable, eq(campaignsTable.id, campaignId)))!;
  res.status(201).json(await campaignView(campaign));
});

router.get("/v1/campaigns/:id", async (req, res): Promise<void> => {
  const campaign = await scopedCampaign(req.tenantId!, String(req.params.id));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json(await campaignView(campaign));
});

router.patch("/v1/campaigns/:id", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const campaign = await scopedCampaign(req.tenantId!, String(req.params.id));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  const parsed = campaignInput.partial().extend({ status: lifecycle.optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (parsed.data.status && !transitions[campaign.status as z.infer<typeof lifecycle>]?.includes(parsed.data.status)) {
    res.status(409).json({ error: `Cannot transition campaign from ${campaign.status} to ${parsed.data.status}. Stopped campaigns must be cloned.` }); return;
  }
  const campaignScope = and(eq(campaignsTable.id, campaign.id), eq(campaignsTable.tenantId, req.tenantId!));
  await db.update(campaignsTable).set({ ...parsed.data, updatedAt: new Date() }).where(campaignScope);
  const updated = (await selectOne(campaignsTable, campaignScope))!;
  res.json(await campaignView(updated));
});

router.post("/v1/campaigns/:id/stop", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const campaign = await scopedCampaign(req.tenantId!, String(req.params.id));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (campaign.status === "STOPPED") { res.json(await campaignView(campaign)); return; }
  const stopped = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM ${tenantsTable} WHERE ${tenantsTable.id} = ${req.tenantId!} FOR UPDATE`);
    await tx.execute(sql`SELECT 1 FROM ${campaignsTable} WHERE ${campaignsTable.id} = ${campaign.id} AND ${campaignsTable.tenantId} = ${req.tenantId!} FOR UPDATE`);
    await tx.update(campaignsTable).set({ status: "STOPPED", updatedAt: new Date() })
      .where(and(eq(campaignsTable.id, campaign.id), eq(campaignsTable.tenantId, req.tenantId!)));
    const [updated] = await tx.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, campaign.id), eq(campaignsTable.tenantId, req.tenantId!))).limit(1);
    return updated;
  });
  res.json(await campaignView(stopped));
});

router.post("/v1/campaigns/:id/clone", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const campaign = await scopedCampaign(req.tenantId!, String(req.params.id));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  const body = z.object({ name: z.string().min(2).max(120).optional(), copyContacts: z.boolean().default(false) }).safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const cloneId = randomUUID();
  await db.insert(campaignsTable).values({
    id: cloneId, tenantId: campaign.tenantId, botId: campaign.botId, name: body.data.name ?? `${campaign.name} (A/B variant)`,
    objectivePrompt: campaign.objectivePrompt, scheduleJson: campaign.scheduleJson, callingWindowOverride: campaign.callingWindowOverride,
    concurrencyCap: campaign.concurrencyCap, retryPolicyJson: campaign.retryPolicyJson, successFieldsJson: campaign.successFieldsJson,
    cliNumber: campaign.cliNumber, voicemailScript: campaign.voicemailScript, abVariantOf: campaign.abVariantOf ?? campaign.id, status: "DRAFT",
  });
  const clone = (await selectOne(campaignsTable, eq(campaignsTable.id, cloneId)))!;
  if (body.data.copyContacts) {
    const contacts = await db.select().from(campaignContactsTable).where(and(eq(campaignContactsTable.tenantId, req.tenantId!), eq(campaignContactsTable.campaignId, campaign.id)));
    if (contacts.length) await db.insert(campaignContactsTable).values(contacts.map((contact) => ({
      id: randomUUID(), tenantId: contact.tenantId, campaignId: clone.id, phoneE164: contact.phoneE164, variablesJson: contact.variablesJson,
      state: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastDisposition: null, blockReason: null, callId: null,
    }))).onDuplicateKeyUpdate({ set: { id: sql`id` } });
  }
  res.status(201).json(await campaignView(clone));
});

router.post("/v1/campaigns/:id/contacts/import", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const body = z.object({ csv: z.string().min(2), phoneColumn: z.string().min(1), variableColumns: z.array(z.string()).default([]), mapping: z.record(z.string(), z.string()).optional(), previewOnly: z.boolean().default(false) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const campaign = await scopedCampaign(req.tenantId!, String(req.params.id));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  let parsedCsv: ReturnType<typeof csvRows>;
  try { parsedCsv = csvRows(body.data.csv); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid CSV" }); return; }
  const { headers, rows } = parsedCsv;
  if (!headers.includes(body.data.phoneColumn)) { res.status(400).json({ error: "Mapped phone column was not found in CSV" }); return; }
  const variableColumns = body.data.mapping ? Object.values(body.data.mapping) : body.data.variableColumns;
  if (variableColumns.some((column) => !headers.includes(column))) { res.status(400).json({ error: "A mapped variable column was not found in CSV" }); return; }
  const report: Array<{ row: number; phone?: string; state: "PENDING" | "BLOCKED"; reason?: string }> = [];
  for (const [index, row] of rows.entries()) {
    try {
      const phone = normalizeE164(row[body.data.phoneColumn] ?? "");
      const gate = await evaluateCompliance({ tenantId: req.tenantId!, botId: campaign.botId, phoneNumber: phone, direction: "OUTBOUND" });
      report.push({ row: index + 2, phone, state: gate.allowed ? "PENDING" : "BLOCKED", reason: gate.allowed ? undefined : gate.reason });
      if (!body.data.previewOnly) {
        await db.insert(campaignContactsTable).values({
          id: randomUUID(), tenantId: req.tenantId!, campaignId: campaign.id, phoneE164: phone,
           variablesJson: body.data.mapping ? Object.fromEntries(Object.entries(body.data.mapping).map(([variable, column]) => [variable, row[column] ?? ""])) : Object.fromEntries(variableColumns.map((key) => [key, row[key] ?? ""])),
          state: gate.allowed ? "PENDING" : "BLOCKED", blockReason: gate.allowed ? null : gate.reason,
        }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
      }
    } catch (error) {
      report.push({ row: index + 2, state: "BLOCKED", reason: error instanceof Error ? error.message : "Invalid phone number" });
    }
  }
  res.json({ headers, total: rows.length, allowed: report.filter((row) => row.state === "PENDING").length, blocked: report.filter((row) => row.state === "BLOCKED").length, rows: report });
});

router.get("/v1/campaigns/:id/contacts", async (req, res) => {
  const campaign = await scopedCampaign(req.tenantId!, String(req.params.id));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json(await db.select().from(campaignContactsTable).where(and(eq(campaignContactsTable.tenantId, req.tenantId!), eq(campaignContactsTable.campaignId, campaign.id))).orderBy(asc(campaignContactsTable.createdAt)));
});

router.post("/v1/campaigns/:id/trigger-call", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const body = z.object({ phone: z.string().min(1), variables: z.record(z.string(), z.unknown()).default({}) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const campaign = await scopedCampaign(req.tenantId!, String(req.params.id));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  const compliance = await evaluateCompliance({ tenantId: req.tenantId!, botId: campaign.botId, phoneNumber: body.data.phone, direction: "OUTBOUND" });
  if (!compliance.allowed) { res.status(409).json({ error: compliance.reason, reasonCode: compliance.reasonCode, decision: "BLOCKED" }); return; }
  const reservation = await reserveTriggeredContact(campaign, compliance.normalizedPhone, body.data.variables);
  if ("error" in reservation) { res.status(409).json({ error: reservation.error }); return; }
  const contact = reservation.contact;
  const currentCampaign = reservation.campaign;
  if (!await authorizeLeaseStart(currentCampaign, contact)) {
    await releaseLease(contact, "Campaign was stopped, unscheduled, or capacity changed before dialing");
    res.status(409).json({ error: "Campaign is no longer eligible to place this call" }); return;
  }
  let call: Awaited<ReturnType<typeof startCampaignOutboundCall>>;
  try {
    call = await startCampaignOutboundCall({
      tenantId: req.tenantId!, botId: currentCampaign.botId, phoneNumber: compliance.normalizedPhone, compliance,
      campaignContext: campaignContext(currentCampaign, body.data.variables),
      onFinished: async (result, callId) => {
        const code = result.disposition === "VOICEMAIL_LEFT" ? "VOICEMAIL_DROPPED" : result.disposition === "NO_RESPONSE" ? "NO_ANSWER" : "CONNECTED_GOAL_MET";
        await db.transaction(async (tx) => {
          await tx.insert(dispositionsTable).values({ id: randomUUID(), tenantId: req.tenantId!, campaignId: currentCampaign.id, campaignContactId: contact.id, callId, code, summaryText: `Trigger call completed: ${code}`, extractedFieldsJson: extractSuccessFields(currentCampaign, body.data.variables) }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
          await tx.update(campaignContactsTable).set({ state: "DONE", callId, lastDisposition: code, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(and(eq(campaignContactsTable.id, contact.id), eq(campaignContactsTable.leaseToken, contact.leaseToken)));
        });
      },
    });
  } catch (error) {
    await releaseLease(contact, error instanceof Error ? error.message : "Outbound call initiation failed");
    res.status(502).json({ error: "Unable to initiate campaign call; the contact was requeued." }); return;
  }
  await db.update(campaignContactsTable).set({ callId: call.id, updatedAt: new Date() })
    .where(and(eq(campaignContactsTable.id, contact.id), eq(campaignContactsTable.tenantId, req.tenantId!), eq(campaignContactsTable.leaseToken, contact.leaseToken)));
  res.status(201).json({ call, campaignId: campaign.id, objectivePrompt: campaign.objectivePrompt, variables: body.data.variables });
});

router.get("/v1/campaigns/:id/callbacks", async (req, res): Promise<void> => {
  const campaign = await scopedCampaign(req.tenantId!, String(req.params.id));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  const callbacks = await db.select().from(callbacksTable).where(and(eq(callbacksTable.tenantId, req.tenantId!), eq(callbacksTable.campaignId, campaign.id))).orderBy(asc(callbacksTable.scheduledFor));
  res.json(callbacks);
});

router.post("/v1/campaigns/:id/callbacks", requireRole("SUPERVISOR"), async (req, res): Promise<void> => {
  const body = z.object({ campaignContactId: z.string().min(1), scheduledFor: z.coerce.date(), note: z.string().max(1000).optional(), callId: z.string().optional() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const campaignId = String(req.params.id);
  const campaign = await scopedCampaign(req.tenantId!, campaignId);
  const [contact] = await db.select().from(campaignContactsTable).where(and(eq(campaignContactsTable.id, body.data.campaignContactId), eq(campaignContactsTable.campaignId, campaignId), eq(campaignContactsTable.tenantId, req.tenantId!)));
  if (!campaign || !contact) { res.status(404).json({ error: "Campaign contact not found" }); return; }
  const callbackId = randomUUID();
  await db.insert(callbacksTable).values({ id: callbackId, tenantId: req.tenantId!, campaignId: campaign.id, campaignContactId: contact.id, scheduledFor: body.data.scheduledFor, note: body.data.note ?? null, callId: body.data.callId ?? null });
  const callback = await selectOne(callbacksTable, eq(callbacksTable.id, callbackId));
  await db.update(campaignContactsTable).set({ state: "PENDING", nextAttemptAt: body.data.scheduledFor, lastDisposition: "CALLBACK_BOOKED", updatedAt: new Date() }).where(eq(campaignContactsTable.id, contact.id));
  res.status(201).json(callback);
});

router.get("/v1/campaigns/:id/dispositions", async (req, res): Promise<void> => {
  const campaign = await scopedCampaign(req.tenantId!, String(req.params.id));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  const rows = await db.select().from(dispositionsTable).where(and(eq(dispositionsTable.tenantId, req.tenantId!), eq(dispositionsTable.campaignId, campaign.id))).orderBy(asc(dispositionsTable.createdAt));
  if (req.query.format === "csv") {
    res.type("text/csv").set("Content-Disposition", `attachment; filename="${campaign.name.replace(/[^\w-]/g, "-")}-dispositions.csv"`).send(`call_id,code,summary,created_at\n${rows.map((row) => [row.callId, row.code, JSON.stringify(row.summaryText ?? ""), row.createdAt.toISOString()].join(",")).join("\n")}\n`);
    return;
  }
  res.json(rows);
});

export async function runCampaignTick() {
  const active = await db.select().from(campaignsTable).where(eq(campaignsTable.status, "RUNNING"));
  for (const campaign of active) {
    const now = new Date();
    if (!isCampaignScheduledNow(campaign, now)) { await completeIfDrained(campaign); continue; }
    const contacts = await claimDueContacts(campaign, now);
    for (const contact of contacts) {
      try {
        const gate = await evaluateCompliance({ tenantId: campaign.tenantId, botId: campaign.botId, phoneNumber: contact.phoneE164, direction: "OUTBOUND" });
        if (!gate.allowed) {
          await db.update(campaignContactsTable).set({ state: "BLOCKED", blockReason: gate.reason, lastDisposition: "DNC_BLOCKED", leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() })
            .where(and(eq(campaignContactsTable.id, contact.id), eq(campaignContactsTable.leaseToken, contact.leaseToken)));
          continue;
        }
        if (!await authorizeLeaseStart(campaign, contact)) {
          await releaseLease(contact, "Campaign was stopped, unscheduled, or capacity changed before dialing");
          continue;
        }
        const call = await startCampaignOutboundCall({
          tenantId: campaign.tenantId, botId: campaign.botId, phoneNumber: contact.phoneE164, compliance: gate,
          campaignContext: campaignContext(campaign, contact.variablesJson),
          onFinished: async (result, callId) => {
            const resultCode = result.disposition === "VOICEMAIL_LEFT" ? "VOICEMAIL_DROPPED" : result.disposition === "NO_RESPONSE" || result.disposition === "AMD_HANGUP" ? "NO_ANSWER" : result.disposition === "FAILED" ? "FAILED" : "CONNECTED_GOAL_MET";
            const code = dispositionCodes.includes(resultCode as typeof dispositionCodes[number]) ? resultCode as typeof dispositionCodes[number] : "FAILED";
            const retry = (campaign.retryPolicyJson as { max_attempts?: number; spacing_minutes?: number; per_outcome?: Record<string, string> }) ?? {};
            const retryable = ["NO_ANSWER", "BUSY", "FAILED"].includes(code) && contact.attempts < (retry.max_attempts ?? 3) && retry.per_outcome?.[code] !== "skip";
            await db.transaction(async (tx) => {
              const owned = await tx.update(campaignContactsTable).set(retryable
                ? { state: "PENDING", nextAttemptAt: new Date(Date.now() + (retry.spacing_minutes ?? 30) * 60_000), lastDisposition: code, callId, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }
                : { state: "DONE", lastDisposition: code, callId, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() })
                .where(and(eq(campaignContactsTable.id, contact.id), eq(campaignContactsTable.state, "IN_FLIGHT"), eq(campaignContactsTable.leaseToken, contact.leaseToken)));
              // Still lease-guarded: 0 rows means the lease was recovered by
              // another worker, so a newer attempt must not be overwritten.
              if (owned[0].affectedRows === 0) return;
              await tx.insert(dispositionsTable).values({ id: randomUUID(), tenantId: campaign.tenantId, campaignId: campaign.id, campaignContactId: contact.id, callId, code, summaryText: `Campaign call completed: ${code}`, extractedFieldsJson: extractSuccessFields(campaign, contact.variablesJson) }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
            });
          },
        });
        await db.update(campaignContactsTable).set({ callId: call.id, updatedAt: new Date() })
          .where(and(eq(campaignContactsTable.id, contact.id), eq(campaignContactsTable.tenantId, campaign.tenantId), eq(campaignContactsTable.leaseToken, contact.leaseToken)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Outbound call initiation failed";
        await db.transaction(async (tx) => {
          await tx.update(campaignContactsTable).set({ state: "PENDING", nextAttemptAt: new Date(Date.now() + 60_000), leaseToken: null, leaseExpiresAt: null, leaseError: message, updatedAt: new Date() })
            .where(and(eq(campaignContactsTable.id, contact.id), eq(campaignContactsTable.leaseToken, contact.leaseToken)));
          await tx.update(callbacksTable).set({ fulfilled: false }).where(and(eq(callbacksTable.campaignContactId, contact.id), eq(callbacksTable.tenantId, campaign.tenantId), eq(callbacksTable.fulfilled, true), isNull(callbacksTable.callId)));
        });
      }
    }
    await completeIfDrained(campaign);
  }
}

export default router;