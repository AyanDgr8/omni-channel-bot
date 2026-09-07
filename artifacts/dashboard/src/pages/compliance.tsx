import { ChangeEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download, FileUp, Loader2, Plus, Search, ShieldCheck, Trash2,
  UserCheck, ClipboardCheck, AlertTriangle, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

interface DncEntry {
  id: string;
  phoneNumber: string;
  source: string;
  reason: string | null;
  addedAt: string;
  expiresAt: string | null;
}

interface ConsentEntry {
  id: string;
  phoneNumber: string;
  consentType: "VOICE_CALLING" | "RECORDING";
  status: "GRANTED" | "REVOKED";
  source: string;
  evidence: string | null;
  capturedAt: string;
  expiresAt: string | null;
}

interface ComplianceProfile {
  id: string;
  jurisdictionCode: string;
  displayName: string;
  enabled: boolean;
  timezone: string;
  callingWindowStart: string;
  callingWindowEnd: string;
  allowedDays: string[];
  holidays: string[];
  requireConsent: boolean;
  requireRecordingConsent: boolean;
  mandatoryDisclosureText: string | null;
  blockOnHoliday: boolean;
}

interface Evidence {
  id: string;
  phoneNumber: string;
  direction: string;
  decision: "ALLOWED" | "BLOCKED";
  reasonCode: string;
  reason: string;
  jurisdictionCode: string;
  calledPartyTimezone: string;
  disclosureText: string | null;
  callId: string | null;
  evaluatedAt: string;
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}/api${path}`, { credentials: "include", ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "Request failed");
  }
  return response.json() as Promise<T>;
}

function download(path: string) {
  window.open(`${BASE}/api${path}`, "_blank", "noopener,noreferrer");
}

function when(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function DncTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [reason, setReason] = useState("");
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["compliance-dnc", search],
    queryFn: () => requestJson<DncEntry[]>(`/v1/compliance/dnc${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["compliance-dnc"] });

  const create = useMutation({
    mutationFn: () => requestJson<DncEntry>("/v1/compliance/dnc", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber, reason: reason || undefined }),
    }),
    onSuccess: () => {
      invalidate(); setDialogOpen(false); setPhoneNumber(""); setReason("");
      toast({ title: "Added to do-not-call list" });
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => requestJson(`/v1/compliance/dnc/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "DNC entry removed" }); },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });
  const importCsv = useMutation({
    mutationFn: (csv: string) => requestJson<{ imported: number; rejected: number }>("/v1/compliance/dnc/import", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }),
    }),
    onSuccess: (result) => { invalidate(); toast({ title: `Imported ${result.imported} DNC entries`, description: result.rejected ? `${result.rejected} row(s) were rejected` : undefined }); },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importCsv.mutate(String(reader.result ?? ""));
    reader.readAsText(file);
    event.target.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search E.164 number…" />
        </div>
        <div className="flex gap-2">
          <label>
            <Button asChild variant="outline" size="sm" className="gap-1.5"><span><FileUp className="w-3.5 h-3.5" /> Import CSV</span></Button>
            <input className="sr-only" type="file" accept=".csv,text/csv" onChange={onFile} />
          </label>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => download("/v1/compliance/dnc/export")}><Download className="w-3.5 h-3.5" /> Export</Button>
          <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}><Plus className="w-3.5 h-3.5" /> Add number</Button>
        </div>
      </div>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 text-left">Phone number</th><th className="px-3 py-2 text-left">Reason</th><th className="px-3 py-2 text-left">Source</th><th className="px-3 py-2 text-left">Added</th><th className="w-12" /></tr>
          </thead>
          <tbody>
            {isLoading ? <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Loading DNC list…</td></tr> : entries.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No matching DNC entries.</td></tr> :
              entries.map((entry) => <tr key={entry.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2.5 font-mono text-xs">{entry.phoneNumber}</td><td className="px-3 py-2.5 text-muted-foreground">{entry.reason || "—"}</td><td className="px-3 py-2.5 text-xs">{entry.source}</td><td className="px-3 py-2.5 text-xs text-muted-foreground">{when(entry.addedAt)}</td>
                <td><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove.mutate(entry.id)} aria-label={`Remove ${entry.phoneNumber}`}><Trash2 className="w-3.5 h-3.5" /></Button></td>
              </tr>)}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">CSV must contain a <code className="rounded bg-muted px-1">phone</code> or <code className="rounded bg-muted px-1">phone_number</code> column. Numbers are normalized to E.164.</p>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add do-not-call number</DialogTitle><DialogDescription>Outbound calls to this number are blocked immediately.</DialogDescription></DialogHeader>
          <div className="space-y-3"><div><Label>Phone number</Label><Input className="mt-1" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+14155550123" /></div><div><Label>Reason (optional)</Label><Input className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Customer request" /></div></div>
          <DialogFooter><Button onClick={() => create.mutate()} disabled={!phoneNumber || create.isPending}>{create.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />} Add to DNC</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConsentTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [consentType, setConsentType] = useState<"VOICE_CALLING" | "RECORDING">("VOICE_CALLING");
  const [evidence, setEvidence] = useState("");
  const { data: entries = [], isLoading } = useQuery({ queryKey: ["compliance-consents"], queryFn: () => requestJson<ConsentEntry[]>("/v1/compliance/consents") });
  const mutation = useMutation({
    mutationFn: () => requestJson<ConsentEntry>("/v1/compliance/consents", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber, consentType, status: "GRANTED", evidence: evidence || undefined }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["compliance-consents"] }); setOpen(false); setPhoneNumber(""); setEvidence(""); toast({ title: "Consent recorded" }); },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => requestJson(`/v1/compliance/consents/${id}/revoke`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["compliance-consents"] }); toast({ title: "Consent revoked" }); },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });
  return <div className="space-y-4">
    <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">Append-only ledger of permission and revocation events.</p><Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}><UserCheck className="w-3.5 h-3.5" /> Record consent</Button></div>
    <div className="rounded-md border overflow-hidden"><table className="w-full text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Phone</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Evidence</th><th className="px-3 py-2 text-left">Captured</th><th /></tr></thead><tbody>
      {isLoading ? <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Loading consent ledger…</td></tr> : entries.length === 0 ? <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No consent events recorded.</td></tr> : entries.map((entry) => <tr key={entry.id} className="border-t"><td className="px-3 py-2.5 font-mono text-xs">{entry.phoneNumber}</td><td className="px-3 py-2.5 text-xs">{entry.consentType.replace("_", " ")}</td><td className="px-3 py-2.5"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${entry.status === "GRANTED" ? "bg-emerald-500/15 text-emerald-700" : "bg-destructive/10 text-destructive"}`}>{entry.status}</span></td><td className="max-w-[250px] truncate px-3 py-2.5 text-xs text-muted-foreground">{entry.evidence || "—"}</td><td className="px-3 py-2.5 text-xs text-muted-foreground">{when(entry.capturedAt)}</td><td>{entry.status === "GRANTED" && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => revoke.mutate(entry.id)}><RotateCcw className="mr-1 w-3 h-3" /> Revoke</Button>}</td></tr>)}
    </tbody></table></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Record consent</DialogTitle><DialogDescription>This creates an immutable permission event for the selected number.</DialogDescription></DialogHeader><div className="space-y-3"><div><Label>Phone number</Label><Input className="mt-1" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+14155550123" /></div><div><Label>Consent type</Label><select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={consentType} onChange={(event) => setConsentType(event.target.value as typeof consentType)}><option value="VOICE_CALLING">Voice calling</option><option value="RECORDING">Recording</option></select></div><div><Label>Evidence (optional)</Label><Textarea className="mt-1" value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Source, date, or proof of consent" /></div></div><DialogFooter><Button onClick={() => mutation.mutate()} disabled={!phoneNumber || mutation.isPending}>{mutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />} Record</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function ProfileTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: profiles = [], isLoading } = useQuery({ queryKey: ["compliance-profiles"], queryFn: () => requestJson<ComplianceProfile[]>("/v1/compliance/profiles") });
  const [selected, setSelected] = useState<ComplianceProfile | null>(null);
  const [holidaysText, setHolidaysText] = useState("");
  const startEdit = (profile: ComplianceProfile) => { setSelected({ ...profile, allowedDays: profile.allowedDays ?? DAYS, holidays: profile.holidays ?? [] }); setHolidaysText((profile.holidays ?? []).join("\n")); };
  const save = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("No profile selected");
      return requestJson<ComplianceProfile>(`/v1/compliance/profiles/${selected.jurisdictionCode}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...selected, holidays: holidaysText.split(/\s|,/).map((value) => value.trim()).filter(Boolean) }) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["compliance-profiles"] }); setSelected(null); toast({ title: "Jurisdiction policy saved" }); },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });
  return <div className="space-y-4">
    <div className="rounded-md border overflow-hidden"><table className="w-full text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Jurisdiction</th><th className="px-3 py-2 text-left">Timezone</th><th className="px-3 py-2 text-left">Calling window</th><th className="px-3 py-2 text-left">Consent</th><th className="px-3 py-2 text-left">Disclosure</th><th /></tr></thead><tbody>
      {isLoading ? <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Loading policies…</td></tr> : profiles.map((profile) => <tr key={profile.id} className="border-t"><td className="px-3 py-2.5"><span className="font-semibold">{profile.jurisdictionCode}</span><p className="text-xs text-muted-foreground">{profile.displayName}</p></td><td className="px-3 py-2.5 text-xs">{profile.timezone}</td><td className="px-3 py-2.5 font-mono text-xs">{profile.callingWindowStart}–{profile.callingWindowEnd}</td><td className="px-3 py-2.5 text-xs">{profile.requireConsent ? "Required" : "Not required"}</td><td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-muted-foreground">{profile.mandatoryDisclosureText || "None"}</td><td><Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => startEdit(profile)}>Edit</Button></td></tr>)}
    </tbody></table></div>
    <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>{selected && <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Edit {selected.jurisdictionCode} policy</DialogTitle><DialogDescription>Every outbound call is evaluated against this profile before a call record is created.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div><Label>Policy name</Label><Input className="mt-1" value={selected.displayName} onChange={(event) => setSelected({ ...selected, displayName: event.target.value })} /></div><div><Label>Timezone</Label><Input className="mt-1" value={selected.timezone} onChange={(event) => setSelected({ ...selected, timezone: event.target.value })} placeholder="Asia/Kolkata" /></div><div><Label>Start</Label><Input className="mt-1" type="time" value={selected.callingWindowStart} onChange={(event) => setSelected({ ...selected, callingWindowStart: event.target.value })} /></div><div><Label>End</Label><Input className="mt-1" type="time" value={selected.callingWindowEnd} onChange={(event) => setSelected({ ...selected, callingWindowEnd: event.target.value })} /></div></div><div><Label>Allowed days</Label><div className="mt-2 flex flex-wrap gap-2">{DAYS.map((day) => <Button key={day} type="button" size="sm" variant={selected.allowedDays.includes(day) ? "default" : "outline"} className="h-7 text-xs" onClick={() => setSelected({ ...selected, allowedDays: selected.allowedDays.includes(day) ? selected.allowedDays.filter((value) => value !== day) : [...selected.allowedDays, day] })}>{day}</Button>)}</div></div><div className="grid gap-3 sm:grid-cols-2"><div className="flex items-center justify-between rounded border p-3"><Label>Calling consent required</Label><Switch checked={selected.requireConsent} onCheckedChange={(value) => setSelected({ ...selected, requireConsent: value })} /></div><div className="flex items-center justify-between rounded border p-3"><Label>Recording consent required</Label><Switch checked={selected.requireRecordingConsent} onCheckedChange={(value) => setSelected({ ...selected, requireRecordingConsent: value })} /></div><div className="flex items-center justify-between rounded border p-3"><Label>Block on holidays</Label><Switch checked={selected.blockOnHoliday} onCheckedChange={(value) => setSelected({ ...selected, blockOnHoliday: value })} /></div><div className="flex items-center justify-between rounded border p-3"><Label>Profile enabled</Label><Switch checked={selected.enabled} onCheckedChange={(value) => setSelected({ ...selected, enabled: value })} /></div></div><div><Label>Mandatory disclosure (spoken first)</Label><Textarea className="mt-1" value={selected.mandatoryDisclosureText ?? ""} onChange={(event) => setSelected({ ...selected, mandatoryDisclosureText: event.target.value || null })} /></div><div><Label>Holidays (YYYY-MM-DD, one per line)</Label><Textarea className="mt-1" value={holidaysText} onChange={(event) => setHolidaysText(event.target.value)} /></div><DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending || selected.allowedDays.length === 0}>{save.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />} Save policy</Button></DialogFooter></DialogContent>}</Dialog>
  </div>;
}

function EvidenceTab() {
  const { data: evidence = [], isLoading } = useQuery({ queryKey: ["compliance-evidence"], queryFn: () => requestJson<Evidence[]>("/v1/compliance/evidence") });
  const blocked = useMemo(() => evidence.filter((entry) => entry.decision === "BLOCKED").length, [evidence]);
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground"><strong className="text-foreground">{blocked}</strong> blocked of {evidence.length} evaluated attempts shown.</p><Button variant="outline" size="sm" className="gap-1.5" onClick={() => download("/v1/compliance/evidence/export")}><Download className="w-3.5 h-3.5" /> Export CSV</Button></div><div className="rounded-md border overflow-hidden"><table className="w-full text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Decision</th><th className="px-3 py-2 text-left">Phone</th><th className="px-3 py-2 text-left">Reason</th><th className="px-3 py-2 text-left">Policy</th><th className="px-3 py-2 text-left">Evaluated</th></tr></thead><tbody>{isLoading ? <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Loading decision evidence…</td></tr> : evidence.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No decisions recorded yet.</td></tr> : evidence.map((entry) => <tr key={entry.id} className="border-t"><td className="px-3 py-2.5"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${entry.decision === "ALLOWED" ? "bg-emerald-500/15 text-emerald-700" : "bg-destructive/10 text-destructive"}`}>{entry.decision}</span></td><td className="px-3 py-2.5 font-mono text-xs">{entry.phoneNumber}</td><td className="max-w-[340px] px-3 py-2.5"><p className="text-xs font-medium">{entry.reasonCode}</p><p className="truncate text-xs text-muted-foreground">{entry.reason}</p></td><td className="px-3 py-2.5 text-xs">{entry.jurisdictionCode} · {entry.calledPartyTimezone}</td><td className="px-3 py-2.5 text-xs text-muted-foreground">{when(entry.evaluatedAt)}</td></tr>)}</tbody></table></div></div>;
}

export default function Compliance() {
  return <div className="p-6 space-y-5"><div className="flex gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary"><ShieldCheck className="w-5 h-5" /></div><div><h1 className="text-lg font-bold tracking-tight">Compliance</h1><p className="text-sm text-muted-foreground">Tenant-scoped DNC, consent, jurisdiction rules, and auditable call decisions.</p></div></div><div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground"><AlertTriangle className="mr-2 inline h-4 w-4 text-amber-600" />Outbound calls are blocked before call creation when a DNC, consent, time-window, day, or holiday rule fails.</div><Tabs defaultValue="dnc"><TabsList><TabsTrigger value="dnc">Do not call</TabsTrigger><TabsTrigger value="consents">Consent ledger</TabsTrigger><TabsTrigger value="profiles">Jurisdiction policies</TabsTrigger><TabsTrigger value="evidence">Decision evidence</TabsTrigger></TabsList><TabsContent value="dnc" className="mt-4"><DncTab /></TabsContent><TabsContent value="consents" className="mt-4"><ConsentTab /></TabsContent><TabsContent value="profiles" className="mt-4"><ProfileTab /></TabsContent><TabsContent value="evidence" className="mt-4"><EvidenceTab /></TabsContent></Tabs></div>;
}