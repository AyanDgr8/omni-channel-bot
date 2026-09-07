import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  complianceDecisionsTable,
  complianceProfilesTable,
  consentLedgerTable,
  dncEntriesTable,
  type ComplianceProfile,
} from "@workspace/db";
import { randomUUID } from "crypto";

export type ComplianceDecision = "ALLOWED" | "BLOCKED";
export type ComplianceReasonCode =
  | "ALLOWED"
  | "DNC_LISTED"
  | "CONSENT_MISSING"
  | "CONSENT_REVOKED"
  | "CONSENT_EXPIRED"
  | "HOLIDAY"
  | "DISALLOWED_DAY"
  | "OUTSIDE_CALLING_WINDOW";

export interface ComplianceEvaluationInput {
  tenantId: string;
  botId: string;
  phoneNumber: string;
  direction: "INBOUND" | "OUTBOUND";
  botTimezone?: string | null;
  now?: Date;
}

export interface ComplianceEvaluation {
  allowed: boolean;
  decision: ComplianceDecision;
  decisionId: string;
  normalizedPhone: string;
  reasonCode: ComplianceReasonCode;
  reason: string;
  jurisdictionCode: string;
  calledPartyTimezone: string;
  disclosureText: string | null;
  recordingConsentRequired: boolean;
  profile: ComplianceProfile;
}

const DEFAULT_ALLOWED_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const INDIA_DISCLOSURE = "You are speaking with an AI assistant on behalf of VoxAgent.";

/** Normalize common phone input without silently accepting ambiguous short numbers. */
export function normalizeE164(value: string): string {
  const raw = value.trim();
  const digits = raw.replace(/[^\d+]/g, "");
  const normalized = digits.startsWith("00")
    ? `+${digits.slice(2)}`
    : digits.startsWith("+")
      ? digits
      : digits.length === 10
        ? `+1${digits}`
        : `+${digits}`;

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error("Phone number must be a valid E.164 number");
  }
  return normalized;
}

function jurisdictionForPhone(phoneNumber: string): string {
  return phoneNumber.startsWith("+91") ? "IN" : "DEFAULT";
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function formatLocalParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    day: get("weekday").toUpperCase().slice(0, 3),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

export function isWithinWindow(current: string, start: string, end: string): boolean {
  if (start === end) return current === start;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

async function ensureTenantProfiles(tenantId: string): Promise<void> {
  const existing = await db
    .select({ jurisdictionCode: complianceProfilesTable.jurisdictionCode })
    .from(complianceProfilesTable)
    .where(eq(complianceProfilesTable.tenantId, tenantId));
  const jurisdictions = new Set(existing.map((profile) => profile.jurisdictionCode));
  const rows = [];
  if (!jurisdictions.has("DEFAULT")) {
    rows.push({
      id: `cp-${tenantId}-default`,
      tenantId,
      jurisdictionCode: "DEFAULT",
      displayName: "Default calling policy",
      timezone: "UTC",
      allowedDays: DEFAULT_ALLOWED_DAYS,
      holidays: [],
    });
  }
  if (!jurisdictions.has("IN")) {
    rows.push({
      id: `cp-${tenantId}-in`,
      tenantId,
      jurisdictionCode: "IN",
      displayName: "India calling policy",
      timezone: "Asia/Kolkata",
      allowedDays: DEFAULT_ALLOWED_DAYS,
      holidays: [],
      mandatoryDisclosureText: INDIA_DISCLOSURE,
    });
  }
  if (rows.length) {
    // MySQL has no `ON CONFLICT DO NOTHING`. Writing a column back to itself
    // is the standard no-op equivalent: a duplicate key leaves the row as-is.
    await db.insert(complianceProfilesTable).values(rows).onDuplicateKeyUpdate({
      set: { id: sql`id` },
    });
  }
}

export async function listComplianceProfiles(tenantId: string): Promise<ComplianceProfile[]> {
  await ensureTenantProfiles(tenantId);
  return db
    .select()
    .from(complianceProfilesTable)
    .where(eq(complianceProfilesTable.tenantId, tenantId))
    .orderBy(complianceProfilesTable.jurisdictionCode);
}

async function profileForPhone(tenantId: string, phoneNumber: string): Promise<ComplianceProfile> {
  await ensureTenantProfiles(tenantId);
  const jurisdictionCode = jurisdictionForPhone(phoneNumber);
  const [specific] = await db
    .select()
    .from(complianceProfilesTable)
    .where(and(
      eq(complianceProfilesTable.tenantId, tenantId),
      eq(complianceProfilesTable.jurisdictionCode, jurisdictionCode),
      eq(complianceProfilesTable.enabled, true),
    ))
    .limit(1);
  if (specific) return specific;

  const [fallback] = await db
    .select()
    .from(complianceProfilesTable)
    .where(and(
      eq(complianceProfilesTable.tenantId, tenantId),
      eq(complianceProfilesTable.jurisdictionCode, "DEFAULT"),
      eq(complianceProfilesTable.enabled, true),
    ))
    .limit(1);
  if (!fallback) throw new Error("No enabled compliance profile is configured");
  return fallback;
}

async function activeDncEntry(tenantId: string, phoneNumber: string, now: Date) {
  const [entry] = await db
    .select()
    .from(dncEntriesTable)
    .where(and(eq(dncEntriesTable.tenantId, tenantId), eq(dncEntriesTable.phoneNumber, phoneNumber)))
    .limit(1);
  return entry && (!entry.expiresAt || entry.expiresAt > now) ? entry : null;
}

async function latestConsent(tenantId: string, phoneNumber: string, now: Date) {
  const [entry] = await db
    .select()
    .from(consentLedgerTable)
    .where(and(
      eq(consentLedgerTable.tenantId, tenantId),
      eq(consentLedgerTable.phoneNumber, phoneNumber),
      eq(consentLedgerTable.consentType, "VOICE_CALLING"),
    ))
    .orderBy(desc(consentLedgerTable.capturedAt))
    .limit(1);
  if (!entry) return { status: "MISSING" as const };
  if (entry.status === "REVOKED") return { status: "REVOKED" as const };
  if (entry.expiresAt && entry.expiresAt <= now) return { status: "EXPIRED" as const };
  return { status: entry.status === "GRANTED" ? "GRANTED" as const : "MISSING" as const };
}

async function persistDecision(input: {
  tenantId: string;
  botId: string;
  phoneNumber: string;
  direction: string;
  decision: ComplianceDecision;
  reasonCode: ComplianceReasonCode;
  reason: string;
  profile: ComplianceProfile;
  calledPartyTimezone: string;
  disclosureText: string | null;
  recordingConsentRequired: boolean;
  now: Date;
}) {
  const decisionId = randomUUID();
  await db.insert(complianceDecisionsTable).values({
    id: decisionId,
    tenantId: input.tenantId,
    botId: input.botId,
    phoneNumber: input.phoneNumber,
    direction: input.direction,
    decision: input.decision,
    reasonCode: input.reasonCode,
    reason: input.reason,
    jurisdictionCode: input.profile.jurisdictionCode,
    calledPartyTimezone: input.calledPartyTimezone,
    disclosureText: input.disclosureText,
    recordingConsentRequired: input.recordingConsentRequired,
    evaluatedAt: input.now,
    metadataJson: {
      profileId: input.profile.id,
      callingWindow: `${input.profile.callingWindowStart}-${input.profile.callingWindowEnd}`,
    },
  });
  return decisionId;
}

export async function evaluateCompliance(input: ComplianceEvaluationInput): Promise<ComplianceEvaluation> {
  const now = input.now ?? new Date();
  const normalizedPhone = normalizeE164(input.phoneNumber);
  const profile = await profileForPhone(input.tenantId, normalizedPhone);
  const calledPartyTimezone = profile.timezone || input.botTimezone || "UTC";
  const disclosureText = profile.mandatoryDisclosureText?.trim() || null;
  const recordingConsentRequired = profile.requireRecordingConsent;

  let reasonCode: ComplianceReasonCode = "ALLOWED";
  let reason = "Call passed the tenant compliance policy";

  // Inbound callers may be on the tenant's DNC list but are still allowed to
  // reach the bot. DNC and consent gates apply to outbound calls only.
  if (input.direction === "OUTBOUND") {
    const dnc = await activeDncEntry(input.tenantId, normalizedPhone, now);
    const local = formatLocalParts(now, calledPartyTimezone);
    const allowedDays = asStringArray(profile.allowedDays, DEFAULT_ALLOWED_DAYS).map((day) => day.toUpperCase());
    const holidays = asStringArray(profile.holidays, []);
    const consent = await latestConsent(input.tenantId, normalizedPhone, now);

    if (dnc) {
      reasonCode = "DNC_LISTED";
      reason = "The called party is on the tenant do-not-call list";
    } else if (profile.requireConsent && consent.status === "MISSING") {
      reasonCode = "CONSENT_MISSING";
      reason = "Outbound calling consent is required but no active consent was found";
    } else if (profile.requireConsent && consent.status === "REVOKED") {
      reasonCode = "CONSENT_REVOKED";
      reason = "Outbound calling consent was revoked";
    } else if (profile.requireConsent && consent.status === "EXPIRED") {
      reasonCode = "CONSENT_EXPIRED";
      reason = "Outbound calling consent has expired";
    } else if (profile.blockOnHoliday && holidays.includes(local.date)) {
      reasonCode = "HOLIDAY";
      reason = `Outbound calling is blocked on ${local.date}`;
    } else if (!allowedDays.includes(local.day)) {
      reasonCode = "DISALLOWED_DAY";
      reason = `Outbound calling is not allowed on ${local.day}`;
    } else if (!isWithinWindow(local.time, profile.callingWindowStart, profile.callingWindowEnd)) {
      reasonCode = "OUTSIDE_CALLING_WINDOW";
      reason = `Local time ${local.time} is outside the ${profile.callingWindowStart}-${profile.callingWindowEnd} calling window`;
    }
  }

  const allowed = reasonCode === "ALLOWED";
  const decision = allowed ? "ALLOWED" : "BLOCKED";
  const decisionId = await persistDecision({
    tenantId: input.tenantId,
    botId: input.botId,
    phoneNumber: normalizedPhone,
    direction: input.direction,
    decision,
    reasonCode,
    reason,
    profile,
    calledPartyTimezone,
    disclosureText,
    recordingConsentRequired,
    now,
  });

  return {
    allowed,
    decision,
    decisionId,
    normalizedPhone,
    reasonCode,
    reason,
    jurisdictionCode: profile.jurisdictionCode,
    calledPartyTimezone,
    disclosureText,
    recordingConsentRequired,
    profile,
  };
}

export async function linkDecisionToCall(tenantId: string, decisionId: string, callId: string): Promise<void> {
  await db
    .update(complianceDecisionsTable)
    .set({ callId })
    .where(and(eq(complianceDecisionsTable.id, decisionId), eq(complianceDecisionsTable.tenantId, tenantId)));
}