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
import { requireRole } from "../middleware/require-role";
import { auditMiddleware } from "../middleware/audit";
import { randomUUID } from "crypto";

const router: IRouter = Router();

// ─── Per-tenant config helpers ────────────────────────────────────────────────
// Each singleton config table is now one-row-per-tenant.
// On first access for a new tenant, a default row is created automatically.

async function ensurePersonaConfig(tenantId: string) {
  let [config] = await db
    .select()
    .from(personaConfigTable)
    .where(eq(personaConfigTable.tenantId, tenantId))
    .limit(1);
  if (!config) {
    [config] = await db
      .insert(personaConfigTable)
      .values({ id: randomUUID(), tenantId })
      .returning();
  }
  return config;
}

async function ensureConversationConfig(tenantId: string) {
  let [config] = await db
    .select()
    .from(conversationConfigTable)
    .where(eq(conversationConfigTable.tenantId, tenantId))
    .limit(1);
  if (!config) {
    [config] = await db
      .insert(conversationConfigTable)
      .values({ id: randomUUID(), tenantId })
      .returning();
  }
  return config;
}

async function ensureLlmConfig(tenantId: string) {
  let [config] = await db
    .select()
    .from(llmConfigTable)
    .where(eq(llmConfigTable.tenantId, tenantId))
    .limit(1);
  if (!config) {
    [config] = await db
      .insert(llmConfigTable)
      .values({ id: randomUUID(), tenantId })
      .returning();
  }
  return config;
}

// ─── Persona config ───────────────────────────────────────────────────────────

router.get("/v1/config/persona", async (req, res): Promise<void> => {
  const config = await ensurePersonaConfig(req.tenantId!);
  res.json(GetPersonaConfigResponse.parse(config));
});

router.put("/v1/config/persona", requireRole("ADMIN"), auditMiddleware("config"), async (req, res): Promise<void> => {
  const parsed = UpdatePersonaConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existing = await ensurePersonaConfig(req.tenantId!);
  const [config] = await db
    .update(personaConfigTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(personaConfigTable.id, existing.id))
    .returning();
  res.json(UpdatePersonaConfigResponse.parse(config));
});

// ─── Conversation config ──────────────────────────────────────────────────────

router.get("/v1/config/conversation", async (req, res): Promise<void> => {
  const config = await ensureConversationConfig(req.tenantId!);
  res.json(GetConversationConfigResponse.parse(config));
});

router.put("/v1/config/conversation", requireRole("ADMIN"), auditMiddleware("config"), async (req, res): Promise<void> => {
  const parsed = UpdateConversationConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existing = await ensureConversationConfig(req.tenantId!);
  const [config] = await db
    .update(conversationConfigTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(conversationConfigTable.id, existing.id))
    .returning();
  res.json(UpdateConversationConfigResponse.parse(config));
});

// ─── LLM engine config (CF-05 circuit breaker preserved) ─────────────────────

router.get("/v1/config/llm", async (req, res): Promise<void> => {
  const config = await ensureLlmConfig(req.tenantId!);
  res.json(GetLlmConfigResponse.parse(config));
});

router.put("/v1/config/llm", requireRole("ADMIN"), auditMiddleware("config"), async (req, res): Promise<void> => {
  const parsed = UpdateLlmConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existing = await ensureLlmConfig(req.tenantId!);
  const [config] = await db
    .update(llmConfigTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(llmConfigTable.id, existing.id))
    .returning();
  res.json(UpdateLlmConfigResponse.parse(config));
});

export default router;
