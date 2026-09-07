import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Loader2, Mic, Play, Settings, Sparkles, Square, TriangleAlert, Volume2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createVisualizer, type VisualizerHandle, type VoicePhase } from "@/lib/voice-visualizer";
import {
  createRecognition,
  pickVoice,
  speak,
  speechRecognitionSupported,
  speechSynthesisSupported,
  type SpeechRecognitionLike,
} from "@/lib/speech";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const OPENING_LINE = "Hello, I'm Vox, your AI bot assistant. How may I help you today?";
const VOICE_STORAGE_KEY = "voxagent.browserVoiceUri";

const HUMAN_VOICES = [
  { model: "aura-2-helena-en", name: "Helena", presentation: "Woman", accent: "American", style: "Warm, friendly and natural", language: "en" },
  { model: "aura-2-thalia-en", name: "Thalia", presentation: "Woman", accent: "American", style: "Clear, energetic and confident", language: "en" },
  { model: "aura-2-vesta-en", name: "Vesta", presentation: "Woman", accent: "American", style: "Patient and empathetic", language: "en" },
  { model: "aura-2-arcas-en", name: "Arcas", presentation: "Man", accent: "American", style: "Natural, smooth and relaxed", language: "en" },
  { model: "aura-2-orpheus-en", name: "Orpheus", presentation: "Man", accent: "American", style: "Clear and trustworthy", language: "en" },
  { model: "aura-2-pandora-en", name: "Pandora", presentation: "Woman", accent: "British", style: "Calm, smooth and melodic", language: "en" },
  { model: "aura-2-draco-en", name: "Draco", presentation: "Man", accent: "British", style: "Warm and trustworthy", language: "en" },
  { model: "aura-2-theia-en", name: "Theia", presentation: "Woman", accent: "Australian", style: "Expressive and sincere", language: "en" },
  { model: "aura-2-hyperion-en", name: "Hyperion", presentation: "Man", accent: "Australian", style: "Warm and empathetic", language: "en" },
  { model: "aura-2-amalthea-en", name: "Amalthea", presentation: "Woman", accent: "Filipino", style: "Cheerful and conversational", language: "en" },
  { model: "aura-2-celeste-es", name: "Celeste", presentation: "Woman", accent: "Colombian Spanish", style: "Friendly and positive", language: "es" },
  { model: "aura-2-nestor-es", name: "Nestor", presentation: "Man", accent: "Spanish", style: "Calm and approachable", language: "es" },
  { model: "aura-2-agathe-fr", name: "Agathe", presentation: "Woman", accent: "French", style: "Natural and charismatic", language: "fr" },
  { model: "aura-2-hector-fr", name: "Hector", presentation: "Man", accent: "French", style: "Patient and expressive", language: "fr" },
  { model: "aura-2-viktoria-de", name: "Viktoria", presentation: "Woman", accent: "German", style: "Warm and friendly", language: "de" },
  { model: "aura-2-julius-de", name: "Julius", presentation: "Man", accent: "German", style: "Casual and engaging", language: "de" },
  { model: "aura-2-livia-it", name: "Livia", presentation: "Woman", accent: "Italian", style: "Clear and expressive", language: "it" },
  { model: "aura-2-dionisio-it", name: "Dionisio", presentation: "Man", accent: "Italian", style: "Friendly and melodic", language: "it" },
  { model: "aura-2-izanami-ja", name: "Izanami", presentation: "Woman", accent: "Japanese", style: "Natural and polite", language: "ja" },
  { model: "aura-2-fujin-ja", name: "Fujin", presentation: "Man", accent: "Japanese", style: "Calm and smooth", language: "ja" },
] as const;

async function speakWithNeuralVoice(text: string, model: string, signal?: AbortSignal) {
  const response = await fetch(`${BASE}/api/v1/voice-agent/speech`, {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
    body: JSON.stringify({ text, model }), signal,
  });
  if (!response.ok) throw new Error(`Neural speech failed (${response.status})`);
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(objectUrl);
      const finish = () => { signal?.removeEventListener("abort", onAbort); resolve(); };
      const onAbort = () => { audio.pause(); finish(); };
      audio.onended = finish;
      audio.onerror = () => reject(new Error("Neural audio playback failed"));
      signal?.addEventListener("abort", onAbort, { once: true });
      void audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function voiceForLanguage(voices: SpeechSynthesisVoice[], locale: string) {
  const normalized = locale.toLowerCase();
  const base = normalized.split("-")[0];
  const matches = voices.filter((voice) => {
    const lang = voice.lang.toLowerCase();
    return lang === normalized || lang.split("-")[0] === base;
  });
  return matches.find((voice) => /natural|neural|google|enhanced/i.test(voice.name)) ?? matches[0] ?? null;
}

/** Copy + tint for the status pill under the orb. */
const PHASE_UI: Record<VoicePhase, { label: string; className: string }> = {
  idle: { label: "Ready when you are", className: "border-white/10 bg-white/[0.04] text-muted-foreground" },
  speaking: { label: "Vox is speaking", className: "border-brand-to/30 bg-brand-to/10 text-brand-to" },
  listening: { label: "Listening…", className: "border-accent/30 bg-accent/10 text-accent" },
  thinking: { label: "Thinking…", className: "border-primary/30 bg-primary/10 text-primary-soft" },
};

export default function VoiceAgentPage() {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [active, setActive] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [interim, setInterim] = useState("");
  const [userName, setUserName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceUri, setSelectedVoiceUri] = useState(() => localStorage.getItem(VOICE_STORAGE_KEY) ?? "deepgram:aura-2-helena-en");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const vizRef = useRef<VisualizerHandle | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  /**
   * The conversation runs inside async callbacks, so the pieces they read are
   * mirrored into refs — state alone would be stale by the time a reply lands.
   */
  const activeRef = useRef(false);
  const turnsRef = useRef<Turn[]>([]);
  const nameRef = useRef<string | null>(null);
  const gotResultRef = useRef(false);
  /**
   * Recognition ends on silence as well as on success, and we reopen it so the
   * caller can pause mid-thought. A hard failure (no capture device, repeated
   * network errors) also ends immediately, which would spin that reopen into a
   * hot loop — so bail out if restarts come back faster than a real pause.
   */
  const listenStartedAtRef = useRef(0);
  const rapidRestartsRef = useRef(0);
  const recognitionLanguageRef = useRef(navigator.language || "en-US");

  const supported = speechRecognitionSupported() && speechSynthesisSupported();

  // ── Visualizer lifecycle ─────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    const viz = createVisualizer(canvasRef.current);
    vizRef.current = viz;
    return () => {
      viz.destroy();
      vizRef.current = null;
    };
  }, []);

  const goToPhase = useCallback((next: VoicePhase) => {
    setPhase(next);
    vizRef.current?.setPhase(next);
  }, []);

  // Voice list populates asynchronously in Chrome.
  useEffect(() => {
    if (!speechSynthesisSupported()) return;
    const load = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);
      const selected = voices.find((voice) => voice.voiceURI === selectedVoiceUri) ?? pickVoice();
      voiceRef.current = selected;
      if (selected && !selectedVoiceUri) {
        setSelectedVoiceUri(selected.voiceURI);
        localStorage.setItem(VOICE_STORAGE_KEY, selected.voiceURI);
      }
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [selectedVoiceUri]);

  const chooseVoice = useCallback((voiceUri: string) => {
    const selected = voiceUri.startsWith("deepgram:") ? null : availableVoices.find((voice) => voice.voiceURI === voiceUri) ?? null;
    setSelectedVoiceUri(voiceUri);
    voiceRef.current = selected;
    localStorage.setItem(VOICE_STORAGE_KEY, voiceUri);
  }, [availableVoices]);

  const previewVoice = useCallback(() => {
    const model = selectedVoiceUri.startsWith("deepgram:") ? selectedVoiceUri.slice("deepgram:".length) : null;
    if (model) {
      void speakWithNeuralVoice("Hello! I'm Vox, your AI voice assistant.", model).catch(() =>
        speak("Hello! I'm Vox, your AI voice assistant.", { voice: voiceRef.current })
      );
      return;
    }
    void speak("Hello! I'm Vox, your AI voice assistant.", { voice: voiceRef.current });
  }, [selectedVoiceUri]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, interim]);

  const pushTurn = useCallback((turn: Turn) => {
    turnsRef.current = [...turnsRef.current, turn];
    setTurns(turnsRef.current);
  }, []);

  // ── Teardown ─────────────────────────────────────────────────────────────
  const stopSession = useCallback(() => {
    activeRef.current = false;
    setActive(false);

    abortRef.current?.abort();
    abortRef.current = null;

    const rec = recognitionRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
    }

    if (speechSynthesisSupported()) window.speechSynthesis.cancel();

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    vizRef.current?.setAnalyser(null);
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;

    setInterim("");
    goToPhase("idle");
  }, [goToPhase]);

  // Never leave the mic open or a voice mid-sentence on unmount.
  useEffect(() => stopSession, [stopSession]);

  // ── Speaking ─────────────────────────────────────────────────────────────
  const say = useCallback(
    async (text: string, language?: string | null) => {
      pushTurn({ role: "assistant", content: text });
      goToPhase("speaking");
      let model = selectedVoiceUri.startsWith("deepgram:") ? selectedVoiceUri.slice("deepgram:".length) : null;
      if (model && language) {
        const languageBase = language.toLowerCase().split("-")[0];
        const selectedPersona = HUMAN_VOICES.find((voice) => voice.model === model);
        const localizedPersona = HUMAN_VOICES.find(
          (voice) => voice.language === languageBase && voice.presentation === selectedPersona?.presentation
        ) ?? HUMAN_VOICES.find((voice) => voice.language === languageBase);
        // For languages not offered by the neural provider, use the best local
        // voice instead of making an English model mispronounce the reply.
        model = localizedPersona?.model ?? null;
      }
      if (model) {
        try {
          await speakWithNeuralVoice(text, model, abortRef.current?.signal);
          return;
        } catch {
          // Fall back to a device voice if neural synthesis is unavailable.
        }
      }
      await speak(text, { voice: voiceRef.current, signal: abortRef.current?.signal });
    },
    [goToPhase, pushTurn, selectedVoiceUri]
  );

  // ── Listening ────────────────────────────────────────────────────────────
  // Declared as a ref so listen() and handleUtterance() can call each other.
  const listenRef = useRef<() => void>(() => {});

  const askModel = useCallback(async (): Promise<{ reply: string; language?: string | null }> => {
    const res = await fetch(`${BASE}/api/v1/voice-agent/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ messages: turnsRef.current, userName: nameRef.current }),
    });
    if (!res.ok) throw new Error(`Reply failed (${res.status})`);
    const data = (await res.json()) as { reply: string; language?: string | null; engine?: string };
    if (data.engine) setEngine(data.engine);
    return data;
  }, []);

  const handleUtterance = useCallback(
    async (text: string) => {
      if (!activeRef.current) return;
      pushTurn({ role: "user", content: text });

      goToPhase("thinking");
      try {
        const { reply, language } = await askModel();
        if (!activeRef.current) return;
        if (language) {
          recognitionLanguageRef.current = language;
          const localizedVoice = voiceForLanguage(availableVoices, language);
          if (localizedVoice) voiceRef.current = localizedVoice;
        }
        await say(reply, language);
      } catch (err) {
        if (!activeRef.current) return;
        setError(err instanceof Error ? err.message : "Could not reach the agent");
        await say("Sorry, something went wrong on my end. Could you say that again?");
      }
      listenRef.current();
    },
    [askModel, availableVoices, goToPhase, pushTurn, say]
  );

  const listen = useCallback(() => {
    if (!activeRef.current) return;

    const rec = createRecognition(recognitionLanguageRef.current);
    if (!rec) {
      setError("Speech recognition is not available in this browser.");
      stopSession();
      return;
    }
    recognitionRef.current = rec;
    gotResultRef.current = false;
    listenStartedAtRef.current = Date.now();
    setInterim("");
    goToPhase("listening");

    rec.onresult = (e) => {
      let finalText = "";
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else pending += result[0].transcript;
      }
      setInterim(pending);
      const trimmed = finalText.trim();
      if (trimmed) {
        gotResultRef.current = true;
        rapidRestartsRef.current = 0;
        setInterim("");
        try {
          rec.stop();
        } catch {
          /* already stopping */
        }
        void handleUtterance(trimmed);
      }
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access was blocked. Allow it in your browser to talk.");
        stopSession();
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        setError(`Speech recognition error: ${e.error}`);
      }
    };

    // Silence ends recognition without a result — reopen so the caller can
    // take their time, rather than dropping them out of the conversation.
    rec.onend = () => {
      if (!activeRef.current || gotResultRef.current) return;

      const elapsed = Date.now() - listenStartedAtRef.current;
      rapidRestartsRef.current = elapsed < 500 ? rapidRestartsRef.current + 1 : 0;
      if (rapidRestartsRef.current >= 5) {
        setError("The microphone stopped responding. Check your input device and try again.");
        stopSession();
        return;
      }
      listenRef.current();
    };

    try {
      rec.start();
    } catch {
      /* start() throws if called while already running */
    }
  }, [goToPhase, handleUtterance, stopSession]);

  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);

  // ── Start ────────────────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setError(null);
    setTurns([]);
    setInterim("");
    setUserName(null);
    turnsRef.current = [];
    nameRef.current = null;
    activeRef.current = true;
    rapidRestartsRef.current = 0;
    setActive(true);
    abortRef.current = new AbortController();

    // Live spectrum for the "listening" half of the visualizer.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtor();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      ctx.createMediaStreamSource(stream).connect(analyser);
      vizRef.current?.setAnalyser(analyser);
    } catch {
      // Recognition may still work; the ring just falls back to its synthesized
      // motion while listening.
      setError("Microphone access was blocked, so the live waveform is unavailable.");
    }

    if (!activeRef.current) return;
    await say(OPENING_LINE);
    listenRef.current();
  }, [say]);

  const ui = PHASE_UI[phase];

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 p-6 md:p-8">
      <PageHeader
        title="Talk to Vox"
        subtitle="A live voice conversation with your agent"
        icon={AudioLines}
        actions={(
          <>
            {engine && (
              <div className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.04] px-3 py-1.5">
                <Sparkles className="h-3 w-3 text-primary" />
                <span className="text-[11px] font-medium text-muted-foreground">{engine}</span>
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              disabled={!speechSynthesisSupported() || active}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-3.5 w-3.5" />
              Voice settings
            </Button>
          </>
        )}
      />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Volume2 className="h-4 w-4 text-primary" /> Assistant voice
            </DialogTitle>
            <DialogDescription className="text-xs">
              Choose a natural voice by name, accent and presentation. Your selection is saved automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Voice</Label>
              <Select value={selectedVoiceUri} onValueChange={chooseVoice}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an assistant voice" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {[...new Set(HUMAN_VOICES.map((voice) => voice.accent))].map((accent) => (
                    <SelectGroup key={accent}>
                      <SelectLabel>{accent}</SelectLabel>
                      {HUMAN_VOICES.filter((voice) => voice.accent === accent).map((voice) => (
                        <SelectItem key={voice.model} value={`deepgram:${voice.model}`}>
                          {voice.name} · {voice.presentation} · {voice.style}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                  {availableVoices.length > 0 && <SelectSeparator />}
                  {availableVoices.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Device voices · fallback</SelectLabel>
                  {availableVoices.map((voice) => (
                    <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} · {voice.lang}{voice.localService ? "" : " · Online"}
                    </SelectItem>
                  ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Neural voices use Deepgram; device voices remain available as multilingual fallbacks.
              </p>
            </div>

            <div className="flex justify-between gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={previewVoice} disabled={!selectedVoiceUri}>
                <Play className="h-3.5 w-3.5" /> Preview voice
              </Button>
              <Button size="sm" className="text-xs" onClick={() => setSettingsOpen(false)}>Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {!supported && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
          <div className="text-sm text-warning">
            <p className="font-medium">This browser can't do live speech.</p>
            <p className="mt-1 text-warning/80">
              The Web Speech API is needed for both listening and speaking. Chrome, Edge
              or Safari on desktop will work.
            </p>
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-5">
        {/* ── Stage ─────────────────────────────────────────────────────── */}
        <div className="panel relative overflow-hidden bg-sky-50 lg:col-span-3" style={{ backgroundColor: "#f3f8fc" }}>
          <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-10" />

          <div className="relative flex h-full flex-col items-center justify-center px-6 py-8">
            <canvas
              ref={canvasRef}
              className="h-[340px] w-full max-w-[520px]"
              aria-hidden="true"
            />

            <div
              className={cn(
                "-mt-4 flex items-center gap-2 rounded-full border px-3.5 py-1.5 transition-colors duration-300",
                phase === "idle"
                  ? "border-slate-200 bg-slate-50 text-slate-600"
                  : ui.className
              )}
            >
              {phase === "listening" && <Mic className="h-3.5 w-3.5" />}
              {phase === "speaking" && <Volume2 className="h-3.5 w-3.5" />}
              {phase === "thinking" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {phase === "idle" && <AudioLines className="h-3.5 w-3.5" />}
              <span className="text-xs font-medium">{ui.label}</span>
            </div>

            {/* Live partial transcript, so speaking feels acknowledged */}
            <p className="mt-5 min-h-[2.5rem] max-w-md text-center text-sm text-slate-600">
              {interim ? (
                <span className="text-slate-800">{interim}</span>
              ) : active ? (
                userName ? `Go ahead, ${userName}.` : "Go ahead. I'm listening."
              ) : (
                "Press start and Vox will say hello."
              )}
            </p>

            {/* ── The one control ─────────────────────────────────────── */}
            <Button
              size="lg"
              variant={active ? "destructive" : "default"}
              className="mt-6 min-w-[200px]"
              disabled={!supported}
              onClick={active ? stopSession : () => void startSession()}
            >
              {active ? (
                <>
                  <Square className="fill-current" />
                  Stop talking
                </>
              ) : (
                <>
                  <Mic />
                  Start talking
                </>
              )}
            </Button>

            {error && (
              <p className="mt-4 max-w-md text-center text-xs text-destructive">{error}</p>
            )}
          </div>
        </div>

        {/* ── Transcript ────────────────────────────────────────────────── */}
        <div className="panel flex min-h-0 flex-col lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
            <h2 className="section-label">Transcript</h2>
            {userName && (
              <span className="ml-auto rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                {userName}
              </span>
            )}
          </div>

          <div ref={transcriptRef} className="flex-1 space-y-3 overflow-y-auto p-5">
            {turns.length === 0 && !interim ? (
              <p className="py-10 text-center text-xs text-muted-foreground">
                Nothing said yet.
              </p>
            ) : (
              turns.map((t, i) => (
                <div
                  key={i}
                  className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
                      t.role === "user"
                        ? "bg-gradient-to-b from-primary to-primary-deep text-primary-foreground shadow-[var(--glow-primary)]"
                        : "border border-white/[0.07] bg-white/[0.04] text-foreground"
                    )}
                  >
                    {t.content}
                  </div>
                </div>
              ))
            )}

            {interim && (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-xl border border-dashed border-primary/40 px-3.5 py-2.5 text-sm italic text-muted-foreground">
                  {interim}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
