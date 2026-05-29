import { useState, useEffect } from "react";
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
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Save, RotateCcw } from "lucide-react";

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

  if (!p || !c || !l) return <div className="p-6 text-sm text-muted-foreground">Loading configuration...</div>;

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
        </TabsList>

        <TabsContent value="persona" className="mt-4">
          <div className="bg-card border border-card-border rounded p-5 space-y-5 max-w-xl">
            <div className="space-y-1.5">
              <Label className="text-xs">Character</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {chars.map((c) => (
                  <button
                    key={c}
                    onClick={() => setP((x: any) => ({ ...x, character: c }))}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors capitalize ${p.character === c ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50"}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <SliderField label="Formality" value={p.formality} onChange={(v) => setP((x: any) => ({ ...x, formality: v }))} />
            <SliderField label="Verbosity" value={p.verbosity} onChange={(v) => setP((x: any) => ({ ...x, verbosity: v }))} />
            <SliderField label="Empathy Level" value={p.empathyLevel} onChange={(v) => setP((x: any) => ({ ...x, empathyLevel: v }))} />
            <SliderField label="Humor Level" value={p.humorLevel} onChange={(v) => setP((x: any) => ({ ...x, humorLevel: v }))} />
            <SliderField label="Speaking Rate" value={p.speakingRate} onChange={(v) => setP((x: any) => ({ ...x, speakingRate: v }))} min={0.5} max={2.0} fmt={(v) => `${v.toFixed(1)}x`} />
            <SliderField label="Pitch" value={p.pitch} onChange={(v) => setP((x: any) => ({ ...x, pitch: v }))} min={-20} max={20} step={1} fmt={(v) => `${v > 0 ? "+" : ""}${v}st`} />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Greeting Style</Label>
                <Select value={p.greetingStyle} onValueChange={(v) => setP((x: any) => ({ ...x, greetingStyle: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{greetings.map((g) => <SelectItem key={g} value={g} className="text-xs capitalize">{g}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Interrupt Mode</Label>
                <Select value={p.interruptMode} onValueChange={(v) => setP((x: any) => ({ ...x, interruptMode: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{interrupts.map((m) => <SelectItem key={m} value={m} className="text-xs">{m.replace("_", " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between py-1">
              <Label className="text-xs">Filler Words</Label>
              <Switch checked={p.fillerWordsEnabled} onCheckedChange={(v) => setP((x: any) => ({ ...x, fillerWordsEnabled: v }))} />
            </div>

            <Button size="sm" onClick={savePersona} disabled={updatePersona.isPending} className="gap-1.5 text-xs">
              <Save className="w-3 h-3" /> {updatePersona.isPending ? "Saving..." : "Save Persona"}
            </Button>
          </div>
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
      </Tabs>
    </div>
  );
}
