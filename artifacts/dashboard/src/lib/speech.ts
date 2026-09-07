/**
 * Thin wrappers over the Web Speech API.
 *
 * Both halves are browser-native: recognition is Chrome/Edge/Safari only
 * (prefixed as `webkitSpeechRecognition`), and synthesis is universal but
 * varies in voice quality per platform.
 */

// The DOM lib does not ship SpeechRecognition types, so declare the slice used.
export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}
export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
  return recognitionCtor() !== null;
}

export function speechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function createRecognition(lang = "en-US"): SpeechRecognitionLike | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = lang;
  // One utterance per start(): the caller decides when to listen again, which
  // keeps turn-taking explicit rather than racing the agent's own speech.
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 1;
  return r;
}

/** Prefer a natural-sounding English voice; fall back to whatever exists. */
export function pickVoice(): SpeechSynthesisVoice | null {
  if (!speechSynthesisSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = english.length ? english : voices;
  const preferred = [
    "Google US English",
    "Samantha",
    "Microsoft Aria Online (Natural) - English (United States)",
    "Microsoft Jenny Online (Natural) - English (United States)",
    "Karen",
    "Daniel",
  ];
  for (const name of preferred) {
    const hit = pool.find((v) => v.name === name);
    if (hit) return hit;
  }
  return pool.find((v) => /natural|neural|google/i.test(v.name)) ?? pool[0];
}

/**
 * Speak `text`, resolving when playback ends (or immediately if synthesis is
 * unavailable). Rejection is deliberately avoided — a failed utterance should
 * never strand the conversation state machine.
 */
export function speak(
  text: string,
  opts: { voice?: SpeechSynthesisVoice | null; signal?: AbortSignal } = {}
): Promise<void> {
  return new Promise((resolve) => {
    if (!speechSynthesisSupported() || opts.signal?.aborted) {
      resolve();
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    if (opts.voice) utter.voice = opts.voice;
    utter.rate = 1.02;
    utter.pitch = 1.03;
    utter.volume = 1;

    let done = false;
    // Some browser/voice combinations never dispatch `onend`, which used to
    // strand the conversation before listening reopened. Use a generous
    // duration-based fallback while still preferring the real speech event.
    const fallbackMs = Math.max(8_000, Math.min(45_000, text.length * 95));
    let fallbackTimer: number | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    function onAbort() {
      synth.cancel();
      finish();
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    utter.onend = finish;
    utter.onerror = finish;
    fallbackTimer = window.setTimeout(finish, fallbackMs);
    synth.speak(utter);
  });
}

/**
 * Pull a first name out of a spoken reply — "my name is Aveek", "I'm Aveek",
 * "it's Aveek", or a bare "Aveek".
 */
export function extractName(raw: string): string | null {
  const cleaned = raw.trim().replace(/[.!,?]+$/g, "");
  if (!cleaned) return null;

  const patterns = [
    /(?:my name(?:'s| is)|i am|i'm|it's|it is|this is|call me|they call me)\s+([a-z][a-z'’-]*(?:\s+[a-z][a-z'’-]*)?)/i,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m?.[1]) return titleCase(m[1]);
  }

  // A bare answer: accept one or two words, rejecting obvious non-answers.
  const words = cleaned.split(/\s+/);
  if (words.length <= 2 && /^[a-z][a-z'’-]*$/i.test(words[0])) {
    const stop = new Set([
      "hi", "hey", "hello", "yes", "no", "sure", "okay", "ok",
      "nothing", "who", "what", "why", "sorry", "nope", "yeah",
    ]);
    if (stop.has(words[0].toLowerCase())) return null;
    return titleCase(words.join(" "));
  }
  return null;
}

function titleCase(s: string) {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
