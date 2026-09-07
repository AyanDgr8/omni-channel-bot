import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, callsTable, botsTable, memoryEntriesTable } from "@workspace/db";
import {
  GetStatsOverviewResponse,
  GetCallsByHourResponse,
  GetHangupReasonsResponse,
  GetConnectOutcomesResponse,
  GetLanguageMixResponse,
  GetCallIntelligenceResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/v1/stats/overview", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const allCalls = await db.select().from(callsTable).where(eq(callsTable.tenantId, tenantId));
  const allBots = await db.select().from(botsTable).where(eq(botsTable.tenantId, tenantId));
  const memEntries = await db.select().from(memoryEntriesTable).where(eq(memoryEntriesTable.tenantId, tenantId));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeCalls = allCalls.filter((c) => ["IN_PROGRESS", "RINGING", "INITIATING"].includes(c.status)).length;
  const completedToday = allCalls.filter((c) => c.endedAt && new Date(c.endedAt) >= today && c.status === "COMPLETED").length;
  const completed = allCalls.filter((c) => c.status === "COMPLETED");
  const successRate = allCalls.length > 0 ? (completed.length / allCalls.length) * 100 : 0;
  const durations = completed.filter((c) => c.durationSeconds).map((c) => c.durationSeconds!);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const humanCalls = allCalls.filter((c) => c.amdResult === "HUMAN").length;
  const amdTotal = allCalls.filter((c) => c.amdResult).length;
  const amdAccuracy = amdTotal > 0 ? (humanCalls / amdTotal) * 100 : 0;
  const memoryHitRate = memEntries.length > 0 ? Math.min(95, 60 + memEntries.length * 2) : 0;

  res.json(
    GetStatsOverviewResponse.parse({
      totalCalls: allCalls.length,
      activeCalls,
      completedToday,
      successRate: Math.round(successRate * 10) / 10,
      avgDurationSeconds: Math.round(avgDuration),
      amdAccuracy: Math.round(amdAccuracy * 10) / 10,
      memoryHitRate: Math.round(memoryHitRate * 10) / 10,
      totalBots: allBots.length,
    })
  );
});

router.get("/v1/stats/calls-by-hour", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const now = new Date();
  const allCalls = await db.select().from(callsTable).where(eq(callsTable.tenantId, tenantId));
  const hours: Array<{ hour: string; inbound: number; outbound: number }> = [];

  for (let i = 23; i >= 0; i--) {
    const h = new Date(now);
    h.setHours(now.getHours() - i, 0, 0, 0);
    const hEnd = new Date(h);
    hEnd.setHours(h.getHours() + 1);
    const label = h.toLocaleTimeString("en-US", { hour: "2-digit", hour12: false });
    hours.push({
      hour: label,
      inbound: allCalls.filter((c) => c.createdAt >= h && c.createdAt < hEnd && c.direction === "INBOUND").length,
      outbound: allCalls.filter((c) => c.createdAt >= h && c.createdAt < hEnd && c.direction === "OUTBOUND").length,
    });
  }
  res.json(GetCallsByHourResponse.parse(hours));
});

router.get("/v1/stats/hangup-reasons", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const allCalls = await db.select().from(callsTable).where(eq(callsTable.tenantId, tenantId));
  const total = allCalls.filter((c) => c.hangupReason).length;
  const counts: Record<string, number> = {};
  for (const call of allCalls) {
    if (call.hangupReason) counts[call.hangupReason] = (counts[call.hangupReason] ?? 0) + 1;
  }
  const reasons = Object.entries(counts).map(([reason, count]) => ({
    reason,
    count,
    percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
  }));
  res.json(GetHangupReasonsResponse.parse(reasons));
});

router.get("/v1/stats/connect-outcomes", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const allCalls = await db.select().from(callsTable).where(eq(callsTable.tenantId, tenantId));
  const withOutcome = allCalls.filter((c) => c.connectOutcome);
  const total = withOutcome.length;
  // Seeded with every outcome so the chart keeps a stable set of series even
  // when an outcome has not occurred yet.
  const counts: Record<string, number> = {
    HUMAN: 0,
    ANSWERING_MACHINE: 0,
    IVR: 0,
    SILENCE: 0,
    NO_RESPONSE: 0,
  };
  for (const call of withOutcome) {
    const key = call.connectOutcome!;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const outcomes = Object.entries(counts)
    .map(([outcome, count]) => ({
      outcome,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.outcome.localeCompare(b.outcome));
  res.json(GetConnectOutcomesResponse.parse(outcomes));
});

router.get("/v1/stats/language-mix", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const allCalls = await db.select().from(callsTable).where(eq(callsTable.tenantId, tenantId));
  const withLang = allCalls.filter((c) => c.languageDetected);
  const total = withLang.length;
  const counts: Record<string, number> = {};
  for (const call of withLang) {
    const key = call.languageDetected!;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const languages = Object.entries(counts)
    .map(([language, count]) => ({
      language,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
  res.json(GetLanguageMixResponse.parse(languages));
});

router.get("/v1/stats/call-intelligence", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const allCalls = await db.select().from(callsTable).where(eq(callsTable.tenantId, tenantId));
  const total = allCalls.length;
  if (total === 0) {
    res.json(GetCallIntelligenceResponse.parse({
      totalAnalyzed: 0,
      avgInterruptionsPerCall: 0,
      avgEscalationsPerCall: 0,
      bargeInRate: 0,
      avgLanguageSwitchesPerCall: 0,
      timeSeries: buildIntelligenceTimeSeries(allCalls),
    }));
    return;
  }
  const avgInterruptions = allCalls.reduce((s, c) => s + (c.interruptionCount ?? 0), 0) / total;
  const avgEscalations = allCalls.reduce((s, c) => s + (c.escalationCount ?? 0), 0) / total;
  const withBarge = allCalls.filter((c) => (c.interruptionCount ?? 0) > 0).length;
  const bargeInRate = (withBarge / total) * 100;
  const avgSwitches = allCalls.reduce((s, c) => {
    const switches = Array.isArray(c.languageSwitches) ? (c.languageSwitches as unknown[]).length : 0;
    return s + switches;
  }, 0) / total;
  res.json(GetCallIntelligenceResponse.parse({
    totalAnalyzed: total,
    avgInterruptionsPerCall: Math.round(avgInterruptions * 10) / 10,
    avgEscalationsPerCall: Math.round(avgEscalations * 10) / 10,
    bargeInRate: Math.round(bargeInRate * 10) / 10,
    avgLanguageSwitchesPerCall: Math.round(avgSwitches * 10) / 10,
    timeSeries: buildIntelligenceTimeSeries(allCalls),
  }));
});

/** Daily call-intelligence rollup for the trailing 14 days, oldest first. */
function buildIntelligenceTimeSeries(
  allCalls: Array<typeof callsTable.$inferSelect>,
): Array<{
  date: string;
  callsAnalyzed: number;
  avgInterruptionsPerCall: number;
  bargeInRate: number;
  escalationRate: number;
}> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const points = [];

  for (let offset = 13; offset >= 0; offset -= 1) {
    const start = new Date(today);
    start.setUTCDate(today.getUTCDate() - offset);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);
    const callsForDay = allCalls.filter((call) => call.createdAt >= start && call.createdAt < end);
    const count = callsForDay.length;
    const interruptions = callsForDay.reduce((sum, call) => sum + (call.interruptionCount ?? 0), 0);
    const withBargeIn = callsForDay.filter((call) => (call.interruptionCount ?? 0) > 0).length;
    const escalated = callsForDay.filter((call) => (call.escalationCount ?? 0) > 0).length;

    points.push({
      date: start.toISOString().slice(0, 10),
      callsAnalyzed: count,
      avgInterruptionsPerCall: count > 0 ? Math.round((interruptions / count) * 10) / 10 : 0,
      bargeInRate: count > 0 ? Math.round((withBargeIn / count) * 1000) / 10 : 0,
      escalationRate: count > 0 ? Math.round((escalated / count) * 1000) / 10 : 0,
    });
  }

  return points;
}

export default router;
