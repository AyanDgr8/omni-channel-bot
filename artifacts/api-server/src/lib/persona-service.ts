/**
 * Trait resolution service: DB-first lookup, LLM fallback (via ProviderRegistry), Zod validation.
 * NEVER called at call-time — traits are always cached in DB before use.
 */
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, personasTable, personaTraitsTable } from "@workspace/db";
import type { PersonaTraitsJson } from "@workspace/db";
import { logger } from "./logger.js";
import { providerRegistry } from "./provider-registry.js";

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

// ─── Prompt builders ─────────────────────────────────────────────────────────

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
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last !== -1) return raw.slice(first, last + 1);
  return raw.trim();
}

// ─── Core resolution function ─────────────────────────────────────────────────

/**
 * Resolve traits for a persona, using DB cache first.
 * Falls back to the ProviderRegistry (which walks the LLM chain with circuit breakers).
 *
 * @param tenantId  - Required for provider chain resolution
 */
export async function resolvePersonaTraits(
  personaId: string,
  name: string,
  tenantId: string,
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

  // 2. Generate via provider registry (chain-aware, circuit-breaker-protected)
  const { SYSTEM, USER } = buildPersonaPrompt(name, description);

  const result = await providerRegistry.callLlm({
    systemPrompt: SYSTEM,
    userPrompt: USER,
    tenantId,
    timeoutMs: 30_000,
  });

  const jsonStr = extractJson(result.text);
  const parsed = TraitsSchema.parse(JSON.parse(jsonStr));

  return { traits: parsed as PersonaTraitsJson, model: result.modelId, fromCache: false };
}

// ─── Refine traits with AI instruction ───────────────────────────────────────

/**
 * Refine an existing trait profile via instruction.
 *
 * @param tenantId  - Required for provider chain resolution
 */
export async function refinePersonaTraits(
  currentTraits: PersonaTraitsJson,
  instruction: string,
  tenantId: string
): Promise<{ traits: PersonaTraitsJson; model: string }> {
  const SYSTEM = `You are an expert voice-bot persona designer. 
You will receive a current JSON trait profile and an instruction for how to modify it.
Apply the instruction and return ONLY the updated JSON. No markdown, no explanation.
Preserve all fields — only change what the instruction asks.`;
  const USER = `Current traits:\n${JSON.stringify(currentTraits, null, 2)}\n\nInstruction: ${instruction}\n\nReturn only the updated JSON.`;

  const result = await providerRegistry.callLlm({
    systemPrompt: SYSTEM,
    userPrompt: USER,
    tenantId,
    timeoutMs: 30_000,
  });

  const jsonStr = extractJson(result.text);
  const parsed = TraitsSchema.parse(JSON.parse(jsonStr));
  return { traits: parsed as PersonaTraitsJson, model: result.modelId };
}
