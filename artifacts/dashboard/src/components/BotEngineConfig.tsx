/**
 * Bot Engine Config panel — LLM chain, STT map, TTS map editors.
 * Used as a tab inside the bot edit dialog.
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LlmChainEntry {
  provider_id: string;
  model_id: string;
  temperature?: number;
  max_tokens?: number;
}

export interface SttMapEntry {
  provider_id: string;
  model_id: string;
}

export interface TtsMapEntry {
  provider_id: string;
  model_id: string;
  voice?: string;
}

export interface EngineConfig {
  llmChain: LlmChainEntry[];
  sttMap: Record<string, SttMapEntry>;
  ttsMap: Record<string, TtsMapEntry>;
}

interface Provider {
  id: string;
  kind: "LLM" | "STT" | "TTS";
  vendor: string;
  displayName: string;
  enabled: boolean;
  isPlatformPooled: boolean;
}

interface ModelEntry {
  id: string;
  vendor: string;
  kind: "LLM" | "STT" | "TTS";
  modelId: string;
  displayName: string;
  deprecated: boolean;
}

export interface BotEngineConfigProps {
  /** Bot ID — used to fetch the full bot record including engine JSON via GET /v1/bots/:id */
  botId: string;
  /** Which languages are supported by this bot */
  supportedLanguages: string[];
  /** Called when operator clicks Save — passes the updated engine config */
  onSave: (cfg: EngineConfig) => void;
  saving: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchProviders(): Promise<Provider[]> {
  const r = await fetch(`${BASE}/api/v1/providers`, { credentials: "include" });
  if (!r.ok) return [];
  return r.json();
}

async function fetchCatalog(): Promise<ModelEntry[]> {
  const r = await fetch(`${BASE}/api/v1/model-catalog`, { credentials: "include" });
  if (!r.ok) return [];
  return r.json();
}

function parseChain(raw: unknown): LlmChainEntry[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(
    (e): e is LlmChainEntry =>
      typeof e === "object" && e !== null &&
      typeof (e as LlmChainEntry).provider_id === "string" &&
      typeof (e as LlmChainEntry).model_id === "string"
  );
}

function parseMap<T extends object>(raw: unknown): Record<string, T> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, T>;
}

const LANG_LABELS: Record<string, string> = {
  en: "English", hi: "Hindi", ar: "Arabic", fr: "French",
  es: "Spanish", de: "German", zh: "Chinese", pt: "Portuguese",
  ru: "Russian", ja: "Japanese", ko: "Korean",
};

// ─── LLM Chain editor ─────────────────────────────────────────────────────────

function LlmChainEditor({
  chain, onChange, providers, catalog,
}: {
  chain: LlmChainEntry[];
  onChange: (c: LlmChainEntry[]) => void;
  providers: Provider[];
  catalog: ModelEntry[];
}) {
  const llmProviders = providers.filter((p) => p.kind === "LLM" && p.enabled);

  function addRow() {
    onChange([...chain, { provider_id: "", model_id: "" }]);
  }

  function removeRow(idx: number) {
    onChange(chain.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, patch: Partial<LlmChainEntry>) {
    onChange(chain.map((row, i) => i === idx ? { ...row, ...patch } : row));
  }

  function modelsForProvider(providerId: string) {
    const p = providers.find((x) => x.id === providerId);
    if (!p) return [];
    return catalog.filter((m) => m.kind === "LLM" && m.vendor === p.vendor && !m.deprecated);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          LLM Fallback Chain
        </p>
        <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={addRow}>
          <Plus className="w-3 h-3" /> Add
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">Entries are tried in order. If the first fails, the next is used.</p>

      {chain.length === 0 && (
        <div className="text-[11px] text-muted-foreground border border-dashed border-border rounded p-3 text-center">
          No LLM chain configured — default tenant llm_config will be used.
        </div>
      )}

      {chain.map((row, idx) => (
        <div key={idx} className="flex items-start gap-2 bg-muted/30 border border-border rounded p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono w-5 pt-2 flex-shrink-0">
            {idx + 1}
          </div>
          <div className="flex-1 grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Provider</Label>
              <Select
                value={row.provider_id}
                onValueChange={(v) => updateRow(idx, { provider_id: v, model_id: "" })}
              >
                <SelectTrigger className="mt-0.5 text-xs h-7"><SelectValue placeholder="Select provider" /></SelectTrigger>
                <SelectContent>
                  {llmProviders.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.displayName} {p.isPlatformPooled ? "(pool)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Model</Label>
              <Select
                value={row.model_id}
                onValueChange={(v) => updateRow(idx, { model_id: v })}
                disabled={!row.provider_id}
              >
                <SelectTrigger className="mt-0.5 text-xs h-7"><SelectValue placeholder="Select model" /></SelectTrigger>
                <SelectContent>
                  {modelsForProvider(row.provider_id).map((m) => (
                    <SelectItem key={m.id} value={m.modelId} className="text-xs">{m.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Temperature (0–2)</Label>
              <Input
                className="mt-0.5 text-xs h-7"
                type="number" min={0} max={2} step={0.1}
                placeholder="0.7"
                value={row.temperature ?? ""}
                onChange={(e) => updateRow(idx, { temperature: e.target.value ? +e.target.value : undefined })}
              />
            </div>
            <div>
              <Label className="text-[10px]">Max Tokens</Label>
              <Input
                className="mt-0.5 text-xs h-7"
                type="number" min={1}
                placeholder="1024"
                value={row.max_tokens ?? ""}
                onChange={(e) => updateRow(idx, { max_tokens: e.target.value ? +e.target.value : undefined })}
              />
            </div>
          </div>
          <Button
            size="sm" variant="ghost"
            className="h-7 px-2 text-destructive hover:text-destructive mt-4 flex-shrink-0"
            onClick={() => removeRow(idx)}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ─── STT Map editor ───────────────────────────────────────────────────────────

function SttMapEditor({
  sttMap, onChange, providers, catalog, languages,
}: {
  sttMap: Record<string, SttMapEntry>;
  onChange: (m: Record<string, SttMapEntry>) => void;
  providers: Provider[];
  catalog: ModelEntry[];
  languages: string[];
}) {
  const sttProviders = providers.filter((p) => p.kind === "STT" && p.enabled);

  function updateEntry(lang: string, patch: Partial<SttMapEntry>) {
    onChange({ ...sttMap, [lang]: { ...sttMap[lang], ...patch } });
  }

  function removeEntry(lang: string) {
    const { [lang]: _, ...rest } = sttMap;
    onChange(rest);
  }

  function addLanguage(lang: string) {
    onChange({ ...sttMap, [lang]: { provider_id: "", model_id: "" } });
  }

  function modelsForProvider(providerId: string) {
    const p = providers.find((x) => x.id === providerId);
    if (!p) return [];
    return catalog.filter((m) => m.kind === "STT" && m.vendor === p.vendor && !m.deprecated);
  }

  const configured = Object.keys(sttMap);
  const available = languages.filter((l) => !configured.includes(l));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">STT Map</p>
        {available.length > 0 && (
          <Select onValueChange={addLanguage} value="">
            <SelectTrigger className="h-7 w-auto text-xs gap-1 border-dashed">
              <Plus className="w-3 h-3" /> Add language
            </SelectTrigger>
            <SelectContent>
              {available.map((l) => (
                <SelectItem key={l} value={l} className="text-xs">{LANG_LABELS[l] ?? l.toUpperCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">Override the STT provider per language. Languages not listed use the default.</p>

      {configured.length === 0 && (
        <div className="text-[11px] text-muted-foreground border border-dashed border-border rounded p-3 text-center">
          No STT overrides — default provider used for all languages.
        </div>
      )}

      {configured.map((lang) => {
        const entry = sttMap[lang];
        return (
          <div key={lang} className="flex items-start gap-2 bg-muted/30 border border-border rounded p-2.5">
            <div className="text-[10px] font-semibold text-foreground uppercase pt-2 w-8 flex-shrink-0">
              {lang}
            </div>
            <div className="flex-1 grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">Provider</Label>
                <Select
                  value={entry.provider_id}
                  onValueChange={(v) => updateEntry(lang, { provider_id: v, model_id: "" })}
                >
                  <SelectTrigger className="mt-0.5 text-xs h-7"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {sttProviders.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">{p.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Model</Label>
                <Select
                  value={entry.model_id}
                  onValueChange={(v) => updateEntry(lang, { model_id: v })}
                  disabled={!entry.provider_id}
                >
                  <SelectTrigger className="mt-0.5 text-xs h-7"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {modelsForProvider(entry.provider_id).map((m) => (
                      <SelectItem key={m.id} value={m.modelId} className="text-xs">{m.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              size="sm" variant="ghost"
              className="h-7 px-2 text-destructive hover:text-destructive mt-4 flex-shrink-0"
              onClick={() => removeEntry(lang)}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

// ─── TTS Map editor ───────────────────────────────────────────────────────────

function TtsMapEditor({
  ttsMap, onChange, providers, catalog, languages,
}: {
  ttsMap: Record<string, TtsMapEntry>;
  onChange: (m: Record<string, TtsMapEntry>) => void;
  providers: Provider[];
  catalog: ModelEntry[];
  languages: string[];
}) {
  const ttsProviders = providers.filter((p) => p.kind === "TTS" && p.enabled);

  function updateEntry(lang: string, patch: Partial<TtsMapEntry>) {
    onChange({ ...ttsMap, [lang]: { ...ttsMap[lang], ...patch } });
  }

  function removeEntry(lang: string) {
    const { [lang]: _, ...rest } = ttsMap;
    onChange(rest);
  }

  function addLanguage(lang: string) {
    onChange({ ...ttsMap, [lang]: { provider_id: "", model_id: "" } });
  }

  function modelsForProvider(providerId: string) {
    const p = providers.find((x) => x.id === providerId);
    if (!p) return [];
    return catalog.filter((m) => m.kind === "TTS" && m.vendor === p.vendor && !m.deprecated);
  }

  const configured = Object.keys(ttsMap);
  const available = languages.filter((l) => !configured.includes(l));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">TTS Map</p>
        {available.length > 0 && (
          <Select onValueChange={addLanguage} value="">
            <SelectTrigger className="h-7 w-auto text-xs gap-1 border-dashed">
              <Plus className="w-3 h-3" /> Add language
            </SelectTrigger>
            <SelectContent>
              {available.map((l) => (
                <SelectItem key={l} value={l} className="text-xs">{LANG_LABELS[l] ?? l.toUpperCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">Override the TTS provider per language. Languages not listed use the default.</p>

      {configured.length === 0 && (
        <div className="text-[11px] text-muted-foreground border border-dashed border-border rounded p-3 text-center">
          No TTS overrides — default provider used for all languages.
        </div>
      )}

      {configured.map((lang) => {
        const entry = ttsMap[lang];
        return (
          <div key={lang} className="flex items-start gap-2 bg-muted/30 border border-border rounded p-2.5">
            <div className="text-[10px] font-semibold text-foreground uppercase pt-2 w-8 flex-shrink-0">
              {lang}
            </div>
            <div className="flex-1 grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">Provider</Label>
                <Select
                  value={entry.provider_id}
                  onValueChange={(v) => updateEntry(lang, { provider_id: v, model_id: "" })}
                >
                  <SelectTrigger className="mt-0.5 text-xs h-7"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {ttsProviders.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">{p.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Model / Voice</Label>
                <Select
                  value={entry.model_id}
                  onValueChange={(v) => updateEntry(lang, { model_id: v })}
                  disabled={!entry.provider_id}
                >
                  <SelectTrigger className="mt-0.5 text-xs h-7"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {modelsForProvider(entry.provider_id).map((m) => (
                      <SelectItem key={m.id} value={m.modelId} className="text-xs">{m.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-[10px]">Voice override (optional)</Label>
                <Input
                  className="mt-0.5 text-xs h-7"
                  placeholder="e.g. aura-asteria-en"
                  value={entry.voice ?? ""}
                  onChange={(e) => updateEntry(lang, { voice: e.target.value || undefined })}
                />
              </div>
            </div>
            <Button
              size="sm" variant="ghost"
              className="h-7 px-2 text-destructive hover:text-destructive mt-4 flex-shrink-0"
              onClick={() => removeEntry(lang)}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Fetch full bot record (includes engine JSON not present in list response) ──

interface BotDetail {
  llmChainJson?: unknown;
  sttMapJson?: unknown;
  ttsMapJson?: unknown;
  [k: string]: unknown;
}

async function fetchBot(botId: string): Promise<BotDetail> {
  const r = await fetch(`${BASE}/api/v1/bots/${botId}`, { credentials: "include" });
  if (!r.ok) throw new Error(`Failed to load bot: HTTP ${r.status}`);
  return r.json();
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BotEngineConfig({
  botId, supportedLanguages, onSave, saving,
}: BotEngineConfigProps) {
  const { data: providers = [], isLoading: loadingProviders } = useQuery({
    queryKey: ["/api/v1/providers"],
    queryFn: fetchProviders,
    staleTime: 60_000,
  });

  const { data: catalog = [], isLoading: loadingCatalog } = useQuery({
    queryKey: ["/api/v1/model-catalog"],
    queryFn: fetchCatalog,
    staleTime: 120_000,
  });

  // Fetch the full bot detail to get engine JSON (not present in list response)
  const { data: botDetail, isLoading: loadingBot } = useQuery({
    queryKey: ["/api/v1/bots", botId],
    queryFn: () => fetchBot(botId),
    staleTime: 30_000,
    enabled: !!botId,
  });

  const [llmChain, setLlmChain] = useState<LlmChainEntry[]>([]);
  const [sttMap, setSttMap] = useState<Record<string, SttMapEntry>>({});
  const [ttsMap, setTtsMap] = useState<Record<string, TtsMapEntry>>({});

  // Initialize editors from fetched bot detail
  useEffect(() => {
    if (botDetail) {
      setLlmChain(parseChain(botDetail.llmChainJson));
      setSttMap(parseMap<SttMapEntry>(botDetail.sttMapJson));
      setTtsMap(parseMap<TtsMapEntry>(botDetail.ttsMapJson));
    }
  }, [botDetail]);

  const isLoading = loadingProviders || loadingCatalog || loadingBot;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading providers…
      </div>
    );
  }

  const noProviders = providers.length === 0;

  return (
    <div className="space-y-6 pt-2">
      {noProviders && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 text-[11px] text-amber-600 leading-relaxed">
          No providers are configured yet. Go to <strong>Providers</strong> in the sidebar to add API keys before configuring the engine.
        </div>
      )}

      <LlmChainEditor
        chain={llmChain}
        onChange={setLlmChain}
        providers={providers}
        catalog={catalog}
      />

      <SttMapEditor
        sttMap={sttMap}
        onChange={setSttMap}
        providers={providers}
        catalog={catalog}
        languages={supportedLanguages}
      />

      <TtsMapEditor
        ttsMap={ttsMap}
        onChange={setTtsMap}
        providers={providers}
        catalog={catalog}
        languages={supportedLanguages}
      />

      <div className="flex justify-end pt-2 border-t border-border">
        <Button
          size="sm"
          className="text-xs gap-1.5"
          disabled={saving}
          onClick={() => onSave({ llmChain, sttMap, ttsMap })}
        >
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          Save Engine Config
        </Button>
      </div>
    </div>
  );
}
