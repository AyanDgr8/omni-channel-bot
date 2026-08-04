/**
 * Trait resolution service: DB-first lookup, LLM fallback, Zod validation.
 * NEVER called at call-time — traits are always cached in DB before use.
 */
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db, personasTable, personaTraitsTable, llmConfigTable } from "@workspace/db";
import type { PersonaTraitsJson } from "@workspace/db";
import { logger } from "./logger";

// ─── Zod schema for trait validation ─────────────────────────────────────────

export const ToneSchema = z.object({
  warmth: z.number().int().min(1).max(10),
  formality: z.number().int().min(1).max(10),
  energy: z.number().int().min(1).max(10),
  empathy: z.number().int().min(1).max(10),
  verbosity: z.number().int().min(1).max(10),
});

export const TraitsSchema = z.object({
  identity: z.object({
    role_title: z.string(),
    backstory: z.string(),
    goals: z.array(z.string()),
  }),
  language: z.object({
    jargon: z.array(z.string()),
    greeting_phrases: z.array(z.string()),
    closing_phrases: z.array(z.string()),
    forbidden_phrases: z.array(z.string()),
    sample_utterances: z.array(z.string()),
  }),
  tone: ToneSchema,
  voice: z.object({
    suggested_gender: z.string(),
    pace: z.enum(["slow", "moderate", "fast"]),
    pitch: z.enum(["low", "medium", "high"]),
    deepgram_voice_hint: z.string(),
  }),
  behavior: z.object({
    interrupt_tolerance: z.enum(["low", "medium", "high"]),
    silence_strategy: z.string(),
    escalation_rule: z.string(),
    do_rules: z.array(z.string()),
    dont_rules: z.array(z.string()),
  }),
});

// ─── LLM caller ──────────────────────────────────────────────────────────────

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  engine: string,
  timeoutMs = 30_000
): Promise<{ text: string; model: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (engine === "openai" || engine === "ollama") {
      const baseUrl =
        engine === "ollama"
          ? (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434") + "/v1"
          : "https://api.openai.com/v1";
      const apiKey = engine === "ollama" ? "ollama" : (process.env.OPENAI_API_KEY ?? "");
      const model = engine === "ollama" ? (process.env.OLLAMA_MODEL ?? "llama3") : "gpt-4o-mini";
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as any;
      return { text: data.choices[0].message.content, model };
    }

    if (engine === "gemini") {
      const apiKey = process.env.GEMINI_API_KEY ?? "";
      const model = "gemini-1.5-flash";
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
          }),
          signal: controller.signal,
        }
      );
      if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as any;
      return { text: data.candidates[0].content.parts[0].text, model };
    }

    if (engine === "anthropic") {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
      const model = "claude-3-haiku-20240307";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as any;
      return { text: data.content[0].text, model };
    }

    throw new Error(`Unknown engine: ${engine}`);
  } finally {
    clearTimeout(timer);
  }
}

function buildPersonaPrompt(name: string, description?: string | null) {
  const SYSTEM = `You are an expert voice-bot persona designer. 
Your task: given a persona name and optional description, produce a complete JSON trait profile for an AI voice bot playing that role.
Return ONLY valid JSON with no markdown fences, no preamble, no explanation.
The JSON must match this exact structure:
{
  "identity": { "role_title": string, "backstory": string, "goals": string[] },
  "language": { "jargon": string[], "greeting_phrases": string[], "closing_phrases": string[], "forbidden_phrases": string[], "sample_utterances": string[] },
  "tone": { "warmth": int(1-10), "formality": int(1-10), "energy": int(1-10), "empathy": int(1-10), "verbosity": int(1-10) },
  "voice": { "suggested_gender": string, "pace": "slow"|"moderate"|"fast", "pitch": "low"|"medium"|"high", "deepgram_voice_hint": string },
  "behavior": { "interrupt_tolerance": "low"|"medium"|"high", "silence_strategy": string, "escalation_rule": string, "do_rules": string[], "dont_rules": string[] }
}
All tone values must be integers 1–10.`;

  const USER = `Persona name: "${name}"${description ? `\nDescription: ${description}` : ""}
Generate the complete trait profile now. Return only JSON.`;

  return { SYSTEM, USER };
}

function extractJson(raw: string): string {
  // Strip markdown fences if the model ignored instructions
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last !== -1) return raw.slice(first, last + 1);
  return raw.trim();
}

// ─── Core resolution function ─────────────────────────────────────────────────

export async function resolvePersonaTraits(
  personaId: string,
  name: string,
  description?: string | null,
  forceRegenerate = false
): Promise<{ traits: PersonaTraitsJson; model: string | null; fromCache: boolean }> {
  // 1. DB lookup (skip if forceRegenerate)
  if (!forceRegenerate) {
    const cached = await db
      .select()
      .from(personaTraitsTable)
      .where(eq(personaTraitsTable.personaId, personaId))
      .orderBy(desc(personaTraitsTable.version))
      .limit(1);
    if (cached.length) {
      return { traits: cached[0].traits, model: cached[0].generatedByModel, fromCache: true };
    }
  }

  // 2. LLM generation
  const [llmCfg] = await db.select().from(llmConfigTable).where(eq(llmConfigTable.id, "default"));
  const engines = llmCfg
    ? [llmCfg.primary, ...llmCfg.fallbackChain]
    : ["openai", "anthropic", "gemini"];

  const { SYSTEM, USER } = buildPersonaPrompt(name, description);
  let lastError: unknown;

  for (const engine of engines) {
    try {
      const { text, model } = await callLLM(SYSTEM, USER, engine, 30_000);
      const jsonStr = extractJson(text);
      const parsed = TraitsSchema.parse(JSON.parse(jsonStr));
      return { traits: parsed as PersonaTraitsJson, model, fromCache: false };
    } catch (err) {
      logger.warn({ err, engine }, "Persona trait generation failed for engine, trying next");
      lastError = err;
    }
  }

  throw new Error(
    `All LLM engines failed to generate traits. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

// ─── Refine traits with AI instruction ───────────────────────────────────────

export async function refinePersonaTraits(
  currentTraits: PersonaTraitsJson,
  instruction: string
): Promise<{ traits: PersonaTraitsJson; model: string }> {
  const [llmCfg] = await db.select().from(llmConfigTable).where(eq(llmConfigTable.id, "default"));
  const engines = llmCfg
    ? [llmCfg.primary, ...llmCfg.fallbackChain]
    : ["openai", "anthropic", "gemini"];

  const SYSTEM = `You are an expert voice-bot persona designer. 
You will receive a current JSON trait profile and an instruction for how to modify it.
Apply the instruction and return ONLY the updated JSON. No markdown, no explanation.
Preserve all fields — only change what the instruction asks.`;
  const USER = `Current traits:\n${JSON.stringify(currentTraits, null, 2)}\n\nInstruction: ${instruction}\n\nReturn only the updated JSON.`;

  let lastError: unknown;
  for (const engine of engines) {
    try {
      const { text, model } = await callLLM(SYSTEM, USER, engine, 30_000);
      const jsonStr = extractJson(text);
      const parsed = TraitsSchema.parse(JSON.parse(jsonStr));
      return { traits: parsed as PersonaTraitsJson, model };
    } catch (err) {
      logger.warn({ err, engine }, "Persona refine failed for engine, trying next");
      lastError = err;
    }
  }

  throw new Error(
    `All LLM engines failed to refine traits. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}
