import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, personasTable, personaTraitsTable, llmConfigTable } from "@workspace/db";
import type { PersonaTraitsJson } from "@workspace/db";
import { resolvePersonaTraits, refinePersonaTraits, TraitsSchema } from "../lib/persona-service";
import { composeSystemPrompt, extractVoiceSettings, validatePersonaForVoiceBot } from "../lib/persona-composer";
import { requireRole } from "../middleware/require-role";
import { auditMiddleware } from "../middleware/audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getLatestTraits(personaId: string) {
  const rows = await db
    .select()
    .from(personaTraitsTable)
    .where(eq(personaTraitsTable.personaId, personaId))
    .orderBy(desc(personaTraitsTable.version))
    .limit(1);
  return rows[0] ?? null;
}

async function getPersonaWithTraits(personaId: string, tenantId: string) {
  const [persona] = await db
    .select()
    .from(personasTable)
    .where(and(eq(personasTable.id, personaId), eq(personasTable.tenantId, tenantId)));
  if (!persona) return null;
  const traits = await getLatestTraits(personaId);
  return { ...persona, traits: traits ?? null };
}

// ─── List ─────────────────────────────────────────────────────────────────────

router.get("/v1/personas", async (req, res) => {
  const personas = await db
    .select()
    .from(personasTable)
    .where(eq(personasTable.tenantId, req.tenantId!))
    .orderBy(desc(personasTable.updatedAt));

  const result = await Promise.all(
    personas.map(async (p) => {
      const t = await getLatestTraits(p.id);
      return {
        ...p,
        hasTraits: !!t,
        traitsVersion: t?.version ?? null,
        generatedByModel: t?.generatedByModel ?? null,
      };
    })
  );
  res.json(result);
});

// ─── Get single ──────────────────────────────────────────────────────────────

router.get("/v1/personas/:id", async (req, res) => {
  const data = await getPersonaWithTraits(req.params.id, req.tenantId!);
  if (!data) { res.status(404).json({ error: "Persona not found" }); return; }
  res.json(data);
});

// ─── Create + generate traits ────────────────────────────────────────────────

router.post("/v1/personas", requireRole("ADMIN"), auditMiddleware("persona"), async (req, res) => {
  const { name, description } = req.body as { name: string; description?: string };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

  const existing = await db
    .select()
    .from(personasTable)
    .where(and(eq(personasTable.name, name.trim()), eq(personasTable.tenantId, req.tenantId!)));
  if (existing.length) {
    res.status(409).json({ error: "A persona with that name already exists" });
    return;
  }

  const [persona] = await db
    .insert(personasTable)
    .values({ name: name.trim(), description, source: "llm_generated", version: 1, tenantId: req.tenantId! })
    .returning();

  try {
    const { traits, model } = await resolvePersonaTraits(persona.id, persona.name, persona.description, false);
    await db.insert(personaTraitsTable).values({
      personaId: persona.id,
      version: 1,
      traits,
      generatedByModel: model,
      tenantId: req.tenantId!,
    });
    res.status(201).json({ ...persona, traits, generatedByModel: model });
  } catch (err) {
    await db.delete(personasTable).where(eq(personasTable.id, persona.id));
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Persona trait generation failed");
    res.status(502).json({ error: msg });
  }
});

// ─── Activate (Option A: sets UI-level isActive flag, scoped to this tenant) ─

router.post("/v1/personas/:id/activate", requireRole("ADMIN"), auditMiddleware("persona"), async (req, res) => {
  const id = req.params.id as string;
  const [persona] = await db
    .select()
    .from(personasTable)
    .where(and(eq(personasTable.id, id), eq(personasTable.tenantId, req.tenantId!)));
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  // PE-03: block activation if identity fields are empty
  const traits = await getLatestTraits(id);
  if (traits) {
    const validation = validatePersonaForVoiceBot(traits.traits);
    if (!validation.valid) {
      res.status(422).json({
        error: "Cannot activate persona with incomplete identity fields. The voice bot requires a role title, backstory, and at least one goal.",
        issues: validation.issues,
      });
      return;
    }
  }

  // Deactivate all in THIS TENANT only, then activate this one
  await db
    .update(personasTable)
    .set({ isActive: false })
    .where(eq(personasTable.tenantId, req.tenantId!));

  const [updated] = await db
    .update(personasTable)
    .set({ isActive: true, updatedAt: new Date() })
    .where(and(eq(personasTable.id, id), eq(personasTable.tenantId, req.tenantId!)))
    .returning();
  res.json(updated);
});

// ─── Update traits (manual edit) ─────────────────────────────────────────────

router.put("/v1/personas/:id/traits", requireRole("ADMIN"), auditMiddleware("persona"), async (req, res) => {
  const id = req.params.id as string;
  const [persona] = await db
    .select()
    .from(personasTable)
    .where(and(eq(personasTable.id, id), eq(personasTable.tenantId, req.tenantId!)));
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  const parsed = TraitsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Trait validation failed", issues: parsed.error.issues });
    return;
  }

  const traits = parsed.data as PersonaTraitsJson;
  const newVersion = persona.version + 1;

  await db.insert(personaTraitsTable).values({
    personaId: persona.id,
    version: newVersion,
    traits,
    generatedByModel: null,
    tenantId: req.tenantId!,
  });

  const [updated] = await db
    .update(personasTable)
    .set({ source: "manual", version: newVersion, updatedAt: new Date() })
    .where(and(eq(personasTable.id, id), eq(personasTable.tenantId, req.tenantId!)))
    .returning();

  res.json({ ...updated, traits });
});

// ─── Regenerate traits via LLM ───────────────────────────────────────────────

router.post("/v1/personas/:id/regenerate", requireRole("ADMIN"), async (req, res) => {
  const id = req.params.id as string;
  const [persona] = await db
    .select()
    .from(personasTable)
    .where(and(eq(personasTable.id, id), eq(personasTable.tenantId, req.tenantId!)));
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  try {
    const { traits, model } = await resolvePersonaTraits(persona.id, persona.name, persona.description, true);
    const newVersion = persona.version + 1;
    await db.insert(personaTraitsTable).values({
      personaId: persona.id,
      version: newVersion,
      traits,
      generatedByModel: model,
      tenantId: req.tenantId!,
    });
    const [updated] = await db
      .update(personasTable)
      .set({ source: "llm_generated", version: newVersion, updatedAt: new Date() })
      .where(and(eq(personasTable.id, id), eq(personasTable.tenantId, req.tenantId!)))
      .returning();
    res.json({ ...updated, traits, generatedByModel: model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

// ─── Refine traits with AI instruction ───────────────────────────────────────

router.post("/v1/personas/:id/refine", requireRole("ADMIN"), async (req, res) => {
  const id = req.params.id as string;
  const { instruction } = req.body as { instruction: string };
  if (!instruction?.trim()) { res.status(400).json({ error: "instruction is required" }); return; }

  const [persona] = await db
    .select()
    .from(personasTable)
    .where(and(eq(personasTable.id, id), eq(personasTable.tenantId, req.tenantId!)));
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  const traitsRow = await getLatestTraits(id);
  if (!traitsRow) { res.status(404).json({ error: "No traits found for this persona" }); return; }

  try {
    const { traits: updatedTraits, model } = await refinePersonaTraits(traitsRow.traits, instruction);
    res.json({ before: traitsRow.traits, after: updatedTraits, model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

// ─── Test persona (mock conversation) ────────────────────────────────────────

router.post("/v1/personas/:id/test", async (req, res) => {
  const id = req.params.id as string;
  const { message } = req.body as { message: string };
  const [persona] = await db
    .select()
    .from(personasTable)
    .where(and(eq(personasTable.id, id), eq(personasTable.tenantId, req.tenantId!)));
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  const traitsRow = await getLatestTraits(req.params.id);
  if (!traitsRow) { res.status(404).json({ error: "No traits found" }); return; }

  const systemPrompt = composeSystemPrompt(traitsRow.traits);
  const [llmCfg] = await db
    .select()
    .from(llmConfigTable)
    .where(eq(llmConfigTable.tenantId, req.tenantId!))
    .limit(1);
  const _engine = llmCfg?.primary ?? "openai";

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const sample = traitsRow.traits.language.sample_utterances[0] ?? "How can I assist you today?";
      res.json({ reply: sample, engine: "simulated" });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }],
          temperature: 0.8,
          max_tokens: 200,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`OpenAI ${r.status}`);
      const data = (await r.json()) as any;
      res.json({ reply: data.choices[0].message.content, engine: "openai" });
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  } catch {
    const sample = traitsRow.traits.language.sample_utterances[0] ?? "How can I assist you today?";
    res.json({ reply: sample, engine: "simulated" });
  }
});

// ─── Duplicate ───────────────────────────────────────────────────────────────

router.post("/v1/personas/:id/duplicate", requireRole("ADMIN"), async (req, res) => {
  const data = await getPersonaWithTraits(req.params.id as string, req.tenantId!);
  if (!data) { res.status(404).json({ error: "Persona not found" }); return; }

  const [newPersona] = await db
    .insert(personasTable)
    .values({
      name: `${data.name} (Copy)`,
      description: data.description,
      source: data.source,
      version: 1,
      isActive: false,
      tenantId: req.tenantId!,
    })
    .returning();

  if (data.traits) {
    await db.insert(personaTraitsTable).values({
      personaId: newPersona.id,
      version: 1,
      traits: data.traits.traits,
      generatedByModel: data.traits.generatedByModel,
      tenantId: req.tenantId!,
    });
  }

  res.status(201).json(newPersona);
});

// ─── Delete ──────────────────────────────────────────────────────────────────

router.delete("/v1/personas/:id", requireRole("ADMIN"), auditMiddleware("persona"), async (req, res) => {
  const id = req.params.id as string;
  const [persona] = await db
    .select()
    .from(personasTable)
    .where(and(eq(personasTable.id, id), eq(personasTable.tenantId, req.tenantId!)));
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }
  await db.delete(personasTable).where(and(eq(personasTable.id, id), eq(personasTable.tenantId, req.tenantId!)));
  res.sendStatus(204);
});

// ─── Compose system prompt for active persona ─────────────────────────────────

router.get("/v1/personas/active/compose", async (req, res) => {
  const [active] = await db
    .select()
    .from(personasTable)
    .where(and(eq(personasTable.isActive, true), eq(personasTable.tenantId, req.tenantId!)))
    .limit(1);
  if (!active) { res.status(404).json({ error: "No active persona" }); return; }

  const traitsRow = await getLatestTraits(active.id);
  if (!traitsRow) { res.status(404).json({ error: "Active persona has no traits" }); return; }

  const systemPrompt = composeSystemPrompt(traitsRow.traits);
  const voiceSettings = extractVoiceSettings(traitsRow.traits);
  res.json({ persona: active, systemPrompt, voiceSettings });
});

export default router;
