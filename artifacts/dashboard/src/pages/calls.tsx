import { useState } from "react";
import {
  useListCalls,
  useListBots,
  useDialCall,
  useHangupCall,
  getListCallsQueryKey,
} from "@workspace/api-client-react";
import type { CallList } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import React from "react";
import {
  PhoneCall, PhoneOff, Plus, RefreshCw,
  ChevronDown, ChevronRight, MicOff, Globe, CheckCircle2,
  PhoneIncoming, PhoneOutgoing,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  INITIATING:  "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  RINGING:     "bg-blue-500/15 text-blue-400 border-blue-500/30",
  IN_PROGRESS: "bg-accent/15 text-accent border-accent/30",
  COMPLETED:   "bg-muted text-muted-foreground border-border",
  FAILED:      "bg-destructive/15 text-destructive border-destructive/30",
};

const connectOutcomeConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  HUMAN:            { label: "Human",        color: "bg-accent/15 text-accent",          icon: CheckCircle2 },
  ANSWERING_MACHINE:{ label: "Voicemail",    color: "bg-yellow-500/15 text-yellow-400",  icon: MicOff },
  IVR:              { label: "IVR / System", color: "bg-purple-500/15 text-purple-400",  icon: PhoneCall },
  SILENCE:          { label: "Silence",      color: "bg-muted text-muted-foreground",    icon: MicOff },
  NO_RESPONSE:      { label: "No Response",  color: "bg-destructive/15 text-destructive",icon: MicOff },
};

// Legacy amd labels (kept for old rows)
const amdColors: Record<string, string> = {
  HUMAN:    "bg-accent/15 text-accent",
  VOICEMAIL:"bg-yellow-500/15 text-yellow-400",
  IVR:      "bg-purple-500/15 text-purple-400",
  UNKNOWN:  "bg-muted text-muted-foreground",
};

function fmt(sec: number | null | undefined) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d as string).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type CallRow = CallList["calls"][0];

function CallDetailPanel({ call }: { call: CallRow }) {
  const connectCfg = connectOutcomeConfig[(call as any).connectOutcome as string];
  const ConnectIcon = connectCfg?.icon ?? CheckCircle2;
  const langSwitches: Array<{ from: string; to: string; at: string }> = (call as any).languageSwitches ?? [];

  return (
    <div className="bg-muted/30 border-t border-border px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-[11px]">
      {/* Connect Outcome */}
      <div className="space-y-0.5">
        <p className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">Connect Outcome</p>
        {(call as any).connectOutcome ? (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${connectCfg?.color ?? "bg-muted text-muted-foreground"}`}>
            <ConnectIcon className="w-3 h-3" />
            {connectCfg?.label ?? (call as any).connectOutcome}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>

      {/* Final Disposition */}
      <div className="space-y-0.5">
        <p className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">Disposition</p>
        <span className={`font-medium ${(call as any).finalDisposition === "COMPLETED" ? "text-accent" : (call as any).finalDisposition ? "text-foreground" : "text-muted-foreground"}`}>
          {(call as any).finalDisposition ?? "—"}
        </span>
      </div>

      {/* Interruptions */}
      <div className="space-y-0.5">
        <p className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">Barge-ins</p>
        <span className={`font-medium tabular-nums ${((call as any).interruptionCount ?? 0) > 0 ? "text-yellow-400" : "text-muted-foreground"}`}>
          {(call as any).interruptionCount ?? 0}
        </span>
      </div>

      {/* Escalations */}
      <div className="space-y-0.5">
        <p className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">Escalations</p>
        <span className={`font-medium tabular-nums ${((call as any).escalationCount ?? 0) > 0 ? "text-destructive" : "text-muted-foreground"}`}>
          {(call as any).escalationCount ?? 0}
        </span>
      </div>

      {/* Language */}
      <div className="space-y-0.5">
        <p className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">Language</p>
        <span className="text-foreground flex items-center gap-1">
          <Globe className="w-3 h-3 text-muted-foreground" />
          {call.languageDetected?.toUpperCase() ?? "—"}
        </span>
      </div>

      {/* Language switches */}
      <div className="space-y-0.5">
        <p className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">Lang Switches</p>
        {langSwitches.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {langSwitches.map((sw, i) => (
              <span key={i} className="bg-primary/10 text-primary px-1 py-0.5 rounded text-[10px] font-mono">
                {sw.from.toUpperCase()} → {sw.to.toUpperCase()}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </div>

      {/* Transfer target */}
      {call.transferTarget && (
        <div className="space-y-0.5">
          <p className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">Transferred To</p>
          <span className="font-mono text-foreground">{call.transferTarget}</span>
        </div>
      )}

      {/* Summary */}
      {call.summary && (
        <div className="space-y-0.5 col-span-full">
          <p className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">Summary</p>
          <p className="text-foreground">{call.summary}</p>
        </div>
      )}
    </div>
  );
}

export default function Calls() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dirFilter, setDirFilter] = useState<string>("all");
  const [dialOpen, setDialOpen] = useState(false);
  const [dialTo, setDialTo] = useState("");
  const [dialBot, setDialBot] = useState("");
  const [page, setPage] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const limit = 20;

  const params = { limit, offset: page * limit, ...(dirFilter !== "all" ? { direction: dirFilter as "INBOUND" | "OUTBOUND" } : {}) };
  const { data, isLoading, refetch } = useListCalls(params, { query: { queryKey: getListCallsQueryKey(params) } });
  const { data: bots } = useListBots();
  const dialMutation = useDialCall();
  const hangupMutation = useHangupCall();

  function handleDial() {
    if (!dialTo || !dialBot) return;
    dialMutation.mutate(
      { data: { to: dialTo, botId: dialBot } },
      {
        onSuccess: () => {
          toast({ title: "Call initiated", description: `Dialing ${dialTo}` });
          setDialOpen(false); setDialTo(""); setDialBot("");
          qc.invalidateQueries({ queryKey: getListCallsQueryKey(params) });
        },
        onError: () => toast({ title: "Failed to dial", variant: "destructive" }),
      }
    );
  }

  function handleHangup(id: string) {
    hangupMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: "Call hung up" }); qc.invalidateQueries({ queryKey: getListCallsQueryKey(params) }); },
    });
  }

  const calls = data?.calls ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground tracking-tight">Call Log</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{total.toLocaleString()} total calls</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 text-xs">
            <RefreshCw className="w-3 h-3" /> Refresh
          </Button>
          <Select value={dirFilter} onValueChange={setDirFilter}>
            <SelectTrigger className="w-32 text-xs h-8"><SelectValue placeholder="All directions" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="INBOUND">Inbound</SelectItem>
              <SelectItem value="OUTBOUND">Outbound</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setDialOpen(true)} className="gap-1.5 text-xs">
            <Plus className="w-3 h-3" /> Dial
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-card-border rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="w-8 px-2 py-2.5" />
              {["Direction", "Number", "Status", "Connect", "Duration", "Disposition", "Lang", "Started"].map((h) => (
                <th key={h} className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : calls.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No calls yet. Dial one to get started.</td></tr>
            ) : (
              calls.map((call) => {
                const isExpanded = expandedRow === call.id;
                const connectOutcome = (call as any).connectOutcome as string | null;
                const connectCfg = connectOutcome ? connectOutcomeConfig[connectOutcome] : null;
                const ConnectIcon = connectCfg?.icon;
                const isInbound = call.direction === "INBOUND";

                return (
                  <React.Fragment key={call.id}>
                    <tr
                      className={`border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer ${isExpanded ? "bg-muted/20" : ""}`}
                      onClick={() => setExpandedRow(isExpanded ? null : call.id)}
                    >
                      <td className="px-2 py-2.5 text-muted-foreground">
                        {isExpanded
                          ? <ChevronDown className="w-3 h-3" />
                          : <ChevronRight className="w-3 h-3" />}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${isInbound ? "bg-primary/15 text-primary" : "bg-accent/15 text-accent"}`}>
                          {isInbound ? <PhoneIncoming className="w-2.5 h-2.5" /> : <PhoneOutgoing className="w-2.5 h-2.5" />}
                          {call.direction}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-foreground">{call.customerNumber ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${statusColors[call.status] ?? ""}`}>
                          {call.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {connectCfg && ConnectIcon ? (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${connectCfg.color}`}>
                            <ConnectIcon className="w-2.5 h-2.5" />
                            {connectCfg.label}
                          </span>
                        ) : call.amdResult ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${amdColors[call.amdResult] ?? ""}`}>
                            {call.amdResult}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{fmt(call.durationSeconds)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {(call as any).finalDisposition ?? call.hangupReason ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{call.languageDetected?.toUpperCase() ?? "—"}</td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{fmtDate(call.startedAt)}</td>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {(call.status === "IN_PROGRESS" || call.status === "RINGING") && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-6 px-2 text-destructive hover:text-destructive text-[10px]"
                            onClick={() => handleHangup(call.id)}
                          >
                            <PhoneOff className="w-3 h-3 mr-1" /> Hang up
                          </Button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-border/50">
                        <td colSpan={10} className="p-0">
                          <CallDetailPanel call={call} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page + 1} of {Math.ceil(total / limit)}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="text-xs h-7">Prev</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)} className="text-xs h-7">Next</Button>
          </div>
        </div>
      )}

      {/* Dial Dialog */}
      <Dialog open={dialOpen} onOpenChange={setDialOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <PhoneCall className="w-4 h-4 text-primary" /> Initiate Outbound Call
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Destination Number (E.164)</Label>
              <Input className="mt-1 font-mono text-xs" placeholder="+919876543210" value={dialTo} onChange={(e) => setDialTo(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Bot Agent</Label>
              <Select value={dialBot} onValueChange={setDialBot}>
                <SelectTrigger className="mt-1 text-xs"><SelectValue placeholder="Select a bot" /></SelectTrigger>
                <SelectContent>
                  {(bots ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs">
                      {b.displayName} — ext. {b.sipExtension}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialOpen(false)} className="text-xs">Cancel</Button>
            <Button size="sm" onClick={handleDial} disabled={!dialTo || !dialBot || dialMutation.isPending} className="text-xs gap-1.5">
              <PhoneCall className="w-3 h-3" />
              {dialMutation.isPending ? "Dialing..." : "Dial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
