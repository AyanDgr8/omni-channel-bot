/**
 * Model Catalog page — browse the vendor model catalogue.
 * Route: /model-catalog  (all authenticated users, read-only for non-platform-admin)
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, BookOpen, Cpu, Mic, Volume2, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModelCatalogEntry {
  id: string;
  vendor: string;
  kind: "LLM" | "STT" | "TTS";
  modelId: string;
  displayName: string;
  tier: "lite" | "standard" | "premium";
  contextWindow: number | null;
  costPerUnit: string | null;
  deprecated: boolean;
}

async function fetchCatalog(): Promise<ModelCatalogEntry[]> {
  const r = await fetch(`${BASE}/api/v1/model-catalog`, { credentials: "include" });
  if (!r.ok) throw new Error("Failed to load model catalog");
  return r.json();
}

// ─── Config ───────────────────────────────────────────────────────────────────

const KIND_ICON: Record<string, React.ElementType> = {
  LLM: Cpu, STT: Mic, TTS: Volume2,
};

const TIER_BADGE: Record<string, string> = {
  lite: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30",
  standard: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  premium: "bg-amber-500/15 text-amber-600 border-amber-500/30",
};

const VENDOR_COLOR: Record<string, string> = {
  openai: "bg-emerald-500/15 text-emerald-600",
  anthropic: "bg-amber-500/15 text-amber-600",
  google: "bg-blue-500/15 text-blue-600",
  deepgram: "bg-violet-500/15 text-violet-600",
  elevenlabs: "bg-pink-500/15 text-pink-600",
  azure: "bg-sky-500/15 text-sky-600",
  ollama: "bg-zinc-500/15 text-zinc-500",
  cohere: "bg-orange-500/15 text-orange-600",
  mistral: "bg-indigo-500/15 text-indigo-600",
};

export default function ModelCatalogPage() {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["/api/v1/model-catalog"],
    queryFn: fetchCatalog,
    staleTime: 120_000,
  });

  const [kindFilter, setKindFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showDeprecated, setShowDeprecated] = useState(false);

  const vendors = [...new Set(entries.map((e) => e.vendor))].sort();

  const filtered = entries.filter((e) => {
    if (kindFilter !== "all" && e.kind !== kindFilter) return false;
    if (vendorFilter !== "all" && e.vendor !== vendorFilter) return false;
    if (!showDeprecated && e.deprecated) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.modelId.toLowerCase().includes(q) || e.displayName.toLowerCase().includes(q) || e.vendor.toLowerCase().includes(q);
    }
    return true;
  });

  // Group by kind
  const byKind = (["LLM", "STT", "TTS"] as const).map((kind) => ({
    kind,
    entries: filtered.filter((e) => e.kind === kind),
  })).filter((g) => g.entries.length > 0);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading catalogue…
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6 p-6 md:p-8">
      {/* Header */}
      <div>
        <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.022em] text-foreground">Model Catalogue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {entries.filter((e) => !e.deprecated).length} active models across {vendors.length} vendors
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Filter className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            className="pl-7 text-xs h-8"
            placeholder="Search model name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All types</SelectItem>
            <SelectItem value="LLM" className="text-xs">LLM</SelectItem>
            <SelectItem value="STT" className="text-xs">STT</SelectItem>
            <SelectItem value="TTS" className="text-xs">TTS</SelectItem>
          </SelectContent>
        </Select>
        <Select value={vendorFilter} onValueChange={setVendorFilter}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All vendors</SelectItem>
            {vendors.map((v) => (
              <SelectItem key={v} value={v} className="text-xs capitalize">{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={showDeprecated}
            onChange={(e) => setShowDeprecated(e.target.checked)}
          />
          Show deprecated
        </label>
      </div>

      {/* Model groups */}
      {byKind.map(({ kind, entries: group }) => {
        const Icon = KIND_ICON[kind];
        return (
          <section key={kind} className="space-y-2">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Icon className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                {kind === "LLM" ? "Language Models" : kind === "STT" ? "Speech-to-Text" : "Text-to-Speech"}
              </h2>
              <span className="text-[10px] text-muted-foreground">({group.length})</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-y-0.5">
                <thead>
                  <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    <th className="text-left px-3 py-1.5 font-medium">Vendor</th>
                    <th className="text-left px-3 py-1.5 font-medium">Model ID</th>
                    <th className="text-left px-3 py-1.5 font-medium">Display Name</th>
                    <th className="text-left px-3 py-1.5 font-medium">Tier</th>
                    {kind === "LLM" && <th className="text-left px-3 py-1.5 font-medium">Context</th>}
                    {kind === "LLM" && <th className="text-left px-3 py-1.5 font-medium">Cost</th>}
                    <th className="text-left px-3 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map((e) => (
                    <tr
                      key={e.id}
                      className={`panel ${e.deprecated ? "opacity-50" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${VENDOR_COLOR[e.vendor] ?? "bg-zinc-500/15 text-zinc-500"}`}>
                          {e.vendor}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{e.modelId}</td>
                      <td className="px-3 py-2 font-medium text-foreground">{e.displayName}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={`text-[9px] h-4 px-1.5 font-medium ${TIER_BADGE[e.tier] ?? ""}`}>
                          {e.tier}
                        </Badge>
                      </td>
                      {kind === "LLM" && (
                        <td className="px-3 py-2 text-muted-foreground font-mono">
                          {e.contextWindow ? `${(e.contextWindow / 1000).toFixed(0)}k` : "—"}
                        </td>
                      )}
                      {kind === "LLM" && (
                        <td className="px-3 py-2 text-muted-foreground font-mono text-[10px]">
                          {e.costPerUnit ?? "—"}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        {e.deprecated ? (
                          <span className="text-[10px] text-muted-foreground">Deprecated</span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> Active
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {filtered.length === 0 && !isLoading && (
        <div className="empty-state">
          <BookOpen className="empty-state-icon" />
          <p className="text-sm">No models match your filters</p>
        </div>
      )}

      <div className="mt-4 p-3 rounded-xl border border-white/[0.07] bg-black/20 text-[11px] text-muted-foreground leading-relaxed">
        <strong className="text-foreground">Adding custom models:</strong> The model catalogue is managed at the platform level.
        New models are added via database migration. Contact your platform operator to register a custom vendor or model.
      </div>
    </div>
  );
}
