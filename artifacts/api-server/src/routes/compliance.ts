import { Router, type IRouter } from "express";
// `ilike` is PostgreSQL-only. The schema's utf8mb4_0900_ai_ci collation makes
// MySQL `LIKE` case-insensitive already, so plain `like` is the equivalent here.
import { and, desc, eq, like } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  callsTable,
  complianceDecisionsTable,
  complianceProfilesTable,
  consentLedgerTable,
  dncEntriesTable,
} from "@workspace/db";
import { z } from "zod";
import { requireRole } from "../middleware/require-role.js";
import { auditMiddleware } from "../middleware/audit.js";
import { selectOne } from "../lib/db-returning.js";
import {
  evaluateCompliance,
  listComplianceProfiles,
  normalizeE164,
} from "../lib/compliance-gate.js";

const router: IRouter = Router();
const dncBody = z.object({
  phoneNumber: z.string().min(1),
  source: z.string().min(1).max(80).optional(),
  reason: z.string().max(500).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});
const consentBody = z.object({
  phoneNumber: z.string().min(1),
  consentType: z.enum(["VOICE_CALLING", "RECORDING"]),
  status: z.enum(["GRANTED", "REVOKED"]),
  source: z.string().min(1).max(80).optional(),
  evidence: z.string().max(2000).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});
const profileBody = z.object({
  displayName: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  timezone: z.string().min(1).max(80),
  callingWindowStart: z.string().regex(/^\d{2}:\d{2}$/),
  callingWindowEnd: z.string().regex(/^\d{2}:\d{2}$/),
  allowedDays: z.array(z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"])).min(1),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
  requireConsent: z.boolean(),
  requireRecordingConsent: z.boolean(),
  mandatoryDisclosureText: z.string().max(1000).nullable().optional(),
  blockOnHoliday: z.boolean(),
});

function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

// ─── DNC registry ────────────────────────────────────────────────────────────

router.get("/v1/compliance/dnc", async (req, res): Promise<void> => {
  const query = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const conditions = [eq(dncEntriesTable.tenantId, req.tenantId!)];
  if (query) conditions.push(like(dncEntriesTable.phoneNumber, `%${query}%`));
  const entries = await db
    .select()
    .from(dncEntriesTable)
    .where(and(...conditions))
    .orderBy(desc(dncEntriesTable.addedAt));
  res.json(entries);
});

router.post("/v1/compliance/dnc", requireRole("ADMIN"), auditMiddleware("dnc_entry"), async (req, res): Promise<void> => {
  const parsed = dncBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let phoneNumber: string;
  try { phoneNumber = normalizeE164(parsed.data.phoneNumber); } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid phone number" }); return;
  }

  const [existing] = await db.select().from(dncEntriesTable).where(and(
    eq(dncEntriesTable.tenantId, req.tenantId!),
    eq(dncEntriesTable.phoneNumber, phoneNumber),
  )).limit(1);
  const values = {
    source: parsed.data.source ?? "manual",
    reason: parsed.data.reason ?? null,
    expiresAt: parsed.data.expiresAt ?? null,
    createdByUserId: req.userId ?? null,
  };
  // MySQL has no RETURNING, so each write is followed by a keyed read-back.
  let entryId: string;
  if (existing) {
    await db.update(dncEntriesTable).set(values).where(eq(dncEntriesTable.id, existing.id));
    entryId = existing.id;
  } else {
    entryId = randomUUID();
    await db.insert(dncEntriesTable).values({
      id: entryId, tenantId: req.tenantId!, phoneNumber, ...values,
    });
  }
  const entry = await selectOne(dncEntriesTable, eq(dncEntriesTable.id, entryId));
  res.status(existing ? 200 : 201).json(entry);
});

router.delete("/v1/compliance/dnc/:id", requireRole("ADMIN"), auditMiddleware("dnc_entry"), async (req, res): Promise<void> => {
  // Read the row before deleting it — MySQL cannot return the deleted row.
  const scope = and(
    eq(dncEntriesTable.id, req.params.id as string),
    eq(dncEntriesTable.tenantId, req.tenantId!),
  );
  const deleted = await selectOne(dncEntriesTable, scope);
  if (!deleted) { res.status(404).json({ error: "DNC entry not found" }); return; }
  await db.delete(dncEntriesTable).where(scope);
  res.json(deleted);
});

router.post("/v1/compliance/dnc/import", requireRole("ADMIN"), auditMiddleware("dnc_entry"), async (req, res): Promise<void> => {
  const csv = typeof req.body?.csv === "string" ? req.body.csv : "";
  if (!csv.trim()) { res.status(400).json({ error: "csv is required" }); return; }
  const lines = csv.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
  const header = parseCsvLine(lines.shift() ?? "").map((value) => value.toLowerCase());
  const phoneIndex = header.findIndex((value) => ["phone", "phonenumber", "phone_number"].includes(value));
  if (phoneIndex < 0) { res.status(400).json({ error: "CSV must include a phone or phone_number column" }); return; }
  let imported = 0;
  const errors: string[] = [];
  for (const [lineNumber, line] of lines.entries()) {
    const values = parseCsvLine(line);
    try {
      const phoneNumber = normalizeE164(values[phoneIndex] ?? "");
      const reason = values[header.indexOf("reason")] || null;
      const [existing] = await db.select({ id: dncEntriesTable.id }).from(dncEntriesTable).where(and(
        eq(dncEntriesTable.tenantId, req.tenantId!), eq(dncEntriesTable.phoneNumber, phoneNumber),
      )).limit(1);
      if (existing) {
        await db.update(dncEntriesTable).set({ source: "csv_import", reason, createdByUserId: req.userId ?? null }).where(eq(dncEntriesTable.id, existing.id));
      } else {
        await db.insert(dncEntriesTable).values({
          id: randomUUID(), tenantId: req.tenantId!, phoneNumber, source: "csv_import",
          reason, createdByUserId: req.userId ?? null,
        });
      }
      imported += 1;
    } catch (error) {
      errors.push(`line ${lineNumber + 2}: ${error instanceof Error ? error.message : "invalid row"}`);
    }
  }
  res.json({ imported, rejected: errors.length, errors });
});

router.get("/v1/compliance/dnc/export", async (req, res): Promise<void> => {
  const entries = await db.select().from(dncEntriesTable)
    .where(eq(dncEntriesTable.tenantId, req.tenantId!))
    .orderBy(desc(dncEntriesTable.addedAt));
  const rows = [
    "phone_number,source,reason,added_at,expires_at",
    ...entries.map((entry) => [
      entry.phoneNumber, entry.source, entry.reason, entry.addedAt.toISOString(), entry.expiresAt?.toISOString(),
    ].map(csvEscape).join(",")),
  ];
  res.type("text/csv").set("Content-Disposition", "attachment; filename=dnc-export.csv").send(`${rows.join("\n")}\n`);
});

// ─── Consent ledger ──────────────────────────────────────────────────────────

router.get("/v1/compliance/consents", async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const conditions = [eq(consentLedgerTable.tenantId, req.tenantId!)];
  if (search) conditions.push(like(consentLedgerTable.phoneNumber, `%${search}%`));
  const entries = await db.select().from(consentLedgerTable)
    .where(and(...conditions)).orderBy(desc(consentLedgerTable.capturedAt)).limit(200);
  res.json(entries);
});

router.post("/v1/compliance/consents", requireRole("SUPERVISOR"), auditMiddleware("consent_ledger"), async (req, res): Promise<void> => {
  const parsed = consentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let phoneNumber: string;
  try { phoneNumber = normalizeE164(parsed.data.phoneNumber); } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid phone number" }); return;
  }
  const entryId = randomUUID();
  await db.insert(consentLedgerTable).values({
    id: entryId, tenantId: req.tenantId!, phoneNumber,
    consentType: parsed.data.consentType, status: parsed.data.status,
    source: parsed.data.source ?? "manual", evidence: parsed.data.evidence ?? null,
    expiresAt: parsed.data.expiresAt ?? null, actorUserId: req.userId ?? null,
  });
  const entry = await selectOne(consentLedgerTable, eq(consentLedgerTable.id, entryId));
  res.status(201).json(entry);
});

router.post("/v1/compliance/consents/:id/revoke", requireRole("SUPERVISOR"), auditMiddleware("consent_ledger"), async (req, res): Promise<void> => {
  const [current] = await db.select().from(consentLedgerTable).where(and(
    eq(consentLedgerTable.id, req.params.id as string),
    eq(consentLedgerTable.tenantId, req.tenantId!),
  )).limit(1);
  if (!current) { res.status(404).json({ error: "Consent entry not found" }); return; }
  const revokedId = randomUUID();
  await db.insert(consentLedgerTable).values({
    id: revokedId, tenantId: req.tenantId!, phoneNumber: current.phoneNumber,
    consentType: current.consentType, status: "REVOKED", source: "manual",
    evidence: "Revoked from compliance console", actorUserId: req.userId ?? null,
  });
  const entry = await selectOne(consentLedgerTable, eq(consentLedgerTable.id, revokedId));
  res.status(201).json(entry);
});

// ─── Jurisdiction profiles ───────────────────────────────────────────────────

router.get("/v1/compliance/profiles", async (req, res): Promise<void> => {
  res.json(await listComplianceProfiles(req.tenantId!));
});

router.put("/v1/compliance/profiles/:jurisdictionCode", requireRole("ADMIN"), auditMiddleware("compliance_profile"), async (req, res): Promise<void> => {
  const jurisdictionCode = (req.params.jurisdictionCode as string).toUpperCase();
  if (!/^[A-Z]{2,12}$/.test(jurisdictionCode)) { res.status(400).json({ error: "Invalid jurisdiction code" }); return; }
  const parsed = profileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select().from(complianceProfilesTable).where(and(
    eq(complianceProfilesTable.tenantId, req.tenantId!),
    eq(complianceProfilesTable.jurisdictionCode, jurisdictionCode),
  )).limit(1);
  const values = {
    ...parsed.data,
    mandatoryDisclosureText: parsed.data.mandatoryDisclosureText ?? null,
    updatedAt: new Date(),
  };
  let profileId: string;
  if (existing) {
    await db.update(complianceProfilesTable).set(values).where(eq(complianceProfilesTable.id, existing.id));
    profileId = existing.id;
  } else {
    profileId = randomUUID();
    await db.insert(complianceProfilesTable).values({
      id: profileId, tenantId: req.tenantId!, jurisdictionCode, ...values,
    });
  }
  const profile = await selectOne(complianceProfilesTable, eq(complianceProfilesTable.id, profileId));
  res.json(profile);
});

// ─── Decision evidence and in-call opt-out ───────────────────────────────────

router.get("/v1/compliance/evidence", async (req, res): Promise<void> => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const entries = await db.select().from(complianceDecisionsTable)
    .where(eq(complianceDecisionsTable.tenantId, req.tenantId!))
    .orderBy(desc(complianceDecisionsTable.evaluatedAt)).limit(limit);
  res.json(entries);
});

router.get("/v1/compliance/evidence/export", async (req, res): Promise<void> => {
  const entries = await db.select().from(complianceDecisionsTable)
    .where(eq(complianceDecisionsTable.tenantId, req.tenantId!))
    .orderBy(desc(complianceDecisionsTable.evaluatedAt));
  const rows = [
    "evaluated_at,phone_number,direction,decision,reason_code,reason,jurisdiction_code,timezone,call_id",
    ...entries.map((entry) => [
      entry.evaluatedAt.toISOString(), entry.phoneNumber, entry.direction, entry.decision,
      entry.reasonCode, entry.reason, entry.jurisdictionCode, entry.calledPartyTimezone, entry.callId,
    ].map(csvEscape).join(",")),
  ];
  res.type("text/csv").set("Content-Disposition", "attachment; filename=compliance-evidence.csv").send(`${rows.join("\n")}\n`);
});

router.post("/v1/compliance/opt-out", requireRole("SUPERVISOR"), auditMiddleware("dnc_entry"), async (req, res): Promise<void> => {
  const parsed = z.object({ phoneNumber: z.string().min(1), callId: z.string().optional(), reason: z.string().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let phoneNumber: string;
  try { phoneNumber = normalizeE164(parsed.data.phoneNumber); } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid phone number" }); return;
  }
  if (parsed.data.callId) {
    const [call] = await db.select({ id: callsTable.id }).from(callsTable).where(and(
      eq(callsTable.id, parsed.data.callId), eq(callsTable.tenantId, req.tenantId!),
    )).limit(1);
    if (!call) { res.status(404).json({ error: "Call not found" }); return; }
  }
  const [existing] = await db.select().from(dncEntriesTable).where(and(
    eq(dncEntriesTable.tenantId, req.tenantId!), eq(dncEntriesTable.phoneNumber, phoneNumber),
  )).limit(1);
  let optOutId: string;
  if (existing) {
    await db.update(dncEntriesTable).set({ source: "in_call_opt_out", reason: parsed.data.reason ?? "Caller opted out", createdByUserId: req.userId ?? null }).where(eq(dncEntriesTable.id, existing.id));
    optOutId = existing.id;
  } else {
    optOutId = randomUUID();
    await db.insert(dncEntriesTable).values({
      id: optOutId, tenantId: req.tenantId!, phoneNumber, source: "in_call_opt_out",
      reason: parsed.data.reason ?? "Caller opted out", createdByUserId: req.userId ?? null,
    });
  }
  const entry = await selectOne(dncEntriesTable, eq(dncEntriesTable.id, optOutId));
  res.status(existing ? 200 : 201).json({ optedOut: true, entry });
});

export default router;