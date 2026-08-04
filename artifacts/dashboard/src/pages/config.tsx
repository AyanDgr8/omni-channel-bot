import { useState, useEffect } from "react";
import PersonaEngine from "./persona-engine";
import {
  useGetPersonaConfig,
  useUpdatePersonaConfig,
  useGetConversationConfig,
  useUpdateConversationConfig,
  useGetLlmConfig,
  useUpdateLlmConfig,
  getGetPersonaConfigQueryKey,
  getGetConversationConfigQueryKey,
  getGetLlmConfigQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Save, Key, CheckCircle2, XCircle, Loader2, RefreshCw, Play } from "lucide-react";

function SliderField({ label, value, onChange, min = 0, max = 1, step = 0.01, fmt = (v: number) => v.toFixed(2) }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; fmt?: (v: number) => string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs text-primary font-mono">{fmt(value)}</span>
      </div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} className="w-full" />
    </div>
  );
}

export default function Config() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: persona } = useGetPersonaConfig();
  const { data: conv } = useGetConversationConfig();
  const { data: llm } = useGetLlmConfig();

  const updatePersona = useUpdatePersonaConfig();
  const updateConv = useUpdateConversationConfig();
  const updateLlm = useUpdateLlmConfig();

  const [p, setP] = useState<any>(null);
  const [c, setC] = useState<any>(null);
  const [l, setL] = useState<any>(null);

  useEffect(() => { if (persona && !p) setP(persona); }, [persona]);
  useEffect(() => { if (conv && !c) setC(conv); }, [conv]);
  useEffect(() => { if (llm && !l) setL(llm); }, [llm]);

  function savePersona() {
    const { id, updatedAt, ...rest } = p;
    updatePersona.mutate({ data: rest }, {
      onSuccess: () => { toast({ title: "Persona config saved" }); qc.invalidateQueries({ queryKey: getGetPersonaConfigQueryKey() }); },
      onError: () => toast({ title: "Failed to save", variant: "destructive" }),
    });
  }

  function saveConv() {
    const { id, updatedAt, ...rest } = c;
    updateConv.mutate({ data: rest }, {
      onSuccess: () => { toast({ title: "Conversation config saved" }); qc.invalidateQueries({ queryKey: getGetConversationConfigQueryKey() }); },
      onError: () => toast({ title: "Failed to save", variant: "destructive" }),
    });
  }

  function saveLlm() {
    const { id, updatedAt, ...rest } = l;
    updateLlm.mutate({ data: rest }, {
      onSuccess: () => { toast({ title: "LLM config saved" }); qc.invalidateQueries({ queryKey: getGetLlmConfigQueryKey() }); },
      onError: () => toast({ title: "Failed to save", variant: "destructive" }),
    });
  }

  const chars = ["professional", "friendly", "funny", "serious", "empathetic", "casual"] as const;
  const greetings = ["warm", "formal", "brief"] as const;
  const interrupts = ["HARD_INTERRUPT", "SOFT_INTERRUPT", "NO_INTERRUPT"] as const;
  const engines = ["openai", "anthropic", "gemini", "ollama"] as const;

  if (!p || !c || !l) return <div className="p-6 text-sm text-muted-foreground">Loading configuration...</div>;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-foreground tracking-tight">Configuration</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Hot-reload runtime settings — changes apply immediately</p>
      </div>

      <Tabs defaultValue="persona">
        <TabsList className="bg-muted text-xs">
          <TabsTrigger value="persona" className="text-xs">Persona</TabsTrigger>
          <TabsTrigger value="conversation" className="text-xs">Conversation</TabsTrigger>
          <TabsTrigger value="llm" className="text-xs">LLM Engine</TabsTrigger>
          <TabsTrigger value="apikeys" className="text-xs">API Keys</TabsTrigger>
        </TabsList>

        <TabsContent value="persona" className="mt-4">
          <PersonaEngine />
        </TabsContent>

        <TabsContent value="conversation" className="mt-4">
          <div className="bg-card border border-card-border rounded p-5 space-y-4 max-w-xl">
            {[
              { label: "Answer Delay (ms)", key: "answerDelayMs", min: 0, max: 2000, step: 50 },
              { label: "Max Silence (ms)", key: "maxSilenceMs", min: 500, max: 5000, step: 100 },
              { label: "Barge-in Threshold", key: "bargeInThreshold", min: 0, max: 1, step: 0.05 },
              { label: "Min Speech (ms)", key: "minSpeechMs", min: 50, max: 1000, step: 50 },
              { label: "End of Utterance (ms)", key: "endOfUtteranceMs", min: 200, max: 3000, step: 100 },
              { label: "Max Turn Duration (sec)", key: "maxTurnDurationSec", min: 10, max: 180, step: 5 },
              { label: "Response Timeout (sec)", key: "responseTimeoutSec", min: 1, max: 30, step: 1 },
              { label: "Speaking Rate", key: "speakingRate", min: 0.5, max: 2.0, step: 0.1 },
            ].map(({ label, key, min, max, step }) => (
              <SliderField
                key={key}
                label={label}
                value={c[key]}
                onChange={(v) => setC((x: any) => ({ ...x, [key]: key === "bargeInThreshold" || key === "speakingRate" ? v : Math.round(v) }))}
                min={min}
                max={max}
                step={step}
                fmt={(v) => key === "bargeInThreshold" || key === "speakingRate" ? v.toFixed(2) : String(Math.round(v))}
              />
            ))}

            <div className="flex items-center justify-between py-1">
              <Label className="text-xs">Barge-in Enabled</Label>
              <Switch checked={c.bargeInEnabled} onCheckedChange={(v) => setC((x: any) => ({ ...x, bargeInEnabled: v }))} />
            </div>

            <Button size="sm" onClick={saveConv} disabled={updateConv.isPending} className="gap-1.5 text-xs">
              <Save className="w-3 h-3" /> {updateConv.isPending ? "Saving..." : "Save Pacing"}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="llm" className="mt-4">
          <div className="bg-card border border-card-border rounded p-5 space-y-5 max-w-xl">
            <div className="space-y-1.5">
              <Label className="text-xs">Primary Engine</Label>
              <Select value={l.primary} onValueChange={(v) => setL((x: any) => ({ ...x, primary: v }))}>
                <SelectTrigger className="mt-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{engines.map((e) => <SelectItem key={e} value={e} className="text-xs capitalize">{e}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Fallback Chain</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {engines.filter((e) => e !== l.primary).map((e) => {
                  const active = l.fallbackChain.includes(e);
                  return (
                    <button
                      key={e}
                      onClick={() => {
                        const chain = active ? l.fallbackChain.filter((x: string) => x !== e) : [...l.fallbackChain, e];
                        setL((x: any) => ({ ...x, fallbackChain: chain }));
                      }}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors capitalize ${active ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border"}`}
                    >
                      {e}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">Order: {l.fallbackChain.join(" → ") || "None"}</p>
            </div>

            <SliderField label="Timeout (ms)" value={l.timeoutMs} onChange={(v) => setL((x: any) => ({ ...x, timeoutMs: Math.round(v) }))} min={500} max={10000} step={500} fmt={(v) => `${Math.round(v)}ms`} />
            <SliderField label="Max Retries" value={l.maxRetries} onChange={(v) => setL((x: any) => ({ ...x, maxRetries: Math.round(v) }))} min={0} max={5} step={1} fmt={(v) => String(Math.round(v))} />
            <SliderField label="Circuit Breaker Threshold" value={l.circuitBreakerFailureThreshold} onChange={(v) => setL((x: any) => ({ ...x, circuitBreakerFailureThreshold: Math.round(v) }))} min={1} max={20} step={1} fmt={(v) => String(Math.round(v))} />
            <SliderField label="Circuit Recovery (sec)" value={l.circuitBreakerRecoveryTimeoutSec} onChange={(v) => setL((x: any) => ({ ...x, circuitBreakerRecoveryTimeoutSec: Math.round(v) }))} min={5} max={120} step={5} fmt={(v) => `${Math.round(v)}s`} />

            <Button size="sm" onClick={saveLlm} disabled={updateLlm.isPending} className="gap-1.5 text-xs">
              <Save className="w-3 h-3" /> {updateLlm.isPending ? "Saving..." : "Save LLM Config"}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="apikeys" className="mt-4">
          <ApiKeysTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── API Keys tab ─────────────────────────────────────────────────────────────

interface ApiKeyStatus {
  isSet: boolean;
  preview: string | null;
  label: string;
}

const SERVICE_META: Record<string, { icon: string; desc: string; docsUrl: string }> = {
  openai: { icon: "⚡", desc: "Powers GPT-4o / GPT-4 Turbo as the primary LLM engine", docsUrl: "https://platform.openai.com/api-keys" },
  gemini: { icon: "✦", desc: "Powers Google Gemini as the primary or fallback LLM engine", docsUrl: "https://aistudio.google.com/app/apikey" },
  deepgram: { icon: "🎙", desc: "Speech-to-text and text-to-speech for voice calls", docsUrl: "https://console.deepgram.com/signup" },
};

function ApiKeysTab() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<Record<string, ApiKeyStatus>>({
    queryKey: ["api-keys-status"],
    queryFn: () => fetch("/api/v1/config/api-keys").then((r) => r.json()),
    staleTime: 30_000,
  });
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  async function testKey(service: string) {
    setTesting((t) => ({ ...t, [service]: true }));
    try {
      const r = await fetch(`/api/v1/config/api-keys/${service}/test`, { method: "POST" });
      const result = await r.json() as { success: boolean; message?: string; error?: string };
      setTestResults((tr) => ({ ...tr, [service]: { success: result.success, message: result.message ?? result.error ?? "Unknown" } }));
      toast({ title: result.success ? `${service} connected` : `${service} test failed`, description: result.message ?? result.error, variant: result.success ? "default" : "destructive" });
    } finally {
      setTesting((t) => ({ ...t, [service]: false }));
    }
  }

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }

  const services = data ? Object.entries(data) : [];

  return (
    <div className="max-w-xl space-y-4">
      <div className="bg-muted/50 border border-border rounded p-3 text-xs text-muted-foreground leading-relaxed">
        <strong className="text-foreground">How to set API keys:</strong> Go to the <strong>Secrets</strong> tab in your Replit project sidebar and add the values for <code className="font-mono bg-muted px-1 rounded">OPENAI_API_KEY</code>, <code className="font-mono bg-muted px-1 rounded">GEMINI_API_KEY</code>, and <code className="font-mono bg-muted px-1 rounded">DEEPGRAM_API_KEY</code>. The server reads them automatically on restart.
      </div>

      {services.map(([service, status]) => {
        const meta = SERVICE_META[service];
        const testResult = testResults[service];
        return (
          <div key={service} className="bg-card border border-border rounded p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">{meta?.icon ?? "🔑"}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{status.label}</p>
                    {status.isSet ? (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Connected
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                        <XCircle className="w-2.5 h-2.5" /> Not set
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{meta?.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 px-2.5 gap-1"
                  onClick={() => refetch()}
                >
                  <RefreshCw className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 px-2.5 gap-1"
                  disabled={!status.isSet || testing[service]}
                  onClick={() => testKey(service)}
                >
                  {testing[service] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  Test
                </Button>
              </div>
            </div>

            {status.isSet && status.preview && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-muted font-mono text-[11px] text-muted-foreground">
                <Key className="w-3 h-3 flex-shrink-0" />
                {status.preview}
              </div>
            )}

            {testResult && (
              <div className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${testResult.success ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-destructive/10 border-destructive/30 text-destructive"}`}>
                {testResult.success ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" /> : <XCircle className="w-3 h-3 flex-shrink-0" />}
                {testResult.message}
              </div>
            )}

            {!status.isSet && meta?.docsUrl && (
              <a href={meta.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                Get API key →
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
