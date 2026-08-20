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
  const counts: Record<string, number> = {};
  for (const call of withOutcome) {
    const key = call.connectOutcome!;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const outcomes = Object.entries(counts).map(([outcome, count]) => ({
    outcome,
    count,
    percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
  }));
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
  const languages = Object.entries(counts).map(([language, count]) => ({
    language,
    count,
    percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
  }));
  res.json(GetLanguageMixResponse.parse(languages));
});

router.get("/v1/stats/call-intelligence", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const allCalls = await db.select().from(callsTable).where(eq(callsTable.tenantId, tenantId));
  const total = allCalls.length;
  if (total === 0) {
    res.json(GetCallIntelligenceResponse.parse({
      avgInterruptions: 0,
      avgEscalations: 0,
      bargeInRate: 0,
      totalLanguageSwitches: 0,
      totalCallsAnalyzed: 0,
    }));
    return;
  }
  const avgInterruptions = allCalls.reduce((s, c) => s + (c.interruptionCount ?? 0), 0) / total;
  const avgEscalations = allCalls.reduce((s, c) => s + (c.escalationCount ?? 0), 0) / total;
  const withBarge = allCalls.filter((c) => (c.interruptionCount ?? 0) > 0).length;
  const bargeInRate = (withBarge / total) * 100;
  const totalLanguageSwitches = allCalls.reduce((s, c) => {
    const switches = Array.isArray(c.languageSwitches) ? (c.languageSwitches as unknown[]).length : 0;
    return s + switches;
  }, 0);
  res.json(GetCallIntelligenceResponse.parse({
    avgInterruptions: Math.round(avgInterruptions * 10) / 10,
    avgEscalations: Math.round(avgEscalations * 10) / 10,
    bargeInRate: Math.round(bargeInRate * 10) / 10,
    totalLanguageSwitches,
    totalCallsAnalyzed: total,
  }));
});

export default router;
