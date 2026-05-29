import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, botsTable } from "@workspace/db";
import {
  ListBotsResponse,
  GetBotResponse,
  GetBotParams,
  CreateBotBody,
  UpdateBotBody,
  UpdateBotParams,
  DeleteBotParams,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";

const router: IRouter = Router();

router.get("/v1/bots", async (_req, res): Promise<void> => {
  const bots = await db.select().from(botsTable).orderBy(botsTable.createdAt);
  res.json(ListBotsResponse.parse(bots));
});

router.post("/v1/bots", async (req, res): Promise<void> => {
  const parsed = CreateBotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [bot] = await db
    .insert(botsTable)
    .values({ id: randomUUID(), ...parsed.data, status: "OFFLINE", activeCalls: 0 })
    .returning();
  res.status(201).json(GetBotResponse.parse(bot));
});

router.get("/v1/bots/:id", async (req, res): Promise<void> => {
  const params = GetBotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, params.data.id));
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }
  res.json(GetBotResponse.parse(bot));
});

router.patch("/v1/bots/:id", async (req, res): Promise<void> => {
  const params = UpdateBotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [bot] = await db
    .update(botsTable)
    .set(parsed.data)
    .where(eq(botsTable.id, params.data.id))
    .returning();
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }
  res.json(GetBotResponse.parse(bot));
});

router.delete("/v1/bots/:id", async (req, res): Promise<void> => {
  const params = DeleteBotParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [bot] = await db.delete(botsTable).where(eq(botsTable.id, params.data.id)).returning();
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
