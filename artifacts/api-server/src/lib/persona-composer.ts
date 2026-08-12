/**
 * PersonaComposer: translates a persona's JSON trait profile into a structured
 * system-prompt string. Used at call setup — never calls the LLM.
 */
import type { PersonaTraitsJson } from "@workspace/db";

const TONE_LABELS: Record<string, string[]> = {
  warmth:    ["", "very cold and distant", "quite cold", "somewhat cool", "neutral", "slightly warm", "moderately warm", "warm and friendly", "very warm and welcoming", "exceptionally warm; use the caller's name often", "radiantly warm; make every caller feel like a VIP"],
  formality: ["", "extremely casual", "very informal", "informal", "conversational", "slightly formal", "moderately formal", "formal and professional", "very formal", "highly formal", "rigidly formal; use full titles and surnames"],
  energy:    ["", "very subdued", "low energy", "calm", "measured", "slightly energetic", "moderately energetic", "upbeat and engaging", "high energy", "very high energy", "extremely enthusiastic"],
  empathy:   ["", "clinical and detached", "minimal empathy", "limited empathy", "neutral acknowledgement", "some empathy", "moderate empathy", "empathetic; acknowledge feelings openly", "highly empathetic", "deeply empathetic; mirror emotional tone", "extraordinary empathy; always validate feelings before solving"],
  verbosity: ["", "extremely concise (1–2 words)", "very brief", "brief", "concise", "moderate length", "somewhat detailed", "detailed", "thorough", "very thorough; confirm understanding often", "exhaustive; repeat back all key details"],
};

function describeTone(key: string, value: number): string {
  return TONE_LABELS[key]?.[Math.min(10, Math.max(1, Math.round(value)))] ?? `${key}: ${value}/10`;
}

export function composeSystemPrompt(traits: PersonaTraitsJson): string {
  const { identity, language, tone, voice, behavior } = traits;

  const sections: string[] = [];

  // IDENTITY
  sections.push(`## IDENTITY
Role: ${identity.role_title}
Backstory: ${identity.backstory}
Goals: ${identity.goals.map((g) => `• ${g}`).join("\n")}`);

  // LANGUAGE STYLE
  sections.push(`## LANGUAGE STYLE
Greet callers with phrases like: ${language.greeting_phrases.slice(0, 3).join(" / ")}
Close with phrases like: ${language.closing_phrases.slice(0, 2).join(" / ")}
Domain jargon to use naturally: ${language.jargon.join(", ")}
NEVER say: ${language.forbidden_phrases.map((p) => `"${p}"`).join(", ")}
Sample natural utterances: ${language.sample_utterances.slice(0, 3).map((u) => `"${u}"`).join(" | ")}`);

  // TONE
  sections.push(`## TONE CALIBRATION
Warmth: ${describeTone("warmth", tone.warmth)} (${tone.warmth}/10)
Formality: ${describeTone("formality", tone.formality)} (${tone.formality}/10)
Energy: ${describeTone("energy", tone.energy)} (${tone.energy}/10)
Empathy: ${describeTone("empathy", tone.empathy)} (${tone.empathy}/10)
Response length: ${describeTone("verbosity", tone.verbosity)} (${tone.verbosity}/10)`);

  // VOICE
  sections.push(`## VOICE SETTINGS
Suggested voice gender: ${voice.suggested_gender}
Speaking pace: ${voice.pace}
Pitch: ${voice.pitch}
TTS voice: ${voice.deepgram_voice_hint}`);

  // BEHAVIOR RULES
  sections.push(`## BEHAVIOR RULES
Interrupt tolerance: ${behavior.interrupt_tolerance}
Silence handling: ${behavior.silence_strategy}
Escalation: ${behavior.escalation_rule}

DO:
${behavior.do_rules.map((r) => `• ${r}`).join("\n")}

DO NOT:
${behavior.dont_rules.map((r) => `• ${r}`).join("\n")}`);

  return sections.join("\n\n");
}

/**
 * Validates a persona's identity fields for voice-bot readiness.
 * Returns { valid, issues } — call this before stamping a persona onto a call.
 */
export function validatePersonaForVoiceBot(traits: PersonaTraitsJson): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const { identity } = traits;
  if (!identity.role_title?.trim()) issues.push("Identity: role_title is required");
  if (!identity.backstory?.trim()) issues.push("Identity: backstory is required");
  if (!identity.goals?.length || identity.goals.every((g) => !g.trim())) {
    issues.push("Identity: at least one non-empty goal is required");
  }
  return { valid: issues.length === 0, issues };
}

export function extractVoiceSettings(traits: PersonaTraitsJson) {
  return {
    deepgramVoiceHint: traits.voice.deepgram_voice_hint,
    pace: traits.voice.pace,
    pitch: traits.voice.pitch,
    interruptTolerance: traits.behavior.interrupt_tolerance,
    silenceStrategy: traits.behavior.silence_strategy,
  };
}
