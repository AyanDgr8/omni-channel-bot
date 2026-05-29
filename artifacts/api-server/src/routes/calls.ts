import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, callsTable, botsTable } from "@workspace/db";
import {
  ListCallsResponse,
  GetCallResponse,
  GetCallParams,
  HangupCallParams,
  TransferCallParams,
  ConferenceCallParams,
  DialCallBody,
  TransferCallBody,
  ConferenceCallBody,
  ListCallsQueryParams,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";

const router: IRouter = Router();

router.get("/v1/calls", async (req, res): Promise<void> => {
  const params = ListCallsQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 50) : 50;
  const offset = params.success ? (params.data.offset ?? 0) : 0;

  const conditions = [];
  if (params.success && params.data.direction) {
    conditions.push(eq(callsTable.direction, params.data.direction));
  }
  if (params.success && params.data.hangupReason) {
    conditions.push(eq(callsTable.hangupReason, params.data.hangupReason));
  }
  if (params.success && params.data.botId) {
    conditions.push(eq(callsTable.botId, params.data.botId));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const calls = await db
    .select()
    .from(callsTable)
    .where(where)
    .orderBy(desc(callsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const totalResult = await db.select().from(callsTable).where(where);
  res.json(ListCallsResponse.parse({ calls, total: totalResult.length }));
});

router.post("/v1/calls/dial", async (req, res): Promise<void> => {
  const parsed = DialCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, parsed.data.botId));
  if (!bot) {
    res.status(400).json({ error: "Bot not found" });
    return;
  }

  const callId = randomUUID();
  const [call] = await db
    .insert(callsTable)
    .values({
      id: callId,
      botId: parsed.data.botId,
      direction: "OUTBOUND",
      status: "INITIATING",
      customerNumber: parsed.data.to,
      startedAt: new Date(),
      followUpSent: false,
    })
    .returning();

  await db.update(botsTable).set({ status: "BUSY", activeCalls: bot.activeCalls + 1 }).where(eq(botsTable.id, bot.id));

  setTimeout(async () => {
    const outcomes = ["COMPLETED", "NO_ANSWER", "BUSY", "VOICEMAIL_LEFT"];
    const hangupReasons = ["BOT_HUNGUP", "NO_ANSWER", "BUSY", "VOICEMAIL_LEFT"];
    const amdResults = ["HUMAN", "VOICEMAIL", "IVR"];
    const idx = Math.floor(Math.random() * 4);
    const dur = 30 + Math.floor(Math.random() * 180);
    await db
      .update(callsTable)
      .set({
        status: idx === 0 ? "COMPLETED" : "COMPLETED",
        hangupReason: hangupReasons[idx],
        amdResult: amdResults[Math.floor(Math.random() * 3)],
        durationSeconds: dur,
        endedAt: new Date(),
        summary: idx === 0 ? "Call completed successfully. Customer engaged and provided information." : null,
      })
      .where(eq(callsTable.id, callId));
    const currentBot = await db.select().from(botsTable).where(eq(botsTable.id, parsed.data.botId));
    if (currentBot[0]) {
      await db
        .update(botsTable)
        .set({ status: "ONLINE", activeCalls: Math.max(0, currentBot[0].activeCalls - 1) })
        .where(eq(botsTable.id, parsed.data.botId));
    }
  }, 5000);

  res.status(201).json(GetCallResponse.parse(call));
});

router.get("/v1/calls/:id", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(GetCallResponse.parse(call));
});

router.delete("/v1/calls/:id", async (req, res): Promise<void> => {
  const params = HangupCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [call] = await db
    .update(callsTable)
    .set({ status: "COMPLETED", hangupReason: "BOT_HUNGUP", endedAt: new Date() })
    .where(eq(callsTable.id, params.data.id))
    .returning();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(GetCallResponse.parse(call));
});

router.post("/v1/calls/:id/transfer", async (req, res): Promise<void> => {
  const params = TransferCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = TransferCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const target = parsed.data.extension ?? parsed.data.e164 ?? parsed.data.agentName ?? "unknown";
  const [call] = await db
    .update(callsTable)
    .set({ status: "COMPLETED", hangupReason: "TRANSFERRED", transferTarget: target, endedAt: new Date() })
    .where(eq(callsTable.id, params.data.id))
    .returning();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(GetCallResponse.parse(call));
});

router.post("/v1/calls/:id/conference", async (req, res): Promise<void> => {
  const params = ConferenceCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ConferenceCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(GetCallResponse.parse(call));
});

export default router;
