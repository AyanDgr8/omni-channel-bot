import { useState } from "react";
import {
  useListBots,
  useCreateBot,
  useUpdateBot,
  useDeleteBot,
  getListBotsQueryKey,
} from "@workspace/api-client-react";
import type { Bot as BotType } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import BotEngineConfig from "@/components/BotEngineConfig";
import type { EngineConfig } from "@/components/BotEngineConfig";
import {
  Bot, Plus, Trash2, Edit, Wifi, WifiOff, Phone, AlertCircle,
  PhoneIncoming, PhoneOutgoing, Settings2, Globe, Clock, Mic2, Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
// Direction config shapes — mirrors lib/api-zod/src/generated/types/directionConfig.ts
interface InboundDirectionConfig {
  greeting: {
    time_of_day_variants: { morning: string; afternoon: string; evening: string; night: string };
    time_boundaries:      { morning: string; afternoon: string; evening: string; night: string };
    ai_disclosure: boolean;
    ai_disclosure_text: string;
  };
  queue_behavior: { max_ring_wait_ms: number };
  escalation: { transfer_number: string; transfer_on_request: boolean; transfer_on_frustration: boolean };
}
interface OutboundDirectionConfig {
  amd: {
    enabled: boolean;
    detection_window_ms: number;
    on_machine_detected: { crm_disposition: string; voicemail_message_id: string; wait_for_beep: boolean; hangup_after_message: boolean };
  };
  opening_script: string;
  retry_policy: { max_attempts: number; retry_interval_minutes: number };
  calling_hours: { start: string; end: string; respect_timezone: boolean };
}

const statusConfig: Record<string, { label: string; icon: React.ElementType; class: string }> = {
  ONLINE: { label: "Online", icon: Wifi, class: "text-accent" },
  OFFLINE: { label: "Offline", icon: WifiOff, class: "text-muted-foreground" },
  BUSY: { label: "Busy", icon: Phone, class: "text-yellow-400" },
  ERROR: { label: "Error", icon: AlertCircle, class: "text-destructive" },
};

const LANGUAGES = [
  { code: "en", label: "English" }, { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" }, { code: "fr", label: "French" },
  { code: "es", label: "Spanish" }, { code: "de", label: "German" },
  { code: "zh", label: "Chinese" }, { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" }, { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Dubai", "Asia/Kolkata",
  "Asia/Singapore", "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney",
];

const emptyBasicForm = {
  displayName: "", email: "", sipExtension: "", sipDomain: "", whatsappNumber: "",
  direction: "inbound" as "inbound" | "outbound",
};

const defaultInboundConfig = (): InboundDirectionConfig => ({
  greeting: {
    time_of_day_variants: {
      morning: "Good morning, thank you for calling {company}. How may I assist you today?",
      afternoon: "Good afternoon, thank you for calling {company}. How may I assist you?",
      evening: "Good evening, thank you for calling {company}. How may I help?",
      night: "Hello, thank you for calling {company}. How may I assist you?",
    },
    time_boundaries: {
      morning: "05:00-11:59", afternoon: "12:00-16:59",
      evening: "17:00-20:59", night: "21:00-04:59",
    },
    ai_disclosure: true,
    ai_disclosure_text: "You're speaking with {company}'s virtual assistant.",
  },
  queue_behavior: { max_ring_wait_ms: 30000 },
  escalation: { transfer_number: "", transfer_on_request: true, transfer_on_frustration: true },
});

const defaultOutboundConfig = (): OutboundDirectionConfig => ({
  amd: {
    enabled: true, detection_window_ms: 4000,
    on_machine_detected: { crm_disposition: "ANSWERING_MACHINE", voicemail_message_id: "", wait_for_beep: true, hangup_after_message: true },
  },
  opening_script: "",
  retry_policy: { max_attempts: 3, retry_interval_minutes: 60 },
  calling_hours: { start: "09:00", end: "20:00", respect_timezone: true },
});

type BotData = BotType;

function buildHandlingDefaults(bot: BotData | null) {
  return {
    direction: (bot?.direction as "inbound" | "outbound") ?? "inbound",
    supportedLanguages: (bot?.supportedLanguages as string[]) ?? ["en"],
    defaultGreetingLanguage: (bot?.defaultGreetingLanguage as string) ?? "en",
    timezone: (bot?.timezone as string) ?? "UTC",
    endpointSilenceMs: (bot?.endpointSilenceMs as number) ?? 1200,
    backchannelThresholdMs: (bot?.backchannelThresholdMs as number) ?? 700,
    silenceRecoverySecs: (bot?.silenceRecoverySecs as number) ?? 6,
    inboundConfig: (bot?.directionConfig && (bot.direction === "inbound"))
      ? (bot.directionConfig as unknown as InboundDirectionConfig)
      : defaultInboundConfig(),
    outboundConfig: (bot?.directionConfig && (bot.direction === "outbound"))
      ? (bot.directionConfig as unknown as OutboundDirectionConfig)
      : defaultOutboundConfig(),
  };
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Bots() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editBot, setEditBot] = useState<string | null>(null);
  const [editBotData, setEditBotData] = useState<BotData | null>(null);
  const [activeTab, setActiveTab] = useState("basic");
  const [form, setForm] = useState(emptyBasicForm);
  const [handling, setHandling] = useState(() => buildHandlingDefaults(null));

  const { data: bots, isLoading } = useListBots();
  const createMut = useCreateBot();
  const updateMut = useUpdateBot();
  const deleteMut = useDeleteBot();

  const engineMut = useMutation({
    mutationFn: async ({ id, config }: { id: string; config: EngineConfig }) => {
      const r = await fetch(`${BASE}/api/v1/bots/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          llmChainJson: config.llmChain.length > 0 ? config.llmChain : null,
          sttMapJson: Object.keys(config.sttMap).length > 0 ? config.sttMap : null,
          ttsMapJson: Object.keys(config.ttsMap).length > 0 ? config.ttsMap : null,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as Record<string, string>)?.error ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Engine config saved" });
      qc.invalidateQueries({ queryKey: getListBotsQueryKey() });
    },
    onError: (err) => {
      toast({ title: "Failed to save engine config", description: String(err.message), variant: "destructive" });
    },
  });

  function openCreate() {
    setEditBot(null);
    setEditBotData(null);
    setForm(emptyBasicForm);
    setHandling(buildHandlingDefaults(null));
    setActiveTab("basic");
    setOpen(true);
  }

  function openEdit(b: BotData) {
    setEditBot(b.id);
    setEditBotData(b);
    setForm({
      displayName: b.displayName, email: b.email ?? "",
      sipExtension: b.sipExtension, sipDomain: b.sipDomain ?? "",
      whatsappNumber: b.whatsappNumber ?? "",
      direction: (b.direction as "inbound" | "outbound") ?? "inbound",
    });
    setHandling(buildHandlingDefaults(b));
    setActiveTab("basic");
    setOpen(true);
  }

  function handleSave() {
    const dirConfig = handling.direction === "inbound" ? handling.inboundConfig : handling.outboundConfig;
    const payload = {
      displayName: form.displayName,
      email: form.email || null,
      sipExtension: form.sipExtension,
      sipDomain: form.sipDomain || null,
      whatsappNumber: form.whatsappNumber || null,
      direction: handling.direction,
      directionConfig: dirConfig as unknown as Record<string, unknown>,
      supportedLanguages: handling.supportedLanguages,
      defaultGreetingLanguage: handling.defaultGreetingLanguage,
      timezone: handling.timezone,
      endpointSilenceMs: handling.endpointSilenceMs,
      backchannelThresholdMs: handling.backchannelThresholdMs,
      silenceRecoverySecs: handling.silenceRecoverySecs,
    };

    if (editBot) {
      updateMut.mutate(
        { id: editBot, data: payload },
        {
          onSuccess: () => { toast({ title: "Bot updated" }); setOpen(false); qc.invalidateQueries({ queryKey: getListBotsQueryKey() }); },
          onError: () => toast({ title: "Failed to update bot", variant: "destructive" }),
        }
      );
    } else {
      createMut.mutate(
        { data: payload },
        {
          onSuccess: () => { toast({ title: "Bot created" }); setOpen(false); qc.invalidateQueries({ queryKey: getListBotsQueryKey() }); },
          onError: () => toast({ title: "Failed to create bot", variant: "destructive" }),
        }
      );
    }
  }

  function handleDelete(id: string) {
    deleteMut.mutate({ id }, {
      onSuccess: () => { toast({ title: "Bot deleted" }); qc.invalidateQueries({ queryKey: getListBotsQueryKey() }); },
    });
  }

  function toggleLanguage(code: string) {
    setHandling((h) => ({
      ...h,
      supportedLanguages: h.supportedLanguages.includes(code)
        ? h.supportedLanguages.filter((l) => l !== code)
        : [...h.supportedLanguages, code],
    }));
  }

  const ib = handling.inboundConfig;
  const ob = handling.outboundConfig;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground tracking-tight">Bot Network</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{(bots ?? []).length} registered agents</p>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5 text-xs">
          <Plus className="w-3 h-3" /> Register Bot
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading...</div>
      ) : !bots?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Bot className="w-8 h-8 opacity-30" />
          <p className="text-sm">No bots registered yet</p>
          <Button size="sm" onClick={openCreate} variant="outline" className="text-xs">Register your first bot</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {bots.map((bot) => {
            const sc = statusConfig[bot.status] ?? statusConfig.OFFLINE;
            const StatusIcon = sc.icon;
            const dir = (bot.direction as string) ?? "inbound";
            const isInbound = dir === "inbound";
            return (
              <div key={bot.id} className="bg-card border border-card-border rounded p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded bg-primary/15 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-foreground">{bot.displayName}</p>
                        <Badge
                          variant="outline"
                          className={`text-[9px] h-4 px-1.5 gap-0.5 font-medium ${isInbound ? "border-primary/40 text-primary bg-primary/8" : "border-accent/40 text-accent bg-accent/8"}`}
                        >
                          {isInbound ? <PhoneIncoming className="w-2.5 h-2.5" /> : <PhoneOutgoing className="w-2.5 h-2.5" />}
                          {isInbound ? "Inbound" : "Outbound"}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground font-mono">ext. {bot.sipExtension}</p>
                    </div>
                  </div>
                  <div className={`flex items-center gap-1 ${sc.class}`}>
                    <StatusIcon className="w-3 h-3" />
                    <span className="text-[10px] font-medium">{sc.label}</span>
                  </div>
                </div>
                <div className="space-y-1 text-[11px]">
                  {bot.email && <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="text-foreground truncate max-w-[140px]">{bot.email}</span></div>}
                  {bot.sipDomain && <div className="flex justify-between"><span className="text-muted-foreground">SIP Domain</span><span className="text-foreground truncate max-w-[140px]">{bot.sipDomain}</span></div>}
                  {bot.whatsappNumber && <div className="flex justify-between"><span className="text-muted-foreground">WhatsApp</span><span className="text-foreground font-mono">{bot.whatsappNumber}</span></div>}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Active Calls</span>
                    <span className="text-foreground font-medium tabular-nums">{bot.activeCalls}</span>
                  </div>
                  {(bot.timezone as string) && (bot.timezone as string) !== "UTC" && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Timezone</span>
                      <span className="text-foreground">{bot.timezone as string}</span>
                    </div>
                  )}
                  {(bot.supportedLanguages as string[] | undefined)?.length && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Languages</span>
                      <span className="text-foreground">{(bot.supportedLanguages as string[]).join(", ").toUpperCase()}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 pt-1 border-t border-border">
                  <Button size="sm" variant="ghost" className="text-[11px] h-6 px-2 gap-1" onClick={() => openEdit(bot)}>
                    <Edit className="w-3 h-3" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-[11px] h-6 px-2 gap-1" onClick={() => { openEdit(bot); setActiveTab("handling"); }}>
                    <Settings2 className="w-3 h-3" /> Call Handling
                  </Button>
                  <Button size="sm" variant="ghost" className="text-[11px] h-6 px-2 gap-1 text-destructive hover:text-destructive ml-auto" onClick={() => handleDelete(bot.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bot Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Bot className="w-4 h-4 text-primary" />
              {editBot ? "Edit Bot" : "Register Bot"}
            </DialogTitle>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full text-xs h-8">
              <TabsTrigger value="basic" className="text-xs flex-1">Basic Info</TabsTrigger>
              <TabsTrigger value="handling" className="text-xs flex-1 gap-1">
                <Settings2 className="w-3 h-3" /> Call Handling
              </TabsTrigger>
              {editBot && (
                <TabsTrigger value="engine" className="text-xs flex-1 gap-1">
                  <Cpu className="w-3 h-3" /> Engine
                </TabsTrigger>
              )}
            </TabsList>

            {/* ── Basic Info ─────────────────────────────────────── */}
            <TabsContent value="basic" className="space-y-3 pt-3">
              {[
                { label: "Display Name *", key: "displayName", placeholder: "Aria" },
                { label: "SIP Extension *", key: "sipExtension", placeholder: "1001" },
                { label: "Email", key: "email", placeholder: "aria@company.com" },
                { label: "SIP Domain", key: "sipDomain", placeholder: "pbx.company.com" },
                { label: "WhatsApp Number", key: "whatsappNumber", placeholder: "+911234567890" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <Label className="text-xs">{label}</Label>
                  <Input
                    className="mt-1 text-xs"
                    placeholder={placeholder}
                    value={(form as Record<string, string>)[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}

              <div>
                <Label className="text-xs">Direction</Label>
                <Select
                  value={handling.direction}
                  onValueChange={(v: "inbound" | "outbound") => setHandling((h) => ({ ...h, direction: v }))}
                >
                  <SelectTrigger className="mt-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inbound" className="text-xs">
                      <span className="flex items-center gap-1.5"><PhoneIncoming className="w-3 h-3 text-primary" /> Inbound Agent</span>
                    </SelectItem>
                    <SelectItem value="outbound" className="text-xs">
                      <span className="flex items-center gap-1.5"><PhoneOutgoing className="w-3 h-3 text-accent" /> Outbound Agent</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {handling.direction === "inbound"
                    ? "Receives incoming calls. Time-of-day greeting, escalation rules, and AI disclosure."
                    : "Initiates outbound calls. AMD detection, calling hours, voicemail, retry policy."}
                </p>
              </div>
            </TabsContent>

            {/* ── Call Handling ───────────────────────────────────── */}
            <TabsContent value="handling" className="space-y-4 pt-3">

              {/* Shared — Languages */}
              <section className="space-y-2.5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Globe className="w-3 h-3" /> Language
                </p>
                <div>
                  <Label className="text-xs">Supported Languages</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {LANGUAGES.map(({ code, label }) => {
                      const on = handling.supportedLanguages.includes(code);
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => toggleLanguage(code)}
                          className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${on ? "bg-primary/15 border-primary/40 text-primary" : "bg-muted border-border text-muted-foreground hover:border-primary/30"}`}
                        >
                          {code.toUpperCase()} · {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Greeting Language</Label>
                    <Select
                      value={handling.defaultGreetingLanguage}
                      onValueChange={(v) => setHandling((h) => ({ ...h, defaultGreetingLanguage: v }))}
                    >
                      <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.filter((l) => handling.supportedLanguages.includes(l.code)).map(({ code, label }) => (
                          <SelectItem key={code} value={code} className="text-xs">{label} ({code.toUpperCase()})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs flex items-center gap-1"><Clock className="w-3 h-3" /> Timezone</Label>
                    <Select
                      value={handling.timezone}
                      onValueChange={(v) => setHandling((h) => ({ ...h, timezone: v }))}
                    >
                      <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz} value={tz} className="text-xs">{tz}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

              {/* Direction-specific */}
              {handling.direction === "inbound" ? (
                <section className="space-y-2.5 border-t border-border pt-4">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <PhoneIncoming className="w-3 h-3" /> Inbound Settings
                  </p>

                  {/* Time-of-day greetings */}
                  {(["morning", "afternoon", "evening", "night"] as const).map((band) => (
                    <div key={band}>
                      <Label className="text-xs capitalize">{band} Greeting</Label>
                      <Textarea
                        className="mt-1 text-xs min-h-[52px] resize-none"
                        placeholder={`Good ${band}, thank you for calling {company}...`}
                        value={ib.greeting.time_of_day_variants[band]}
                        onChange={(e) => setHandling((h) => ({
                          ...h,
                          inboundConfig: {
                            ...ib,
                            greeting: {
                              ...ib.greeting,
                              time_of_day_variants: { ...ib.greeting.time_of_day_variants, [band]: e.target.value }
                            }
                          }
                        }))}
                      />
                    </div>
                  ))}

                  <div className="flex items-center justify-between py-1">
                    <div>
                      <Label className="text-xs">AI Disclosure</Label>
                      <p className="text-[10px] text-muted-foreground">Inform caller they're speaking with an AI</p>
                    </div>
                    <Switch
                      checked={ib.greeting.ai_disclosure}
                      onCheckedChange={(v) => setHandling((h) => ({
                        ...h,
                        inboundConfig: { ...ib, greeting: { ...ib.greeting, ai_disclosure: v } }
                      }))}
                    />
                  </div>
                  {ib.greeting.ai_disclosure && (
                    <div>
                      <Label className="text-xs">Disclosure Text</Label>
                      <Input
                        className="mt-1 text-xs"
                        placeholder="You're speaking with {company}'s virtual assistant."
                        value={ib.greeting.ai_disclosure_text}
                        onChange={(e) => setHandling((h) => ({
                          ...h,
                          inboundConfig: { ...ib, greeting: { ...ib.greeting, ai_disclosure_text: e.target.value } }
                        }))}
                      />
                    </div>
                  )}

                  <div>
                    <Label className="text-xs">Transfer Number (escalation)</Label>
                    <Input
                      className="mt-1 text-xs font-mono"
                      placeholder="+441234567890"
                      value={ib.escalation.transfer_number}
                      onChange={(e) => setHandling((h) => ({
                        ...h,
                        inboundConfig: { ...ib, escalation: { ...ib.escalation, transfer_number: e.target.value } }
                      }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Transfer on request</Label>
                      <Switch
                        checked={ib.escalation.transfer_on_request}
                        onCheckedChange={(v) => setHandling((h) => ({
                          ...h,
                          inboundConfig: { ...ib, escalation: { ...ib.escalation, transfer_on_request: v } }
                        }))}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Transfer on frustration</Label>
                      <Switch
                        checked={ib.escalation.transfer_on_frustration}
                        onCheckedChange={(v) => setHandling((h) => ({
                          ...h,
                          inboundConfig: { ...ib, escalation: { ...ib.escalation, transfer_on_frustration: v } }
                        }))}
                      />
                    </div>
                  </div>
                </section>
              ) : (
                <section className="space-y-2.5 border-t border-border pt-4">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <PhoneOutgoing className="w-3 h-3" /> Outbound Settings
                  </p>

                  <div className="flex items-center justify-between py-1">
                    <div>
                      <Label className="text-xs">Answering Machine Detection</Label>
                      <p className="text-[10px] text-muted-foreground">Classify call as human, voicemail, or IVR</p>
                    </div>
                    <Switch
                      checked={ob.amd.enabled}
                      onCheckedChange={(v) => setHandling((h) => ({
                        ...h,
                        outboundConfig: { ...ob, amd: { ...ob.amd, enabled: v } }
                      }))}
                    />
                  </div>

                  {ob.amd.enabled && (
                    <>
                      <div className="flex items-center justify-between py-1">
                        <Label className="text-xs">Leave voicemail on machine</Label>
                        <Switch
                          checked={ob.amd.on_machine_detected.hangup_after_message}
                          onCheckedChange={(v) => setHandling((h) => ({
                            ...h,
                            outboundConfig: {
                              ...ob,
                              amd: { ...ob.amd, on_machine_detected: { ...ob.amd.on_machine_detected, hangup_after_message: v } }
                            }
                          }))}
                        />
                      </div>
                      <div className="flex items-center justify-between py-1">
                        <Label className="text-xs">Wait for beep before leaving message</Label>
                        <Switch
                          checked={ob.amd.on_machine_detected.wait_for_beep}
                          onCheckedChange={(v) => setHandling((h) => ({
                            ...h,
                            outboundConfig: {
                              ...ob,
                              amd: { ...ob.amd, on_machine_detected: { ...ob.amd.on_machine_detected, wait_for_beep: v } }
                            }
                          }))}
                        />
                      </div>
                    </>
                  )}

                  <div>
                    <Label className="text-xs">Opening Script</Label>
                    <Textarea
                      className="mt-1 text-xs min-h-[60px] resize-none"
                      placeholder="Hello, this is {company} calling regarding your recent enquiry..."
                      value={ob.opening_script}
                      onChange={(e) => setHandling((h) => ({
                        ...h,
                        outboundConfig: { ...ob, opening_script: e.target.value }
                      }))}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Calling Hours Start</Label>
                      <Input
                        className="mt-1 text-xs"
                        type="time"
                        value={ob.calling_hours.start}
                        onChange={(e) => setHandling((h) => ({
                          ...h,
                          outboundConfig: { ...ob, calling_hours: { ...ob.calling_hours, start: e.target.value } }
                        }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Calling Hours End</Label>
                      <Input
                        className="mt-1 text-xs"
                        type="time"
                        value={ob.calling_hours.end}
                        onChange={(e) => setHandling((h) => ({
                          ...h,
                          outboundConfig: { ...ob, calling_hours: { ...ob.calling_hours, end: e.target.value } }
                        }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Max Retry Attempts</Label>
                      <Input
                        className="mt-1 text-xs"
                        type="number" min={1} max={10}
                        value={ob.retry_policy.max_attempts}
                        onChange={(e) => setHandling((h) => ({
                          ...h,
                          outboundConfig: { ...ob, retry_policy: { ...ob.retry_policy, max_attempts: +e.target.value } }
                        }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Retry Interval (min)</Label>
                      <Input
                        className="mt-1 text-xs"
                        type="number" min={5}
                        value={ob.retry_policy.retry_interval_minutes}
                        onChange={(e) => setHandling((h) => ({
                          ...h,
                          outboundConfig: { ...ob, retry_policy: { ...ob.retry_policy, retry_interval_minutes: +e.target.value } }
                        }))}
                      />
                    </div>
                  </div>
                </section>
              )}

              {/* Shared — Conversation tunables */}
              <section className="space-y-3 border-t border-border pt-4">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Mic2 className="w-3 h-3" /> Conversation Intelligence
                </p>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <Label className="text-xs">Endpoint silence window</Label>
                    <span className="text-[11px] text-primary font-mono">{handling.endpointSilenceMs}ms</span>
                  </div>
                  <Slider
                    min={800} max={2000} step={50}
                    value={[handling.endpointSilenceMs]}
                    onValueChange={([v]) => setHandling((h) => ({ ...h, endpointSilenceMs: v }))}
                  />
                  <p className="text-[10px] text-muted-foreground">Silence after caller stops before bot replies (800–2000ms)</p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <Label className="text-xs">Backchannel threshold</Label>
                    <span className="text-[11px] text-primary font-mono">{handling.backchannelThresholdMs}ms</span>
                  </div>
                  <Slider
                    min={200} max={1200} step={50}
                    value={[handling.backchannelThresholdMs]}
                    onValueChange={([v]) => setHandling((h) => ({ ...h, backchannelThresholdMs: v }))}
                  />
                  <p className="text-[10px] text-muted-foreground">Caller utterances shorter than this are treated as "hmm / okay" — not an interruption</p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <Label className="text-xs">Silence recovery prompt</Label>
                    <span className="text-[11px] text-primary font-mono">{handling.silenceRecoverySecs}s</span>
                  </div>
                  <Slider
                    min={3} max={15} step={1}
                    value={[handling.silenceRecoverySecs]}
                    onValueChange={([v]) => setHandling((h) => ({ ...h, silenceRecoverySecs: v }))}
                  />
                  <p className="text-[10px] text-muted-foreground">Seconds of silence before "Are you still there?" prompt</p>
                </div>
              </section>
            </TabsContent>

            {/* ── Engine Config ────────────────────────────────── */}
            {editBot && (
              <TabsContent value="engine" className="space-y-4 pt-3">
                <BotEngineConfig
                  botId={editBot}
                  supportedLanguages={handling.supportedLanguages}
                  saving={engineMut.isPending}
                  onSave={(cfg) => engineMut.mutate({ id: editBot, config: cfg })}
                />
              </TabsContent>
            )}
          </Tabs>

          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} className="text-xs">Cancel</Button>
            {activeTab !== "engine" && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!form.displayName || !form.sipExtension || createMut.isPending || updateMut.isPending}
                className="text-xs"
              >
                {editBot ? "Save Changes" : "Register"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
