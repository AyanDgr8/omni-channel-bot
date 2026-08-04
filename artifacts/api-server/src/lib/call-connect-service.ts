/**
 * Call-Connect State Machine
 *
 * Executes when media is established on a call. Handles:
 *   1. AMD (Answering Machine Detection) — outbound only
 *   2. Time-of-day greeting composition using the bot's IANA timezone
 *   3. Language detection and mid-call switching
 *   4. Barge-in / interruption handling signals
 *   5. Conversation-intelligence behaviors (silence recovery, latency masking, etc.)
 *
 * This module contains the pure logic. The telephony layer (SIP/WebRTC media server)
 * calls these functions at the appropriate signal events. Dispositions and events
 * are persisted back to the calls table by the caller.
 */

import { db, callsTable, botsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type ConnectOutcome =
  | "HUMAN"
  | "ANSWERING_MACHINE"
  | "IVR"
  | "SILENCE"
  | "NO_RESPONSE";

export type CallDisposition =
  | "COMPLETED"
  | "VOICEMAIL_LEFT"
  | "LANGUAGE_UNSUPPORTED"
  | "SILENT_DROP"
  | "TRANSFERRED"
  | "FAILED"
  | "AMD_HANGUP"
  | "NO_RESPONSE";

export interface LanguageSwitchEvent {
  from: string;
  to: string;
  at: string; // ISO timestamp
}

export interface InboundDirectionConfig {
  greeting: {
    time_of_day_variants: {
      morning: string;
      afternoon: string;
      evening: string;
      night: string;
    };
    time_boundaries: {
      morning: string;
      afternoon: string;
      evening: string;
      night: string;
    };
    ai_disclosure: boolean;
    ai_disclosure_text: string;
  };
  queue_behavior: { max_ring_wait_ms: number };
  escalation: {
    transfer_number: string;
    transfer_on_request: boolean;
    transfer_on_frustration: boolean;
  };
}

export interface OutboundDirectionConfig {
  amd: {
    enabled: boolean;
    detection_window_ms: number;
    on_machine_detected: {
      crm_disposition: string;
      voicemail_message_id: string;
      wait_for_beep: boolean;
      hangup_after_message: boolean;
    };
  };
  opening_script: string;
  retry_policy: { max_attempts: number; retry_interval_minutes: number };
  calling_hours: { start: string; end: string; respect_timezone: boolean };
}

export interface BotCallConfig {
  id: string;
  direction: string;
  directionConfig: InboundDirectionConfig | OutboundDirectionConfig | null;
  supportedLanguages: string[];
  defaultGreetingLanguage: string;
  timezone: string;
  endpointSilenceMs: number;
  backchannelThresholdMs: number;
  silenceRecoverySecs: number;
}

export interface CallConnectResult {
  outcome: ConnectOutcome;
  greetingText: string;
  greetingLanguage: string;
  amdDisposition?: string;
  shouldHangup: boolean;
  reason: string;
}

export interface BargeInDecision {
  /** true = real interruption → stop TTS immediately */
  isBargIn: boolean;
  /** true = backchannel ("hmm", "okay") → bot should keep talking */
  isBackchannel: boolean;
  durationMs: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 1 — AMD (Answering Machine Detection)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Classifies the far-end audio at the start of an outbound call.
 *
 * In production this function receives real audio features from the media server.
 * Detection signals:
 *   - Long uninterrupted speech with no pause → machine greeting
 *   - Beep tone detection → answering machine waiting
 *   - Synthetic/recorded audio characteristics → IVR
 *   - Immediate scripted speech before bot says anything → machine
 *   - Silence > 5s → NO_RESPONSE
 *
 * @param audioFeatures - Features extracted from the first 3–4s of far-end audio
 */
export function classifyFarEnd(audioFeatures: {
  speechDurationMs: number;
  silenceDurationMs: number;
  hasBeepTone: boolean;
  isSyntheticSpeech: boolean;
  isImmediateScriptedSpeech: boolean;
}): ConnectOutcome {
  const { speechDurationMs, silenceDurationMs, hasBeepTone, isSyntheticSpeech, isImmediateScriptedSpeech } = audioFeatures;

  if (silenceDurationMs > 5000) return "SILENCE";
  if (hasBeepTone) return "ANSWERING_MACHINE";
  if (isSyntheticSpeech || isImmediateScriptedSpeech) return "IVR";
  // Long uninterrupted greeting with no natural pause = machine
  if (speechDurationMs > 3000 && silenceDurationMs < 200) return "ANSWERING_MACHINE";

  return "HUMAN";
}

/**
 * Simulates AMD for a synthetic call (used in the dev simulation path).
 * Returns a realistic AMD outcome based on probability weights.
 */
export function simulateAMD(amdEnabled: boolean): ConnectOutcome {
  if (!amdEnabled) return "HUMAN";
  const r = Math.random();
  if (r < 0.72) return "HUMAN";
  if (r < 0.87) return "ANSWERING_MACHINE";
  if (r < 0.94) return "IVR";
  if (r < 0.98) return "SILENCE";
  return "NO_RESPONSE";
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 2 — Time-of-day greeting
// ──────────────────────────────────────────────────────────────────────────────

type TimeBand = "morning" | "afternoon" | "evening" | "night";

/** Default time boundaries for each band */
const DEFAULT_TIME_BOUNDARIES = {
  morning:   { start:  5, end: 11 },
  afternoon: { start: 12, end: 16 },
  evening:   { start: 17, end: 20 },
  night:     { start: 21, end:  4 },
};

/**
 * Returns the current time band (morning/afternoon/evening/night) in the given
 * IANA timezone. Never uses the server's raw clock — always converts through
 * the timezone.
 */
export function getTimeBand(timezone: string): TimeBand {
  const now = new Date();
  // Use Intl.DateTimeFormat to get the hour in the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  const hourStr = formatter.format(now);
  const hour = parseInt(hourStr, 10);

  if (hour >= DEFAULT_TIME_BOUNDARIES.morning.start && hour <= DEFAULT_TIME_BOUNDARIES.morning.end)
    return "morning";
  if (hour >= DEFAULT_TIME_BOUNDARIES.afternoon.start && hour <= DEFAULT_TIME_BOUNDARIES.afternoon.end)
    return "afternoon";
  if (hour >= DEFAULT_TIME_BOUNDARIES.evening.start && hour <= DEFAULT_TIME_BOUNDARIES.evening.end)
    return "evening";
  return "night";
}

/**
 * Composes the greeting text from the direction config and current time band.
 * Applies ai_disclosure if enabled (inbound only).
 * Substitutes {company} placeholder with the bot's displayName if present.
 */
export function composeGreeting(
  config: BotCallConfig,
  botName: string
): { text: string; language: string; band: TimeBand } {
  const band = getTimeBand(config.timezone);
  let greetingText = "";

  if (config.direction === "inbound" && config.directionConfig) {
    const inbound = config.directionConfig as InboundDirectionConfig;
    const variant = inbound.greeting.time_of_day_variants[band] ?? inbound.greeting.time_of_day_variants.morning;
    greetingText = variant.replace(/\{company\}/g, botName);

    if (inbound.greeting.ai_disclosure && inbound.greeting.ai_disclosure_text) {
      greetingText += " " + inbound.greeting.ai_disclosure_text.replace(/\{company\}/g, botName);
    }
  } else if (config.direction === "outbound" && config.directionConfig) {
    const outbound = config.directionConfig as OutboundDirectionConfig;
    greetingText = outbound.opening_script || `Hello, this is ${botName} calling.`;
  } else {
    // Fallback for bots without config
    const fallbacks: Record<TimeBand, string> = {
      morning:   `Good morning, thank you for calling ${botName}. How may I assist you?`,
      afternoon: `Good afternoon, thank you for calling ${botName}. How may I assist you?`,
      evening:   `Good evening, thank you for calling ${botName}. How may I assist you?`,
      night:     `Hello, thank you for calling ${botName}. How may I assist you?`,
    };
    greetingText = fallbacks[band];
  }

  return {
    text: greetingText,
    language: config.defaultGreetingLanguage,
    band,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 3 — Language detection and switching
// ──────────────────────────────────────────────────────────────────────────────

export interface LanguageDetectionResult {
  detected: string;
  confidence: number;
  isSupported: boolean;
  /** If detected and supported but different from current, switch the pipeline */
  shouldSwitch: boolean;
  /** If not supported at all, we need to acknowledge and potentially close */
  unsupported: boolean;
}

/**
 * Evaluates a newly detected language code against the bot's supported list.
 * Called continuously during the call as STT reports language confidence.
 *
 * @param detectedLanguage - ISO 639-1 code detected by STT
 * @param currentLanguage  - Language currently active in the pipeline
 * @param config           - Bot call config
 */
export function evaluateLanguage(
  detectedLanguage: string,
  currentLanguage: string,
  config: BotCallConfig
): LanguageDetectionResult {
  const normalized = detectedLanguage.toLowerCase().split("-")[0]; // "en-US" → "en"
  const supported = config.supportedLanguages.map((l) => l.toLowerCase());
  const isSupported = supported.includes(normalized);
  const isDifferent = normalized !== currentLanguage.toLowerCase();

  return {
    detected: normalized,
    confidence: 1.0,
    isSupported,
    shouldSwitch: isSupported && isDifferent,
    unsupported: !isSupported,
  };
}

/**
 * Returns the polite unsupported-language message to speak.
 * First attempts a brief acknowledgment in the detected language (best-effort),
 * then falls back to English.
 */
export function getUnsupportedLanguageMessage(detectedLang: string): string {
  const phrases: Record<string, string> = {
    es: "Lo siento, no puedo entender su idioma.",
    fr: "Je suis désolé, je ne comprends pas votre langue.",
    de: "Es tut mir leid, ich verstehe Ihre Sprache nicht.",
    ar: "عذراً، لا أستطيع فهم لغتك.",
    hi: "क्षमा करें, मैं आपकी भाषा नहीं समझ सकता।",
    zh: "对不起，我无法理解您的语言。",
    pt: "Desculpe, não consigo entender seu idioma.",
    ru: "Извините, я не понимаю ваш язык.",
    ja: "申し訳ありませんが、あなたの言語を理解できません。",
    ko: "죄송합니다, 귀하의 언어를 이해할 수 없습니다.",
  };
  const langCode = detectedLang.toLowerCase().split("-")[0];
  const localPhrase = phrases[langCode];
  const englishFallback =
    "I'm sorry, I'm not able to understand your language. Would you be able to continue in English?";
  return localPhrase ? `${localPhrase} ${englishFallback}` : englishFallback;
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 4 — Barge-in / interruption handling
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Determines whether caller speech while the bot is talking is a barge-in
 * (interruption) or a backchannel (listening signal like "hmm", "okay").
 *
 * Rules:
 *   - < backchannelThresholdMs AND no content words → backchannel
 *   - ≥ backchannelThresholdMs OR content words detected → barge-in
 *
 * The caller ALWAYS has right of way on a barge-in. TTS must be cancelled
 * within 200ms.
 */
export function classifyBargeIn(
  speechDurationMs: number,
  hasContentWords: boolean,
  backchannelThresholdMs: number
): BargeInDecision {
  const isBackchannel = speechDurationMs < backchannelThresholdMs && !hasContentWords;
  return {
    isBargIn: !isBackchannel,
    isBackchannel,
    durationMs: speechDurationMs,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 5 — Calling-hours validation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the current time (in the bot's timezone) is within the
 * configured calling hours. Only relevant for outbound calls.
 */
export function isWithinCallingHours(
  config: BotCallConfig
): boolean {
  if (config.direction !== "outbound") return true;
  const outbound = config.directionConfig as OutboundDirectionConfig | null;
  if (!outbound?.calling_hours?.respect_timezone) return true;

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  const currentHHMM = `${hh}:${mm}`;

  const { start, end } = outbound.calling_hours;
  return currentHHMM >= start && currentHHMM <= end;
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 6 — Conversation intelligence helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns the latency-masking filler phrase appropriate for the active language.
 * Spoken before any async tool call that will take >800ms.
 */
export function getLatencyFiller(language: string): string {
  const fillers: Record<string, string> = {
    en: "One moment, let me check that for you.",
    hi: "एक पल, मैं यह आपके लिए देख रहा हूँ।",
    ar: "لحظة من فضلك، سأتحقق من ذلك لك.",
    fr: "Un instant, je vérifie cela pour vous.",
    es: "Un momento, déjame verificar eso.",
    de: "Einen Moment, ich prüfe das für Sie.",
    zh: "请稍等，我帮您查一下。",
    pt: "Um momento, deixe-me verificar isso para você.",
    ru: "Одну секунду, позвольте мне проверить это для вас.",
    ja: "少々お待ちください、確認いたします。",
    ko: "잠시만요, 확인해 드리겠습니다.",
  };
  const code = language.toLowerCase().split("-")[0];
  return fillers[code] ?? fillers["en"];
}

/**
 * Returns the silence recovery re-prompt for the active language.
 * Spoken after N seconds of caller silence (configurable per bot).
 */
export function getSilencePrompt(language: string, attempt: number): string {
  if (attempt > 1) {
    // Second re-prompt is slightly different
    const prompts: Record<string, string> = {
      en: "I'm sorry, it seems we may have been disconnected. Thank you for calling — goodbye.",
      hi: "माफ कीजिए, लगता है संपर्क टूट गया। धन्यवाद — अलविदा।",
      ar: "آسف، يبدو أننا انفصلنا. شكراً لاتصالك — مع السلامة.",
      fr: "Je suis désolé, il semble que nous ayons été déconnectés. Merci d'avoir appelé — au revoir.",
      es: "Lo siento, parece que nos desconectamos. Gracias por llamar — adiós.",
    };
    const code = language.toLowerCase().split("-")[0];
    return prompts[code] ?? prompts["en"];
  }
  const prompts: Record<string, string> = {
    en: "Are you still there?",
    hi: "क्या आप अभी भी लाइन पर हैं?",
    ar: "هل لا تزال هناك؟",
    fr: "Êtes-vous toujours là?",
    es: "¿Sigues ahí?",
    de: "Sind Sie noch da?",
    zh: "您还在吗？",
    pt: "Você ainda está aí?",
    ru: "Вы ещё здесь?",
    ja: "まだいらっしゃいますか？",
    ko: "아직 거기 계신가요?",
  };
  const code = language.toLowerCase().split("-")[0];
  return prompts[code] ?? prompts["en"];
}

/**
 * Returns the polite call-wrap closing phrase.
 * Call-connect must always end every call with a summary check-in + polite close.
 */
export function getCallWrapPhrase(language: string): string {
  const phrases: Record<string, string> = {
    en: "Is there anything else I can help you with today?",
    hi: "क्या आज मैं आपकी और कोई मदद कर सकता हूँ?",
    ar: "هل هناك أي شيء آخر يمكنني مساعدتك به اليوم؟",
    fr: "Y a-t-il autre chose que je puisse faire pour vous aujourd'hui?",
    es: "¿Hay algo más en lo que pueda ayudarle hoy?",
    de: "Gibt es noch etwas, womit ich Ihnen heute helfen kann?",
    zh: "今天还有什么我可以帮您的吗？",
    pt: "Há mais alguma coisa em que eu possa ajudá-lo hoje?",
    ru: "Могу ли я ещё чем-нибудь помочь вам сегодня?",
    ja: "他に何かお手伝いできることはありますか？",
    ko: "오늘 더 도와드릴 것이 있나요?",
  };
  const code = language.toLowerCase().split("-")[0];
  return phrases[code] ?? phrases["en"];
}

// ──────────────────────────────────────────────────────────────────────────────
// High-level call-connect orchestrator
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Main entry point — runs once media is established on a call.
 * Simulates the full call-connect state machine for the dev environment.
 *
 * In production, the telephony media server drives each step via events.
 * This function handles the simulation path used by the /v1/calls/dial mock.
 */
export async function runCallConnectSimulation(
  callId: string,
  botConfig: BotCallConfig,
  botName: string
): Promise<{
  outcome: ConnectOutcome;
  disposition: CallDisposition;
  greetingText: string;
  greetingLanguage: string;
  interruptionCount: number;
  escalationCount: number;
  languageSwitches: LanguageSwitchEvent[];
  amdResult: string | null;
}> {
  // Step 1: AMD (outbound only)
  let outcome: ConnectOutcome = "HUMAN";
  let amdResult: string | null = null;
  const outboundConfig = botConfig.direction === "outbound"
    ? (botConfig.directionConfig as OutboundDirectionConfig | null)
    : null;

  if (botConfig.direction === "outbound") {
    outcome = simulateAMD(outboundConfig?.amd?.enabled ?? true);
    amdResult = outcome;
  }

  // Step 2: Greeting
  const { text: greetingText, language: greetingLanguage } = composeGreeting(botConfig, botName);

  // Simulate call intelligence events
  const interruptionCount = outcome === "HUMAN" ? Math.floor(Math.random() * 4) : 0;
  const escalationCount = outcome === "HUMAN" && Math.random() < 0.1 ? 1 : 0;
  const languageSwitches: LanguageSwitchEvent[] = [];

  // Determine disposition
  let disposition: CallDisposition = "COMPLETED";
  if (outcome === "ANSWERING_MACHINE") {
    disposition = outboundConfig?.amd?.on_machine_detected?.hangup_after_message
      ? "VOICEMAIL_LEFT"
      : "AMD_HANGUP";
  } else if (outcome === "SILENCE" || outcome === "NO_RESPONSE") {
    disposition = "NO_RESPONSE";
  } else if (outcome === "IVR") {
    disposition = "FAILED";
  } else if (escalationCount > 0) {
    disposition = Math.random() < 0.5 ? "TRANSFERRED" : "COMPLETED";
  }

  return {
    outcome,
    disposition,
    greetingText,
    greetingLanguage,
    interruptionCount,
    escalationCount,
    languageSwitches,
    amdResult,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// CRM disposition webhook
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Persists a CRM disposition event for a call.
 * In production, also triggers the pluggable webhook to external CRMs.
 */
export async function writeCrmDisposition(
  callId: string,
  disposition: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  // Update the call record
  await db
    .update(callsTable)
    .set({ finalDisposition: disposition })
    .where(eq(callsTable.id, callId));

  // TODO: fire pluggable webhook to external CRMs
  // const webhookUrl = await getCrmWebhookUrl();
  // if (webhookUrl) await fetch(webhookUrl, { method: "POST", body: JSON.stringify({ callId, disposition, ...metadata }) });
}

// ──────────────────────────────────────────────────────────────────────────────
// Convenience: load bot call config from DB
// ──────────────────────────────────────────────────────────────────────────────

export async function loadBotCallConfig(botId: string): Promise<BotCallConfig | null> {
  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, botId));
  if (!bot) return null;

  return {
    id: bot.id,
    direction: bot.direction ?? "inbound",
    directionConfig: (bot.directionConfig as InboundDirectionConfig | OutboundDirectionConfig | null) ?? null,
    supportedLanguages: (bot.supportedLanguages as string[] | null) ?? ["en"],
    defaultGreetingLanguage: bot.defaultGreetingLanguage ?? "en",
    timezone: bot.timezone ?? "UTC",
    endpointSilenceMs: bot.endpointSilenceMs ?? 1200,
    backchannelThresholdMs: bot.backchannelThresholdMs ?? 700,
    silenceRecoverySecs: bot.silenceRecoverySecs ?? 6,
  };
}
