import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, personasTable, personaTraitsTable, llmConfigTable } from "@workspace/db";
import type { PersonaTraitsJson } from "@workspace/db";
import { resolvePersonaTraits, refinePersonaTraits } from "../lib/persona-service";
import { composeSystemPrompt, extractVoiceSettings } from "../lib/persona-composer";
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

async function getPersonaWithTraits(personaId: string) {
  const [persona] = await db.select().from(personasTable).where(eq(personasTable.id, personaId));
  if (!persona) return null;
  const traits = await getLatestTraits(personaId);
  return { ...persona, traits: traits ?? null };
}

// ─── List ─────────────────────────────────────────────────────────────────────

router.get("/v1/personas", async (_req, res) => {
  const personas = await db.select().from(personasTable).orderBy(desc(personasTable.updatedAt));
  // Attach latest traits summary (no full body for list view)
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
  const data = await getPersonaWithTraits(req.params.id);
  if (!data) { res.status(404).json({ error: "Persona not found" }); return; }
  res.json(data);
});

// ─── Create + generate traits ────────────────────────────────────────────────

router.post("/v1/personas", async (req, res) => {
  const { name, description } = req.body as { name: string; description?: string };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

  // Check if this is a library lookup or new creation
  const existing = await db
    .select()
    .from(personasTable)
    .where(eq(personasTable.name, name.trim()));
  if (existing.length) {
    res.status(409).json({ error: "A persona with that name already exists" });
    return;
  }

  // Insert persona row first
  const [persona] = await db
    .insert(personasTable)
    .values({ name: name.trim(), description, source: "llm_generated", version: 1 })
    .returning();

  try {
    const { traits, model } = await resolvePersonaTraits(persona.id, persona.name, persona.description, false);
    await db.insert(personaTraitsTable).values({
      personaId: persona.id,
      version: 1,
      traits,
      generatedByModel: model,
    });
    res.status(201).json({ ...persona, traits, generatedByModel: model });
  } catch (err) {
    // Clean up the persona row if trait generation failed
    await db.delete(personasTable).where(eq(personasTable.id, persona.id));
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Persona trait generation failed");
    res.status(502).json({ error: msg });
  }
});

// ─── Activate ────────────────────────────────────────────────────────────────

router.post("/v1/personas/:id/activate", async (req, res) => {
  const [persona] = await db.select().from(personasTable).where(eq(personasTable.id, req.params.id));
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  // Deactivate all, then activate this one
  await db.update(personasTable).set({ isActive: false });
  const [updated] = await db
    .update(personasTable)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(personasTable.id, req.params.id))
    .returning();
  res.json(updated);
});

// ─── Update traits (manual edit) ─────────────────────────────────────────────

router.put("/v1/personas/:id/traits", async (req, res) => {
  const [persona] = await db.select().from(personasTable).where(eq(personasTable.id, req.params.id));
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  const traits = req.body as PersonaTraitsJson;
  const newVersion = persona.version + 1;

  await db.insert(personaTraitsTable).values({
    personaId: persona.id,
    version: newVersion,
    traits,
    generatedByModel: null,
  });

  const [updated] = await db
    .update(personasTable)
    .set({ source: "manual", version: newVersion, updatedAt: new Date() })
    .where(eq(personasTable.id, req.params.id))
    .returning();

  res.json({ ...updated, traits });
});

// ─── Regenerate traits via LLM ───────────────────────────────────────────────

router.post("/v1/personas/:id/regenerate", async (req, res) => {
  const [persona] = await db.select().from(personasTable).where(eq(personasTable.id, req.params.id));
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  try {
    const { traits, model } = await resolvePersonaTraits(
      persona.id,
      persona.name,
      persona.description,
      true // forceRegenerate
    );

    const newVersion = persona.version + 1;
    await db.insert(personaTraitsTable).values({
      personaId: persona.id,
      version: newVersion,
      traits,
      generatedByModel: model,
    });

    const [updated] = await db
      .update(personasTable)
      .set({ source: "llm_generated", version: newVersion, updatedAt: new Date() })
      .where(eq(personasTable.id, req.params.id))
      .returning();

    res.json({ ...updated, traits, generatedByModel: model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

// ─── Refine traits with AI instruction ───────────────────────────────────────

router.post("/v1/personas/:id/refine", async (req, res) => {
  const { instruction } = req.body as { instruction: string };
  if (!instruction?.trim()) { res.status(400).json({ error: "instruction is required" }); return; }

  const traitsRow = await getLatestTraits(req.params.id);
  if (!traitsRow) { res.status(404).json({ error: "No traits found for this persona" }); return; }

  try {
    const { traits: updatedTraits, model } = await refinePersonaTraits(traitsRow.traits, instruction);
    // Return the updated traits + before for client-side diff — do NOT save yet (client approves first)
    res.json({ before: traitsRow.traits, after: updatedTraits, model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

// ─── Test persona (mock conversation) ────────────────────────────────────────

router.post("/v1/personas/:id/test", async (req, res) => {
  const { message } = req.body as { message: string };
  const traitsRow = await getLatestTraits(req.params.id);
  if (!traitsRow) { res.status(404).json({ error: "No traits found" }); return; }

  const systemPrompt = composeSystemPrompt(traitsRow.traits);
  const [llmCfg] = await db.select().from(llmConfigTable).where(eq(llmConfigTable.id, "default"));
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
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
          ],
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
  } catch (err) {
    const sample = traitsRow.traits.language.sample_utterances[0] ?? "How can I assist you today?";
    res.json({ reply: sample, engine: "simulated" });
  }
});

// ─── Duplicate ───────────────────────────────────────────────────────────────

router.post("/v1/personas/:id/duplicate", async (req, res) => {
  const data = await getPersonaWithTraits(req.params.id);
  if (!data) { res.status(404).json({ error: "Persona not found" }); return; }

  const [newPersona] = await db
    .insert(personasTable)
    .values({
      name: `${data.name} (Copy)`,
      description: data.description,
      source: data.source,
      version: 1,
      isActive: false,
    })
    .returning();

  if (data.traits) {
    await db.insert(personaTraitsTable).values({
      personaId: newPersona.id,
      version: 1,
      traits: data.traits.traits,
      generatedByModel: data.traits.generatedByModel,
    });
  }

  res.status(201).json(newPersona);
});

// ─── Delete ──────────────────────────────────────────────────────────────────

router.delete("/v1/personas/:id", async (req, res) => {
  const [persona] = await db.select().from(personasTable).where(eq(personasTable.id, req.params.id));
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }
  await db.delete(personasTable).where(eq(personasTable.id, req.params.id));
  res.sendStatus(204);
});

// ─── Compose system prompt for active persona ─────────────────────────────────

router.get("/v1/personas/active/compose", async (_req, res) => {
  const [active] = await db
    .select()
    .from(personasTable)
    .where(eq(personasTable.isActive, true))
    .limit(1);
  if (!active) { res.status(404).json({ error: "No active persona" }); return; }

  const traitsRow = await getLatestTraits(active.id);
  if (!traitsRow) { res.status(404).json({ error: "Active persona has no traits" }); return; }

  const systemPrompt = composeSystemPrompt(traitsRow.traits);
  const voiceSettings = extractVoiceSettings(traitsRow.traits);
  res.json({ persona: active, systemPrompt, voiceSettings });
});

export default router;
