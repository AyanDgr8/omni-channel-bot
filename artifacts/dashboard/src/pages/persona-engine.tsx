/**
 * Agentic Persona Engine — full UI for the Persona Library tab in Configuration.
 * Drop-in replacement for the old Persona tab content.
 */
import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Zap, Edit3, RotateCcw, Copy, Trash2, CheckCircle2,
  Loader2, Sparkles, Send, ChevronLeft, Bot, ArrowRight, X,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── API error with optional Zod validation issues ───────────────────────────

export interface ValidationIssue { path: (string | number)[]; message: string; }

class ApiError extends Error {
  issues?: ValidationIssue[];
  constructor(message: string, issues?: ValidationIssue[]) {
    super(message);
    this.issues = issues;
  }
}

async function api(path: string, opts?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    throw new ApiError((e as any).error ?? r.statusText, (e as any).issues);
  }
  if (r.status === 204) return null;
  return r.json();
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface PersonaRow {
  id: string; name: string; description: string | null;
  source: "library" | "llm_generated" | "manual";
  isActive: boolean; version: number;
  hasTraits: boolean; traitsVersion: number | null; generatedByModel: string | null;
  updatedAt: string;
}

interface TraitTone { warmth: number; formality: number; energy: number; empathy: number; verbosity: number; }
interface PersonaTraits {
  identity: { role_title: string; backstory: string; goals: string[] };
  language: { jargon: string[]; greeting_phrases: string[]; closing_phrases: string[]; forbidden_phrases: string[]; sample_utterances: string[] };
  tone: TraitTone;
  voice: { suggested_gender: string; pace: string; pitch: string; deepgram_voice_hint: string };
  behavior: { interrupt_tolerance: string; silence_strategy: string; escalation_rule: string; do_rules: string[]; dont_rules: string[] };
}

interface PersonaDetail extends PersonaRow { traits: { traits: PersonaTraits; generatedByModel: string | null } | null; }

// ─── Tag Editor ──────────────────────────────────────────────────────────────

function TagEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState("");
  function add() {
    const t = input.trim();
    if (t && !values.includes(t)) { onChange([...values, t]); setInput(""); }
  }
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex flex-wrap gap-1 mb-1">
        {values.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] border border-primary/20">
            {v}
            <button onClick={() => onChange(values.filter((_, j) => j !== i))} className="hover:text-destructive transition-colors"><X className="w-2.5 h-2.5" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <Input className="text-xs h-7" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Type and press Enter" />
        <Button type="button" size="sm" variant="outline" className="text-xs h-7 px-2" onClick={add}>Add</Button>
      </div>
    </div>
  );
}

// ─── Tone Slider ─────────────────────────────────────────────────────────────

function ToneSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs font-mono text-primary">{value}/10</span>
      </div>
      <Slider min={1} max={10} step={1} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; className: string }> = {
    library: { label: "Library", className: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
    llm_generated: { label: "AI Generated", className: "bg-purple-500/10 text-purple-400 border-purple-500/30" },
    manual: { label: "Manual", className: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  };
  const m = map[source] ?? { label: source, className: "bg-muted text-muted-foreground" };
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${m.className}`}>{m.label}</span>;
}

// ─── Trait Editor ─────────────────────────────────────────────────────────────

function SectionErrors({ issues, section }: { issues: ValidationIssue[]; section: string }) {
  const relevant = issues.filter(i => String(i.path[0]) === section);
  if (!relevant.length) return null;
  return (
    <div className="space-y-1">
      {relevant.map((issue, idx) => (
        <p key={idx} className="text-xs text-destructive flex items-start gap-1">
          <span className="mt-0.5 shrink-0">⚠</span>
          <span><span className="font-medium">{issue.path.slice(1).join(" › ")}: </span>{issue.message}</span>
        </p>
      ))}
    </div>
  );
}

function TraitEditor({ traits, onChange, validationIssues = [] }: {
  traits: PersonaTraits;
  onChange: (t: PersonaTraits) => void;
  validationIssues?: ValidationIssue[];
}) {
  const t = traits;
  const set = (path: string[], value: unknown) => {
    const copy = JSON.parse(JSON.stringify(t)) as PersonaTraits;
    let node: any = copy;
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
    node[path[path.length - 1]] = value;
    onChange(copy);
  };

  return (
    <div className="space-y-6">
      {/* IDENTITY */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Identity</h3>
        <SectionErrors issues={validationIssues} section="identity" />
        <div className="space-y-1"><Label className="text-xs">Role Title</Label><Input className="text-xs h-8" value={t.identity.role_title} onChange={e => set(["identity", "role_title"], e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Backstory</Label><Textarea className="text-xs min-h-20" value={t.identity.backstory} onChange={e => set(["identity", "backstory"], e.target.value)} /></div>
        <TagEditor label="Goals" values={t.identity.goals} onChange={v => set(["identity", "goals"], v)} />
      </div>

      {/* LANGUAGE */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Language</h3>
        <SectionErrors issues={validationIssues} section="language" />
        <TagEditor label="Domain Jargon" values={t.language.jargon} onChange={v => set(["language", "jargon"], v)} />
        <TagEditor label="Greeting Phrases" values={t.language.greeting_phrases} onChange={v => set(["language", "greeting_phrases"], v)} />
        <TagEditor label="Closing Phrases" values={t.language.closing_phrases} onChange={v => set(["language", "closing_phrases"], v)} />
        <TagEditor label="Forbidden Phrases" values={t.language.forbidden_phrases} onChange={v => set(["language", "forbidden_phrases"], v)} />
        <TagEditor label="Sample Utterances" values={t.language.sample_utterances} onChange={v => set(["language", "sample_utterances"], v)} />
      </div>

      {/* TONE */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tone (1–10)</h3>
        <SectionErrors issues={validationIssues} section="tone" />
        {(["warmth", "formality", "energy", "empathy", "verbosity"] as const).map(k => (
          <ToneSlider key={k} label={k.charAt(0).toUpperCase() + k.slice(1)} value={t.tone[k]} onChange={v => set(["tone", k], v)} />
        ))}
      </div>

      {/* VOICE */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Voice</h3>
        <SectionErrors issues={validationIssues} section="voice" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs">Pace</Label>
            <Select value={t.voice.pace} onValueChange={v => set(["voice", "pace"], v)}>
              <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{["slow", "moderate", "fast"].map(p => <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Pitch</Label>
            <Select value={t.voice.pitch} onValueChange={v => set(["voice", "pitch"], v)}>
              <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{["low", "medium", "high"].map(p => <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1"><Label className="text-xs">Deepgram Voice Hint</Label><Input className="text-xs h-8" value={t.voice.deepgram_voice_hint} onChange={e => set(["voice", "deepgram_voice_hint"], e.target.value)} placeholder="e.g. aura-asteria-en" /></div>
        <div className="space-y-1"><Label className="text-xs">Suggested Gender</Label><Input className="text-xs h-8" value={t.voice.suggested_gender} onChange={e => set(["voice", "suggested_gender"], e.target.value)} /></div>
      </div>

      {/* BEHAVIOR */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Behavior</h3>
        <SectionErrors issues={validationIssues} section="behavior" />
        <div className="space-y-1"><Label className="text-xs">Interrupt Tolerance</Label>
          <Select value={t.behavior.interrupt_tolerance} onValueChange={v => set(["behavior", "interrupt_tolerance"], v)}>
            <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{["low", "medium", "high"].map(p => <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">Silence Strategy</Label><Input className="text-xs h-8" value={t.behavior.silence_strategy} onChange={e => set(["behavior", "silence_strategy"], e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Escalation Rule</Label><Textarea className="text-xs min-h-16" value={t.behavior.escalation_rule} onChange={e => set(["behavior", "escalation_rule"], e.target.value)} /></div>
        <TagEditor label="Do Rules" values={t.behavior.do_rules} onChange={v => set(["behavior", "do_rules"], v)} />
        <TagEditor label="Don't Rules" values={t.behavior.dont_rules} onChange={v => set(["behavior", "dont_rules"], v)} />
      </div>
    </div>
  );
}

// ─── Refine with AI ───────────────────────────────────────────────────────────

function RefinePanel({ personaId, currentTraits, onAccept, onClose }: {
  personaId: string; currentTraits: PersonaTraits;
  onAccept: (t: PersonaTraits) => void; onClose: () => void;
}) {
  const { toast } = useToast();
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<{ before: PersonaTraits; after: PersonaTraits; model: string } | null>(null);

  const refine = useMutation({
    mutationFn: () => api(`/api/v1/personas/${personaId}/refine`, { method: "POST", body: JSON.stringify({ instruction }) }),
    onSuccess: (d: any) => setResult(d),
    onError: (e: Error) => toast({ title: "Refinement failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs">Refinement instruction</Label>
        <Textarea className="text-xs min-h-20" placeholder='e.g. "Make her warmer and less formal. Add spa-related jargon."' value={instruction} onChange={e => setInstruction(e.target.value)} />
        <Button size="sm" className="text-xs h-8" onClick={() => refine.mutate()} disabled={refine.isPending || !instruction.trim()}>
          {refine.isPending ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Refining...</> : <><Sparkles className="w-3 h-3 mr-1" />Refine with AI</>}
        </Button>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">Generated by <span className="font-medium text-foreground">{result.model}</span> — review before applying</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Before</div>
              <div className="rounded-lg bg-black/20 p-2 text-xs space-y-1">
                {(["warmth", "formality", "energy", "empathy", "verbosity"] as const).map(k => (
                  <div key={k} className="flex justify-between"><span className="capitalize">{k}</span><span>{result.before.tone[k]}/10</span></div>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-primary uppercase">After</div>
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs space-y-1">
                {(["warmth", "formality", "energy", "empathy", "verbosity"] as const).map(k => {
                  const changed = result.before.tone[k] !== result.after.tone[k];
                  return (
                    <div key={k} className={`flex justify-between ${changed ? "text-primary font-medium" : ""}`}>
                      <span className="capitalize">{k}</span>
                      <span>{changed ? `${result.before.tone[k]} → ${result.after.tone[k]}` : `${result.after.tone[k]}/10`}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="text-xs h-8" onClick={() => { onAccept(result.after); onClose(); }}>
              <CheckCircle2 className="w-3 h-3 mr-1" /> Apply Changes
            </Button>
            <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setResult(null)}>Discard</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Test Persona ─────────────────────────────────────────────────────────────

function TestPanel({ personaId }: { personaId: string }) {
  const { toast } = useToast();
  const STARTERS = [
    "Hello, I need some help.",
    "I have a complaint I'd like to raise.",
    "Can you check my account status?",
    "What services do you offer?",
  ];
  const [messages, setMessages] = useState<{ role: "user" | "bot"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function send(text: string) {
    if (!text.trim()) return;
    setMessages(m => [...m, { role: "user", text }]);
    setInput("");
    setLoading(true);
    try {
      const data = await api(`/api/v1/personas/${personaId}/test`, { method: "POST", body: JSON.stringify({ message: text }) }) as { reply: string; engine: string };
      setMessages(m => [...m, { role: "bot", text: data.reply }]);
    } catch (e: any) {
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">Send a few messages to feel how this persona responds. Quick starters:</div>
      <div className="flex flex-wrap gap-1">
        {STARTERS.map(s => (
          <button key={s} onClick={() => send(s)} className="text-[11px] px-2 py-1 rounded border border-border hover:border-primary/50 hover:text-primary transition-colors">{s}</button>
        ))}
      </div>
      <div className="min-h-40 max-h-64 overflow-y-auto space-y-2 rounded-lg bg-black/20 p-3">
        {messages.length === 0 && <div className="text-xs text-muted-foreground text-center py-6">Start the conversation above</div>}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="panel flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Responding...
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Input className="text-xs h-8 flex-1" placeholder="Type a message..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(input); }} />
        <Button size="sm" className="text-xs h-8" onClick={() => send(input)} disabled={!input.trim() || loading}>
          <Send className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// ─── New Persona Modal ────────────────────────────────────────────────────────

function NewPersonaModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const create = useMutation({
    mutationFn: () => api("/api/v1/personas", { method: "POST", body: JSON.stringify({ name: name.trim(), description: desc.trim() || undefined }) }),
    onSuccess: () => { toast({ title: "Persona created" }); setName(""); setDesc(""); onCreated(); onClose(); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !create.isPending) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">New Persona</DialogTitle>
          <DialogDescription className="text-xs">Enter a persona name and the AI will generate a complete trait profile automatically.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <Label className="text-xs">Persona Name <span className="text-destructive">*</span></Label>
            <Input className="text-xs h-8" placeholder='e.g. Hotel Receptionist, Insurance Claims Agent' value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description (optional)</Label>
            <Textarea className="text-xs min-h-16" placeholder="Any context that helps the AI generate better traits..." value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <Button className="w-full text-xs h-9" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
            {create.isPending ? (
              <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Researching persona traits...</>
            ) : (
              <><Zap className="w-3 h-3 mr-2" />Generate Traits</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Detail View ──────────────────────────────────────────────────────────────

function PersonaDetailView({ persona, onBack, onRefresh }: {
  persona: PersonaRow; onBack: () => void; onRefresh: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: detail, isLoading } = useQuery<PersonaDetail>({
    queryKey: ["persona-detail", persona.id],
    queryFn: () => api(`/api/v1/personas/${persona.id}`),
  });

  const [editedTraits, setEditedTraits] = useState<PersonaTraits | null>(null);
  const [activeSection, setActiveSection] = useState<"edit" | "refine" | "test">("edit");
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);

  const currentTraits = editedTraits ?? detail?.traits?.traits ?? null;
  const isDirty = editedTraits !== null;

  // Task #12: warn before losing unsaved changes via browser tab/window close
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  function confirmLoseChanges(): boolean {
    if (!isDirty) return true;
    return window.confirm("You have unsaved trait edits. Leave without saving?");
  }

  // Clear validation issues when the user edits traits (so they know their change was registered)
  function handleTraitsChange(t: PersonaTraits) {
    setEditedTraits(t);
    if (validationIssues.length) setValidationIssues([]);
  }

  const activate = useMutation({
    mutationFn: () => api(`/api/v1/personas/${persona.id}/activate`, { method: "POST" }),
    onSuccess: () => { toast({ title: `${persona.name} activated` }); qc.invalidateQueries({ queryKey: ["personas"] }); onRefresh(); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const regenerate = useMutation({
    mutationFn: () => api(`/api/v1/personas/${persona.id}/regenerate`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Traits regenerated" }); qc.invalidateQueries({ queryKey: ["persona-detail", persona.id] }); setEditedTraits(null); setValidationIssues([]); },
    onError: (e: Error) => toast({ title: "Regeneration failed", description: e.message, variant: "destructive" }),
  });

  const saveTraits = useMutation({
    mutationFn: () => api(`/api/v1/personas/${persona.id}/traits`, { method: "PUT", body: JSON.stringify(editedTraits) }),
    onSuccess: () => {
      toast({ title: "Traits saved" });
      qc.invalidateQueries({ queryKey: ["persona-detail", persona.id] });
      qc.invalidateQueries({ queryKey: ["personas"] });
      setEditedTraits(null);
      setValidationIssues([]);
    },
    onError: (e: Error) => {
      const issues = (e as ApiError).issues;
      if (issues?.length) {
        setValidationIssues(issues);
        setActiveSection("edit");
        toast({ title: "Validation failed", description: "Fix the highlighted fields and try again.", variant: "destructive" });
      } else {
        toast({ title: "Save failed", description: e.message, variant: "destructive" });
      }
    },
  });

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => { if (confirmLoseChanges()) onBack(); }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">{persona.name}</h2>
              <SourceBadge source={persona.source} />
              {persona.isActive && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">Active</span>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">v{persona.version}{detail?.traits?.generatedByModel ? ` · ${detail.traits.generatedByModel}` : ""}</p>
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0 flex-wrap justify-end">
          {!persona.isActive && (
            <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => activate.mutate()} disabled={activate.isPending}>
              {activate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}Activate
            </Button>
          )}
          <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
            {regenerate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3 mr-1" />}Regenerate
          </Button>
          {editedTraits && (
            <Button size="sm" className="text-xs h-7 px-2" onClick={() => saveTraits.mutate()} disabled={saveTraits.isPending}>
              {saveTraits.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}Save Traits
            </Button>
          )}
        </div>
      </div>

      {/* Section tabs — guard against losing unsaved changes (task #12) */}
      <div className="flex gap-1">
        {(["edit", "refine", "test"] as const).map(s => (
          <button key={s}
            onClick={() => {
              if (s !== "edit" && isDirty) {
                if (!confirmLoseChanges()) return;
                setEditedTraits(null);
                setValidationIssues([]);
              }
              setActiveSection(s);
            }}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors capitalize ${activeSection === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {s === "refine" ? "Refine with AI" : s === "test" ? "Test Persona" : "Edit Traits"}
            {s === "edit" && isDirty && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 align-middle" />}
          </button>
        ))}
      </div>

      {activeSection === "edit" && currentTraits && (
        <div className="panel p-4 max-w-2xl">
          <TraitEditor traits={currentTraits} onChange={handleTraitsChange} validationIssues={validationIssues} />
          {(editedTraits || validationIssues.length > 0) && (
            <div className="pt-4 border-t border-border mt-4 space-y-2">
              {validationIssues.length > 0 && (
                <p className="text-xs text-destructive">Fix the errors above before saving.</p>
              )}
              <Button size="sm" className="text-xs h-8" onClick={() => saveTraits.mutate()} disabled={saveTraits.isPending || !editedTraits}>
                {saveTraits.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}Save Changes
              </Button>
            </div>
          )}
        </div>
      )}

      {activeSection === "refine" && currentTraits && (
        <div className="panel p-4 max-w-xl">
          <RefinePanel
            personaId={persona.id}
            currentTraits={currentTraits}
            onAccept={t => { setEditedTraits(t); setActiveSection("edit"); }}
            onClose={() => {}}
          />
        </div>
      )}

      {activeSection === "test" && (
        <div className="panel p-4 max-w-xl">
          <TestPanel personaId={persona.id} />
        </div>
      )}
    </div>
  );
}

// ─── Persona Library (main view) ──────────────────────────────────────────────

export default function PersonaEngine() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<PersonaRow | null>(null);

  const { data: personas = [], isLoading, refetch } = useQuery<PersonaRow[]>({
    queryKey: ["personas"],
    queryFn: () => api("/api/v1/personas"),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api(`/api/v1/personas/${id}/duplicate`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Persona duplicated" }); qc.invalidateQueries({ queryKey: ["personas"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/personas/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Persona deleted" }); qc.invalidateQueries({ queryKey: ["personas"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const activate = useMutation({
    mutationFn: (id: string) => api(`/api/v1/personas/${id}/activate`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Persona activated" }); qc.invalidateQueries({ queryKey: ["personas"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (selected) {
    return (
      <PersonaDetailView
        persona={selected}
        onBack={() => setSelected(null)}
        onRefresh={() => { refetch(); setSelected(null); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Persona Library</h2>
          <p className="mt-1 text-sm text-muted-foreground">AI-powered persona profiles that guide your voice bot's behaviour</p>
        </div>
        <Button size="sm" className="text-xs h-8 gap-1" onClick={() => setNewOpen(true)}>
          <Plus className="w-3 h-3" /> New Persona
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-8"><Loader2 className="w-4 h-4 animate-spin" />Loading personas...</div>
      )}

      {!isLoading && personas.length === 0 && (
        <div className="empty-state">
          <Bot className="empty-state-icon" />
          <p className="text-sm text-muted-foreground">No personas yet</p>
          <p className="-mt-2 max-w-xs text-xs text-muted-foreground">Create one or wait for the library personas to load</p>
          <Button size="sm" className="text-xs h-8" onClick={() => setNewOpen(true)}><Plus className="w-3 h-3 mr-1" />Create First Persona</Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {personas.map(p => (
          <div key={p.id} className={`bg-card border rounded-lg p-4 space-y-3 transition-colors ${p.isActive ? "border-primary/50 bg-primary/3" : "border-border"}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium">{p.name}</span>
                  <SourceBadge source={p.source} />
                  {p.isActive && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">Active</span>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">v{p.version}{p.generatedByModel ? ` · ${p.generatedByModel}` : ""}</p>
              </div>
            </div>

            {p.description && <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>}

            <div className="flex gap-1.5 flex-wrap">
              {!p.isActive && (
                <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => activate.mutate(p.id)} disabled={activate.isPending}>
                  <CheckCircle2 className="w-3 h-3 mr-1" />Activate
                </Button>
              )}
              <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => setSelected(p)}>
                <Edit3 className="w-3 h-3 mr-1" />Edit
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => duplicate.mutate(p.id)} disabled={duplicate.isPending}>
                <Copy className="w-3 h-3 mr-1" />Duplicate
              </Button>
              <Button size="sm" variant="ghost" className="text-xs h-7 px-2 text-destructive hover:text-destructive" onClick={() => remove.mutate(p.id)} disabled={remove.isPending}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <NewPersonaModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["personas"] })} />
    </div>
  );
}
