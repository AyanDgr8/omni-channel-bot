import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, personaConfigTable, conversationConfigTable, llmConfigTable } from "@workspace/db";
import {
  GetPersonaConfigResponse,
  UpdatePersonaConfigBody,
  UpdatePersonaConfigResponse,
  GetConversationConfigResponse,
  UpdateConversationConfigBody,
  UpdateConversationConfigResponse,
  GetLlmConfigResponse,
  UpdateLlmConfigBody,
  UpdateLlmConfigResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function ensurePersonaConfig() {
  let [config] = await db.select().from(personaConfigTable).where(eq(personaConfigTable.id, "default"));
  if (!config) {
    [config] = await db.insert(personaConfigTable).values({ id: "default" }).returning();
  }
  return config;
}

async function ensureConversationConfig() {
  let [config] = await db.select().from(conversationConfigTable).where(eq(conversationConfigTable.id, "default"));
  if (!config) {
    [config] = await db.insert(conversationConfigTable).values({ id: "default" }).returning();
  }
  return config;
}

async function ensureLlmConfig() {
  let [config] = await db.select().from(llmConfigTable).where(eq(llmConfigTable.id, "default"));
  if (!config) {
    [config] = await db.insert(llmConfigTable).values({ id: "default" }).returning();
  }
  return config;
}

router.get("/v1/config/persona", async (_req, res): Promise<void> => {
  const config = await ensurePersonaConfig();
  res.json(GetPersonaConfigResponse.parse(config));
});

router.put("/v1/config/persona", async (req, res): Promise<void> => {
  const parsed = UpdatePersonaConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await ensurePersonaConfig();
  const [config] = await db
    .update(personaConfigTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(personaConfigTable.id, "default"))
    .returning();
  res.json(UpdatePersonaConfigResponse.parse(config));
});

router.get("/v1/config/conversation", async (_req, res): Promise<void> => {
  const config = await ensureConversationConfig();
  res.json(GetConversationConfigResponse.parse(config));
});

router.put("/v1/config/conversation", async (req, res): Promise<void> => {
  const parsed = UpdateConversationConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await ensureConversationConfig();
  const [config] = await db
    .update(conversationConfigTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(conversationConfigTable.id, "default"))
    .returning();
  res.json(UpdateConversationConfigResponse.parse(config));
});

router.get("/v1/config/llm", async (_req, res): Promise<void> => {
  const config = await ensureLlmConfig();
  res.json(GetLlmConfigResponse.parse(config));
});

router.put("/v1/config/llm", async (req, res): Promise<void> => {
  const parsed = UpdateLlmConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await ensureLlmConfig();
  const [config] = await db
    .update(llmConfigTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(llmConfigTable.id, "default"))
    .returning();
  res.json(UpdateLlmConfigResponse.parse(config));
});

export default router;
