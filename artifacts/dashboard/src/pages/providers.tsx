/**
 * Providers page — manage per-tenant BYO API keys and platform-pooled providers.
 * Route: /providers  (ADMIN+)
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Play, RefreshCw, CheckCircle2, XCircle, Loader2,
  Key, Globe, Cpu, Mic, Volume2, ChevronDown, ChevronUp, Gauge, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface Provider {
  id: string;
  tenantId: string | null;
  kind: "LLM" | "STT" | "TTS";
  vendor: string;
  displayName: string;
  baseUrl: string | null;
  authMode: "bearer" | "api-key" | "none";
  enabled: boolean;
  keyIsSet: boolean;
  keyPreview: string | null;
  isPlatformPooled: boolean;
  isEnvironmentConfigured: boolean;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; requestCount: number };
  rateLimit: ProviderRateLimit | null;
  createdAt: string | null;
  // Circuit-breaker health, surfaced by the provider registry.
  circuitState: "closed" | "open" | "half-open";
  circuitFailureCount: number;
  circuitRecoveryAt: string | null;
}

interface ProviderRateLimit {
  requestLimit?: number;
  requestRemaining?: number;
  tokenLimit?: number;
  tokenRemaining?: number;
  requestReset?: string;
  tokenReset?: string;
  capturedAt: string;
}

interface ModelCatalogEntry {
  id: string;
  vendor: string;
  kind: "LLM" | "STT" | "TTS";
  modelId: string;
  displayName: string;
  deprecated: boolean;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchProviders(): Promise<Provider[]> {
  const r = await fetch(`${BASE}/api/v1/providers`, { credentials: "include" });
  if (!r.ok) throw new Error("Failed to load providers");
  return r.json();
}

async function fetchCatalog(): Promise<ModelCatalogEntry[]> {
  const r = await fetch(`${BASE}/api/v1/model-catalog`, { credentials: "include" });
  if (!r.ok) throw new Error("Failed to load model catalog");
  return r.json();
}

// ─── Kind config ──────────────────────────────────────────────────────────────

const KIND_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  LLM: { label: "Language Models", icon: Cpu, color: "text-primary" },
  STT: { label: "Speech-to-Text", icon: Mic, color: "text-accent" },
  TTS: { label: "Text-to-Speech", icon: Volume2, color: "text-yellow-400" },
};

const VENDOR_COLORS: Record<string, string> = {
  openai: "bg-emerald-500/15 text-emerald-600",
  anthropic: "bg-amber-500/15 text-amber-600",
  google: "bg-blue-500/15 text-blue-600",
  "google-gemini": "bg-blue-500/15 text-blue-600",
  deepgram: "bg-violet-500/15 text-violet-600",
  elevenlabs: "bg-pink-500/15 text-pink-600",
  azure: "bg-sky-500/15 text-sky-600",
  ollama: "bg-zinc-500/15 text-zinc-500",
  cohere: "bg-orange-500/15 text-orange-600",
  mistral: "bg-indigo-500/15 text-indigo-600",
};

function VendorBadge({ vendor }: { vendor: string }) {
  const cls = VENDOR_COLORS[vendor.toLowerCase()] ?? "bg-zinc-500/15 text-zinc-500";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {vendor}
    </span>
  );
}

function formatTokens(value: number) {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatRemainingTokens(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 1_000 ? "compact" : "standard",
    minimumFractionDigits: value >= 1_000 ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(value);
}

const HEALTH_META = {
  healthy: {
    label: "Healthy",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
    dotClassName: "bg-emerald-500",
  },
  degraded: {
    label: "Degraded",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-500",
    dotClassName: "bg-amber-500",
  },
  circuit_open: {
    label: "Circuit open",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    dotClassName: "bg-destructive",
  },
} as const;

function HealthBadge({ provider }: { provider: Provider }) {
  const [open, setOpen] = useState(false);
  const health =
    provider.circuitState === "open"
      ? "circuit_open"
      : provider.circuitState === "half-open" || provider.circuitFailureCount > 0
        ? "degraded"
        : "healthy";
  const meta = HEALTH_META[health];
  const recovery = provider.circuitRecoveryAt
    ? new Date(provider.circuitRecoveryAt)
    : null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${provider.displayName} health: ${meta.label}`}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[10px] font-semibold transition-colors hover:brightness-110 ${meta.className}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClassName}`} />
        {meta.label}
        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-56 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Activity className="h-3.5 w-3.5" />
            Provider health
          </div>
          <dl className="mt-2 space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Recent failures</dt>
              <dd className="font-medium tabular-nums">{provider.circuitFailureCount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Recovery</dt>
              <dd className="text-right font-medium">
                {recovery
                  ? recovery.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                  : health === "degraded"
                    ? "Trial ready"
                    : "Ready"}
              </dd>
            </div>
          </dl>
          <p className="mt-2 border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">
            {health === "circuit_open"
              ? "Calls are using fallback providers until a recovery trial is allowed."
              : health === "degraded"
                ? "Recent failures detected; calls can still attempt this provider."
                : "No recent provider failures in this server process."}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Provider card ────────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: Provider;
  onEdit: (p: Provider) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  testing: boolean;
  testResult?: { success: boolean; latencyMs?: number; error?: string };
}

function ProviderCard({ provider: p, onEdit, onDelete, onTest, onToggle, testing, testResult }: ProviderCardProps) {
  return (
    <div className={`bg-card border rounded p-4 space-y-3 ${p.isPlatformPooled ? "border-primary/20" : "border-card-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-foreground">{p.displayName}</p>
              <VendorBadge vendor={p.vendor} />
              {p.isEnvironmentConfigured ? (
                <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-sky-500/40 text-sky-400">
                  Environment
                </Badge>
              ) : p.isPlatformPooled && (
                <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-primary/40 text-primary">
                  Platform Pool
                </Badge>
              )}
              {!p.enabled && (
                <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-muted-foreground">
                  Disabled
                </Badge>
              )}
              <HealthBadge provider={p} />
            </div>
            {p.baseUrl && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                <Globe className="w-2.5 h-2.5 flex-shrink-0" />
                <span className="truncate">{p.baseUrl}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Key status */}
          {p.keyIsSet ? (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <CheckCircle2 className="w-2.5 h-2.5" /> Key set
            </span>
          ) : p.authMode !== "none" ? (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-white/[0.07] bg-white/[0.04] text-[10px] font-medium text-muted-foreground">
              <XCircle className="w-2.5 h-2.5" /> No key
            </span>
          ) : null}

          {/* Enabled toggle — tenant-owned only */}
          {!p.isPlatformPooled && (
            <Switch
              checked={p.enabled}
              onCheckedChange={(v) => onToggle(p.id, v)}
              className="scale-75"
            />
          )}

          {/* Test button — tenant-owned only */}
          {!p.isPlatformPooled && (
            <Button
              size="sm" variant="outline"
              className="text-xs h-7 px-2.5 gap-1"
              disabled={testing || (!p.keyIsSet && p.authMode !== "none")}
              onClick={() => onTest(p.id)}
            >
              {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Test
            </Button>
          )}

          {/* Edit / Delete — tenant-owned only */}
          {!p.isPlatformPooled && (
            <>
              <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => onEdit(p)}>Edit</Button>
              <Button
                size="sm" variant="ghost"
                className="text-xs h-7 px-2 text-destructive hover:text-destructive"
                onClick={() => onDelete(p.id)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tokens used</div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">{formatTokens(p.usage.totalTokens)}</div>
          <div className="text-[10px] text-muted-foreground">
            {formatTokens(p.usage.inputTokens)} in · {formatTokens(p.usage.outputTokens)} out · {p.usage.requestCount} calls
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Gauge className="h-3 w-3" /> Provider quota
          </div>
          {p.rateLimit ? (
            <>
              <div className="mt-0.5 text-sm font-semibold text-foreground">
                {p.rateLimit.requestRemaining !== undefined && p.rateLimit.requestLimit !== undefined
                  ? `${p.rateLimit.requestRemaining}/${p.rateLimit.requestLimit} req`
                  : "Request limit not reported"}
                {p.rateLimit.tokenRemaining !== undefined
                  ? ` · ${formatRemainingTokens(p.rateLimit.tokenRemaining)} tok left`
                  : ""}
              </div>
              <div className="text-[10px] text-muted-foreground">Reported by the provider on the most recent call</div>
            </>
          ) : (
            <>
              <div className="mt-0.5 text-sm font-semibold text-muted-foreground">No call reported yet</div>
              <div className="text-[10px] text-muted-foreground">Quota appears after the next successful provider call</div>
            </>
          )}
        </div>
      </div>

      {/* Key preview — only for own providers */}
      {p.keyPreview && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/[0.07] bg-black/20 font-mono text-[11px] text-muted-foreground">
          <Key className="w-3 h-3 flex-shrink-0" />
          {p.keyPreview}
        </div>
      )}

      {/* Test result */}
      {testResult && (
        <div className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${
          testResult.success
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
            : "bg-destructive/10 border-destructive/30 text-destructive"
        }`}>
          {testResult.success
            ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
            : <XCircle className="w-3 h-3 flex-shrink-0" />
          }
          {testResult.success
            ? `Connected${testResult.latencyMs !== undefined ? ` · ${testResult.latencyMs}ms` : ""}`
            : (testResult.error ?? "Test failed")
          }
        </div>
      )}
    </div>
  );
}

// ─── Add / Edit drawer ────────────────────────────────────────────────────────

interface DrawerFormState {
  kind: "LLM" | "STT" | "TTS";
  vendor: string;
  displayName: string;
  apiKey: string;
  apiKeyConfirm: string;
  baseUrl: string;
  authMode: "bearer" | "api-key" | "none";
  enabled: boolean;
}

const emptyForm = (): DrawerFormState => ({
  kind: "LLM",
  vendor: "",
  displayName: "",
  apiKey: "",
  apiKeyConfirm: "",
  baseUrl: "",
  authMode: "bearer",
  enabled: true,
});

interface ProviderDrawerProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editProvider: Provider | null;
  onSave: (form: DrawerFormState) => void;
  saving: boolean;
  vendors: string[];
}

function ProviderDrawer({ open, onOpenChange, editProvider, onSave, saving, vendors }: ProviderDrawerProps) {
  const [form, setForm] = useState<DrawerFormState>(emptyForm);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Sync form when drawer opens
  function handleOpen(isOpen: boolean) {
    if (isOpen) {
      if (editProvider) {
        setForm({
          kind: editProvider.kind,
          vendor: editProvider.vendor,
          displayName: editProvider.displayName,
          apiKey: "",
          apiKeyConfirm: "",
          baseUrl: editProvider.baseUrl ?? "",
          authMode: editProvider.authMode,
          enabled: editProvider.enabled,
        });
      } else {
        setForm(emptyForm());
      }
      setShowAdvanced(false);
    }
    onOpenChange(isOpen);
  }

  const f = form;
  const keyMismatch = f.apiKey && f.apiKey !== f.apiKeyConfirm;
  const canSave = f.vendor && f.displayName && !keyMismatch && !saving;

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetContent className="sm:max-w-md flex flex-col gap-0 overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <SheetTitle className="text-sm">
            {editProvider ? "Edit Provider" : "Add Provider"}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-4 py-4">
          {/* Kind — immutable after creation */}
          {editProvider ? (
            <div>
              <Label className="text-xs">Provider Type</Label>
              <div className="mt-1 px-2.5 py-1.5 rounded-lg border border-white/[0.07] bg-black/20 text-xs text-muted-foreground">
                {editProvider.kind} <span className="text-[10px]">(cannot be changed after creation)</span>
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-xs">Provider Type</Label>
              <div className="flex gap-2 mt-1.5">
                {(["LLM", "STT", "TTS"] as const).map((k) => {
                  const m = KIND_META[k];
                  const Icon = m.icon;
                  return (
                    <button
                      key={k}
                      onClick={() => setForm((x) => ({ ...x, kind: k }))}
                      className={`flex-1 flex flex-col items-center gap-1 py-2 rounded border text-[11px] transition-colors ${
                        f.kind === k
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-border bg-muted text-muted-foreground hover:border-primary/30"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {k}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Vendor — immutable after creation */}
          {editProvider ? (
            <div>
              <Label className="text-xs">Vendor</Label>
              <div className="mt-1 px-2.5 py-1.5 rounded-lg border border-white/[0.07] bg-black/20 text-xs text-muted-foreground font-mono">
                {editProvider.vendor} <span className="font-sans text-[10px]">(cannot be changed after creation)</span>
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-xs">Vendor</Label>
              <Input
                className="mt-1 text-xs"
                placeholder="e.g. openai, anthropic, deepgram"
                value={f.vendor}
                list="vendor-suggestions"
                onChange={(e) => setForm((x) => ({ ...x, vendor: e.target.value }))}
              />
              <datalist id="vendor-suggestions">
                {vendors.map((v) => <option key={v} value={v} />)}
              </datalist>
            </div>
          )}

          {/* Display name */}
          <div>
            <Label className="text-xs">Display Name</Label>
            <Input
              className="mt-1 text-xs"
              placeholder="My OpenAI Provider"
              value={f.displayName}
              onChange={(e) => setForm((x) => ({ ...x, displayName: e.target.value }))}
            />
          </div>

          {/* Auth mode — immutable after creation */}
          {editProvider ? (
            <div>
              <Label className="text-xs">Authentication</Label>
              <div className="mt-1 px-2.5 py-1.5 rounded-lg border border-white/[0.07] bg-black/20 text-xs text-muted-foreground">
                {editProvider.authMode === "bearer" ? "Bearer token" : editProvider.authMode === "api-key" ? "API key header" : "No auth"}
                <span className="ml-1 text-[10px]">(cannot be changed after creation)</span>
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-xs">Authentication</Label>
              <Select value={f.authMode} onValueChange={(v) => setForm((x) => ({ ...x, authMode: v as DrawerFormState["authMode"] }))}>
                <SelectTrigger className="mt-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bearer" className="text-xs">Bearer token (Authorization: Bearer …)</SelectItem>
                  <SelectItem value="api-key" className="text-xs">API key header (x-api-key / api-key)</SelectItem>
                  <SelectItem value="none" className="text-xs">No auth (local / open endpoint)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* API key */}
          {f.authMode !== "none" && (
            <>
              <div>
                <Label className="text-xs">
                  API Key {editProvider && <span className="text-muted-foreground">(leave blank to keep current)</span>}
                </Label>
                <Input
                  className="mt-1 text-xs font-mono"
                  type="password"
                  placeholder="sk-…"
                  value={f.apiKey}
                  onChange={(e) => setForm((x) => ({ ...x, apiKey: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Confirm API Key</Label>
                <Input
                  className={`mt-1 text-xs font-mono ${keyMismatch ? "border-destructive" : ""}`}
                  type="password"
                  placeholder="Repeat key to confirm"
                  value={f.apiKeyConfirm}
                  onChange={(e) => setForm((x) => ({ ...x, apiKeyConfirm: e.target.value }))}
                />
                {keyMismatch && <p className="text-[10px] text-destructive mt-0.5">Keys don't match</p>}
              </div>
            </>
          )}

          {/* Advanced */}
          <button
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowAdvanced((s) => !s)}
          >
            {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Advanced options
          </button>

          {showAdvanced && (
            <div className="space-y-3 rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div>
                <Label className="text-xs">Custom Base URL</Label>
                <Input
                  className="mt-1 text-xs font-mono"
                  placeholder="https://my-proxy.company.com/v1"
                  value={f.baseUrl}
                  onChange={(e) => setForm((x) => ({ ...x, baseUrl: e.target.value }))}
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">For compatible proxies or self-hosted endpoints.</p>
              </div>
              <div className="flex items-center justify-between py-1">
                <Label className="text-xs">Enabled</Label>
                <Switch
                  checked={f.enabled}
                  onCheckedChange={(v) => setForm((x) => ({ ...x, enabled: v }))}
                />
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="border-t border-border pt-4">
          <Button variant="outline" size="sm" className="text-xs" onClick={() => handleOpen(false)}>Cancel</Button>
          <Button size="sm" className="text-xs" disabled={!canSave} onClick={() => onSave(form)}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            {editProvider ? "Save Changes" : "Add Provider"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProvidersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: providers = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/v1/providers"],
    queryFn: fetchProviders,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const { data: catalog = [] } = useQuery({
    queryKey: ["/api/v1/model-catalog"],
    queryFn: fetchCatalog,
    staleTime: 60_000,
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editProvider, setEditProvider] = useState<Provider | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; latencyMs?: number; error?: string }>>({});

  // Collect distinct vendors from catalog for suggestions
  const vendorSuggestions = [...new Set(catalog.map((e) => e.vendor))].sort();

  // ── Mutations ──────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: async ({ form, id }: { form: DrawerFormState; id?: string }) => {
      const body: Record<string, unknown> = {
        kind: form.kind,
        vendor: form.vendor,
        displayName: form.displayName,
        authMode: form.authMode,
        enabled: form.enabled,
        baseUrl: form.baseUrl || null,
      };
      if (form.apiKey) body.apiKey = form.apiKey;

      const url = id ? `${BASE}/api/v1/providers/${id}` : `${BASE}/api/v1/providers`;
      const r = await fetch(url, {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any)?.error ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: editProvider ? "Provider updated" : "Provider added" });
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/v1/providers"] });
    },
    onError: (err) => {
      toast({ title: "Save failed", description: String(err.message), variant: "destructive" });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`${BASE}/api/v1/providers/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => {
      toast({ title: "Provider deleted" });
      qc.invalidateQueries({ queryKey: ["/api/v1/providers"] });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const r = await fetch(`${BASE}/api/v1/providers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/v1/providers"] }),
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  // ── Test key ───────────────────────────────────────────────────────────────

  async function testProvider(id: string) {
    setTesting((t) => ({ ...t, [id]: true }));
    try {
      const r = await fetch(`${BASE}/api/v1/providers/${id}/test-key`, {
        method: "POST",
        credentials: "include",
      });
      const json = await r.json() as { success: boolean; latencyMs?: number; error?: string };
      setTestResults((tr) => ({ ...tr, [id]: json }));
      toast({
        title: json.success ? "Provider connected" : "Connection failed",
        description: json.error,
        variant: json.success ? "default" : "destructive",
      });
    } catch {
      setTestResults((tr) => ({ ...tr, [id]: { success: false, error: "Network error" } }));
    } finally {
      setTesting((t) => ({ ...t, [id]: false }));
    }
  }

  // ── Grouping ──────────────────────────────────────────────────────────────

  const byKind = (["LLM", "STT", "TTS"] as const).map((kind) => ({
    kind,
    providers: providers.filter((p) => p.kind === kind),
  }));

  const ownCount = providers.filter((p) => !p.isPlatformPooled).length;
  const envCount = providers.filter((p) => p.isEnvironmentConfigured).length;
  const pooledCount = providers.filter((p) => p.isPlatformPooled && !p.isEnvironmentConfigured).length;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading providers…
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6 p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.022em] text-foreground">Providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ownCount} tenant · {envCount} environment · {pooledCount} platform-pooled
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="text-xs h-8 gap-1" onClick={() => refetch()}>
            <RefreshCw className="w-3 h-3" /> Refresh
          </Button>
          <Button size="sm" className="text-xs h-8 gap-1" onClick={() => { setEditProvider(null); setDrawerOpen(true); }}>
            <Plus className="w-3 h-3" /> Add Provider
          </Button>
        </div>
      </div>

      {/* Provider groups */}
      {byKind.map(({ kind, providers: group }) => {
        if (group.length === 0) return null;
        const m = KIND_META[kind];
        const Icon = m.icon;
        return (
          <section key={kind} className="space-y-3">
            <div className="flex items-center gap-2">
              <Icon className={`w-4 h-4 ${m.color}`} />
              <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">{m.label}</h2>
              <span className="text-[10px] text-muted-foreground">({group.length})</span>
            </div>
            <div className="space-y-2">
              {group.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  onEdit={(pr) => { setEditProvider(pr); setDrawerOpen(true); }}
                  onDelete={(id) => deleteMut.mutate(id)}
                  onTest={testProvider}
                  onToggle={(id, enabled) => toggleMut.mutate({ id, enabled })}
                  testing={testing[p.id] ?? false}
                  testResult={testResults[p.id]}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Empty state */}
      {providers.length === 0 && (
        <div className="empty-state">
          <Key className="empty-state-icon" />
          <p className="text-sm">No providers configured yet</p>
          <p className="text-[11px] text-center max-w-xs">
            Add your own API keys to power LLM, STT, and TTS for this tenant.
            Platform-pooled providers will appear here automatically when configured.
          </p>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => { setEditProvider(null); setDrawerOpen(true); }}>
            <Plus className="w-3 h-3 mr-1" /> Add first provider
          </Button>
        </div>
      )}

      {/* Add/Edit drawer */}
      <ProviderDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        editProvider={editProvider}
        onSave={(form) => saveMut.mutate({ form, id: editProvider?.id })}
        saving={saveMut.isPending}
        vendors={vendorSuggestions}
      />
    </div>
  );
}
