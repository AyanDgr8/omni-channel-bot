import { useState } from "react";
import {
  useListMemoryEntries,
  useGetMemoryStats,
  useCreateMemoryEntry,
  useUpdateMemoryEntry,
  useDeleteMemoryEntry,
  useTrainMemory,
  getListMemoryEntriesQueryKey,
  getGetMemoryStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Brain, Plus, Trash2, Edit, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const tierColors: Record<string, string> = {
  L1: "bg-accent/15 text-accent border-accent/30",
  L2: "bg-primary/15 text-primary border-primary/30",
  L3: "bg-muted text-muted-foreground border-border",
};

export default function Memory() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ question: "", answer: "", confidence: "1.0" });

  const params = { limit: 50, ...(search ? { search } : {}) };
  const { data, isLoading } = useListMemoryEntries(params, { query: { queryKey: getListMemoryEntriesQueryKey(params) } });
  const { data: stats } = useGetMemoryStats();
  const createMut = useCreateMemoryEntry();
  const updateMut = useUpdateMemoryEntry();
  const deleteMut = useDeleteMemoryEntry();
  const trainMut = useTrainMemory();

  function openCreate() { setEditId(null); setForm({ question: "", answer: "", confidence: "1.0" }); setOpen(true); }
  function openEdit(e: NonNullable<typeof data>["entries"][0]) {
    setEditId(e.id);
    setForm({ question: e.question, answer: e.answer, confidence: String(e.confidence) });
    setOpen(true);
  }

  function handleSave() {
    const payload = { question: form.question, answer: form.answer, confidence: parseFloat(form.confidence) || 1.0 };
    if (editId) {
      updateMut.mutate({ id: editId, data: payload }, {
        onSuccess: () => { toast({ title: "Entry updated" }); setOpen(false); qc.invalidateQueries({ queryKey: getListMemoryEntriesQueryKey(params) }); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      });
    } else {
      createMut.mutate({ data: payload }, {
        onSuccess: () => { toast({ title: "Entry created" }); setOpen(false); qc.invalidateQueries({ queryKey: getListMemoryEntriesQueryKey(params) }); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      });
    }
  }

  function handleDelete(id: string) {
    deleteMut.mutate({ id }, {
      onSuccess: () => { toast({ title: "Entry deleted" }); qc.invalidateQueries({ queryKey: getListMemoryEntriesQueryKey(params) }); },
    });
  }

  function handleTrain() {
    trainMut.mutate(undefined, {
      onSuccess: (r) => {
        toast({ title: `Reindex complete — ${r.entriesIndexed} entries indexed` });
        qc.invalidateQueries({ queryKey: getListMemoryEntriesQueryKey(params) });
        qc.invalidateQueries({ queryKey: getGetMemoryStatsQueryKey() });
      },
    });
  }

  const entries = data?.entries ?? [];

  return (
    <div className="animate-fade-in space-y-6 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.022em] text-foreground">Knowledge Base</h1>
          <p className="mt-1 text-sm text-muted-foreground">{data?.total ?? 0} memory entries — L1/L2/L3 tiers</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleTrain} disabled={trainMut.isPending} className="gap-1.5 text-xs">
            <RefreshCw className={`w-3 h-3 ${trainMut.isPending ? "animate-spin" : ""}`} />
            {trainMut.isPending ? "Indexing..." : "Reindex"}
          </Button>
          <Button size="sm" onClick={openCreate} className="gap-1.5 text-xs">
            <Plus className="w-3 h-3" /> Add Entry
          </Button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "L1 Hit Rate", value: `${stats.l1HitRate}%`, sub: `${stats.l1Size} entries`, color: "accent" },
            { label: "L2 Hit Rate", value: `${stats.l2HitRate}%`, sub: `${stats.l2Size} entries`, color: "primary" },
            { label: "L3 Hit Rate", value: `${stats.l3HitRate}%`, sub: `${stats.l3Size} entries`, color: "muted" },
          ].map(({ label, value, sub, color }) => (
            <div key={label} className="panel p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className={`text-xl font-bold mt-0.5 tabular-nums ${color === "accent" ? "text-accent" : color === "primary" ? "text-primary" : "text-foreground"}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          className="pl-8 text-xs"
          placeholder="Search questions and answers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="panel overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Question</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Answer</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-16">Tier</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-16">Hits</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-20">Confidence</th>
              <th className="px-3 py-2.5 w-20" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center">
                  <Brain className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-muted-foreground">{search ? "No entries match your search" : "No memory entries yet"}</p>
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-b border-border/50 transition-colors hover:bg-white/[0.035]">
                  <td className="px-3 py-2.5 text-foreground max-w-[200px]"><p className="truncate">{e.question}</p></td>
                  <td className="px-3 py-2.5 text-muted-foreground max-w-[250px]"><p className="truncate">{e.answer}</p></td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${tierColors[e.tier ?? "L3"] ?? ""}`}>{e.tier ?? "L3"}</span>
                  </td>
                  <td className="px-3 py-2.5 text-foreground tabular-nums font-medium">{e.hitCount}</td>
                  <td className="px-3 py-2.5 text-foreground tabular-nums">{(e.confidence * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => openEdit(e)}><Edit className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(e.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" /> {editId ? "Edit Entry" : "Add Memory Entry"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Question</Label>
              <Textarea className="mt-1 text-xs" rows={2} placeholder="What is your return policy?" value={form.question} onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Answer</Label>
              <Textarea className="mt-1 text-xs" rows={3} placeholder="Our return policy allows..." value={form.answer} onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Confidence (0–1)</Label>
              <Input className="mt-1 text-xs font-mono" type="number" min="0" max="1" step="0.01" value={form.confidence} onChange={(e) => setForm((f) => ({ ...f, confidence: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} className="text-xs">Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={!form.question || !form.answer || createMut.isPending || updateMut.isPending} className="text-xs">
              {editId ? "Save Changes" : "Add Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
