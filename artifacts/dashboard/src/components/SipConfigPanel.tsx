import React, { useState, useEffect, useRef } from "react";
import {
  useGetSipConfig,
  useUpdateSipConfig,
  useGetSipStatus,
  useGetSipHealth,
  useListSipEvents,
  useRegisterSip,
  useUnregisterSip,
  useTestSipCall,
  getGetSipConfigQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import type { 
  SipConfigInputCodecsItem, 
  SipConfigInput,
  SipConfigInputTransport,
  SipConfigInputDtmfMode,
  SipConfigInputSrtpMode,
  SipConfigInputNatTraversal
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, Clock, Copy, Download, Phone, RefreshCw, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

interface SipConfigPanelProps {
  botId: string;
}

const emptyConfig = {
  enabled: true,
  sipDomain: "",
  registrarHost: "",
  registrarPort: 5060,
  transport: "udp" as SipConfigInputTransport,
  extension: "",
  authUsername: "",
  password: "",
  displayName: "",
  callerIdNumber: "",
  outboundProxyHost: "",
  outboundProxyPort: 5060,
  keepaliveIntervalSeconds: 30,
  dtmfMode: "rfc2833" as SipConfigInputDtmfMode,
  srtpMode: "disabled" as SipConfigInputSrtpMode,
  ptimeMs: 20,
  natTraversal: "none" as SipConfigInputNatTraversal,
  stunServer: "",
  localBindIp: "",
  externalIp: "",
  maxConcurrentCalls: 10,
  answerDelayMs: 0,
  recordCalls: false,
  outboundPrefix: "",
  debugLogging: false,
  registerExpirySeconds: 3600,
  codecs: ["OPUS", "PCMU", "PCMA"] as SipConfigInputCodecsItem[],
  rtpPortMin: 10000,
  rtpPortMax: 20000,
  inboundDids: [] as string[],
  outboundEnabled: true,
  allowSelfSigned: false,
};

export default function SipConfigPanel({ botId }: SipConfigPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data: config, isLoading: isConfigLoading } = useGetSipConfig(botId, {
    query: {
      enabled: !!botId,
      queryKey: getGetSipConfigQueryKey(botId),
    }
  });

  const { data: statusData } = useGetSipStatus(botId, {
    query: {
      enabled: !!botId,
      queryKey: ["sipStatus", botId],
      refetchInterval: 5000, // Poll every 5s
    }
  });

  const { data: healthData } = useGetSipHealth({
    query: {
      queryKey: ["sipHealth"],
      refetchInterval: 30000,
    }
  });

  const [eventLevel, setEventLevel] = useState<"debug" | "info" | "warn" | "error" | "all">("all");

  const { data: eventsData, refetch: refetchEvents } = useListSipEvents(botId, { 
    limit: 200, 
    ...(eventLevel !== "all" ? { level: eventLevel } : {}) 
  }, {
    query: {
      enabled: !!botId,
      queryKey: ["sipEvents", botId, eventLevel],
      refetchInterval: 5000,
    }
  });

  const updateMut = useUpdateSipConfig();
  const registerMut = useRegisterSip();
  const unregisterMut = useUnregisterSip();
  const testCallMut = useTestSipCall();

  const [form, setForm] = useState(emptyConfig);
  const [didInput, setDidInput] = useState("");
  const [testNumber, setTestNumber] = useState("");
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const initRef = useRef<string | null>(null);

  useEffect(() => {
    if (config && initRef.current !== botId) {
      initRef.current = botId;
      setForm({
        enabled: config.enabled,
        sipDomain: config.sipDomain || "",
        registrarHost: config.registrarHost || "",
        registrarPort: config.registrarPort || 5060,
        transport: config.transport || "udp",
        extension: config.extension || "",
        authUsername: config.authUsername || "",
        password: "", // write-only
        displayName: config.displayName || "",
        callerIdNumber: config.callerIdNumber || "",
        outboundProxyHost: config.outboundProxyHost || "",
        outboundProxyPort: config.outboundProxyPort || 5060,
        keepaliveIntervalSeconds: config.keepaliveIntervalSeconds || 30,
        dtmfMode: config.dtmfMode || "rfc2833",
        srtpMode: config.srtpMode || "disabled",
        ptimeMs: config.ptimeMs || 20,
        natTraversal: config.natTraversal || "none",
        stunServer: config.stunServer || "",
        localBindIp: config.localBindIp || "",
        externalIp: config.externalIp || "",
        maxConcurrentCalls: config.maxConcurrentCalls || 10,
        answerDelayMs: config.answerDelayMs || 0,
        recordCalls: config.recordCalls || false,
        outboundPrefix: config.outboundPrefix || "",
        debugLogging: config.debugLogging || false,
        registerExpirySeconds: config.registerExpirySeconds || 3600,
        codecs: config.codecs?.length ? config.codecs : ["OPUS", "PCMU", "PCMA"],
        rtpPortMin: config.rtpPortMin || 10000,
        rtpPortMax: config.rtpPortMax || 20000,
        inboundDids: config.inboundDids || [],
        outboundEnabled: config.outboundEnabled ?? true,
        allowSelfSigned: config.allowSelfSigned || false,
      });
    }
  }, [config, botId]);

  if (isConfigLoading) {
    return <div className="py-4 text-xs text-muted-foreground text-center">Loading SIP Configuration...</div>;
  }

  const handleSave = () => {
    if (!form.registrarHost || !form.extension || !form.authUsername) {
      toast({ title: "Validation Error", description: "Host, Extension, and Auth Username are required.", variant: "destructive" });
      return;
    }
    if (form.registrarPort < 1 || form.registrarPort > 65535) {
      toast({ title: "Validation Error", description: "Registrar Port must be between 1 and 65535.", variant: "destructive" });
      return;
    }
    if (form.outboundProxyPort < 1 || form.outboundProxyPort > 65535) {
      toast({ title: "Validation Error", description: "Outbound Proxy Port must be between 1 and 65535.", variant: "destructive" });
      return;
    }
    if (form.rtpPortMin < 1 || form.rtpPortMax > 65535 || form.rtpPortMin >= form.rtpPortMax) {
      toast({ title: "Validation Error", description: "RTP ports must be valid ranges between 1 and 65535.", variant: "destructive" });
      return;
    }
    if (form.rtpPortMin % 2 !== 0 || form.rtpPortMax % 2 !== 0 || form.rtpPortMin < 100) {
      toast({ title: "Validation Error", description: "RTP ports must be even numbers >= 100.", variant: "destructive" });
      return;
    }

    if (form.rtpPortMax - form.rtpPortMin < 100) {
      toast({ title: "Validation Error", description: "RTP port range must be at least 100 ports wide.", variant: "destructive" });
      return;
    }
    if (form.registerExpirySeconds < 60) {
      toast({ title: "Validation Error", description: "Register expiry must be >= 60 seconds.", variant: "destructive" });
      return;
    }

    const payload: SipConfigInput = {
      ...form,
      password: form.password ? form.password : undefined,
    };

    updateMut.mutate({ id: botId, data: payload }, {
      onSuccess: () => {
        toast({ title: "SIP Configuration Saved" });
        qc.invalidateQueries({ queryKey: getGetSipConfigQueryKey(botId) });
      },
      onError: (err) => {
        toast({ title: "Failed to save", description: String(err), variant: "destructive" });
      }
    });
  };

  const handleAction = (action: 'register' | 'unregister') => {
    const opts = {
      onSuccess: () => {
        toast({ title: `Action ${action} successful` });
        qc.invalidateQueries({ queryKey: ["sipStatus", botId] });
      },
      onError: (err: any) => {
        toast({ title: `Action ${action} failed`, description: String(err), variant: "destructive" });
      }
    };
    if (action === 'register') registerMut.mutate({ id: botId }, opts);
    if (action === 'unregister') unregisterMut.mutate({ id: botId }, opts);
  };

  const handleTestCall = () => {
    if (!testNumber) {
        toast({ title: "Validation Error", description: "Enter a test number.", variant: "destructive" });
        return;
    }
    testCallMut.mutate({ id: botId, data: { to: testNumber } }, {
        onSuccess: () => {
            toast({ title: "Test Call Initiated" });
            setTestDialogOpen(false);
        },
        onError: (err) => {
            toast({ title: "Test Call Failed", description: String(err), variant: "destructive" });
        }
    });
  };

  const copyInstructions = () => {
    const text = `PBX SIP Trunk Instructions for ${form.displayName || 'Bot'}:
Host: ${form.registrarHost}:${form.registrarPort}
Domain: ${form.sipDomain || form.registrarHost}
Transport: ${form.transport.toUpperCase()}
Extension: ${form.extension}
Auth Username: ${form.authUsername}
Codecs: ${form.codecs.join(', ')}
    `;
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const moveCodec = (index: number, dir: -1 | 1) => {
    const newCodecs = [...form.codecs];
    if (index + dir < 0 || index + dir >= newCodecs.length) return;
    const temp = newCodecs[index];
    newCodecs[index] = newCodecs[index + dir];
    newCodecs[index + dir] = temp;
    setForm({ ...form, codecs: newCodecs });
  };

  const addDid = () => {
    if (didInput && !form.inboundDids.includes(didInput)) {
      if (!/^(?:\+[1-9][0-9]{7,14}|\+[1-9][0-9]{0,14}\*)$/.test(didInput)) {
        toast({ title: "Invalid DID", description: "Must be E.164 (e.g. +1234567890) or a prefix ending in * (e.g. +1234*).", variant: "destructive" });
        return;
      }
      setForm({ ...form, inboundDids: [...form.inboundDids, didInput] });
      setDidInput("");
    }
  };
  const removeDid = (did: string) => {
    setForm({ ...form, inboundDids: form.inboundDids.filter(d => d !== did) });
  };

  const downloadLogs = () => {
    if (!eventsData?.length) return;
    const text = eventsData.map(e => `[${new Date(e.timestamp).toISOString()}] ${e.summary} - ${e.rawSnippet || ""}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sip-events-${botId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Service Health Warning */}
      {healthData && (!healthData.enabled || !healthData.reachable) && (
        <Card className="p-4 bg-destructive/10 border-destructive/30 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-destructive">SIP Service Unavailable</h4>
            <p className="text-xs text-destructive/80 mt-1">
              {!healthData.enabled ? "SIP features are disabled globally for this deployment." : "The SIP gateway is currently unreachable. Registrations and calls will fail."}
            </p>
          </div>
        </Card>
      )}

      {/* Registration Status */}
      <Card className="p-4 bg-muted/30 flex items-center justify-between border-border">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Status</p>
          <div className="flex items-center gap-2">
            {statusData?.registrationState === 'registered' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> :
             statusData?.registrationState === 'failed' ? <XCircle className="w-4 h-4 text-destructive" /> :
             statusData?.registrationState === 'registering' ? <RefreshCw className="w-4 h-4 text-primary animate-spin" /> :
             <AlertCircle className="w-4 h-4 text-muted-foreground" />}
            <span className="text-sm font-medium capitalize">{statusData?.registrationState || "Unknown"}</span>
          </div>
          {statusData?.lastRegisteredAt && (
             <p className="text-[10px] text-muted-foreground mt-1">Last registered: {new Date(statusData.lastRegisteredAt).toLocaleString()}</p>
          )}
          {statusData?.activeCalls !== undefined && (
             <p className="text-[10px] text-muted-foreground mt-0.5">Active calls: {statusData.activeCalls}</p>
          )}
          {statusData?.lastError && <p className="text-[11px] text-destructive mt-1 max-w-[300px] truncate" title={statusData.lastError}>{statusData.lastError}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleAction('unregister')} disabled={statusData?.registrationState !== 'registered' || unregisterMut.isPending}>
            {unregisterMut.isPending ? "Unregistering..." : "Unregister"}
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1" onClick={() => handleAction('register')} disabled={statusData?.registrationState === 'registered' || statusData?.registrationState === 'registering' || registerMut.isPending}>
            {registerMut.isPending ? "Registering..." : "Register"}
          </Button>
          <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
              <DialogTrigger asChild>
                  <Button size="sm" variant="secondary" className="h-8 text-xs gap-1" disabled={statusData?.registrationState !== 'registered'}>
                      <Phone className="w-3 h-3"/> Test Call
                  </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[320px]">
                  <DialogHeader>
                      <DialogTitle className="text-sm">Initiate Test Call</DialogTitle>
                  </DialogHeader>
                  <div className="py-2">
                      <Label className="text-xs">Target Number</Label>
                      <Input className="mt-1 h-8 text-xs" value={testNumber} onChange={e => setTestNumber(e.target.value)} placeholder="+1234567890" />
                  </div>
                  <DialogFooter>
                      <Button size="sm" className="text-xs h-8" onClick={handleTestCall} disabled={testCallMut.isPending}>Call</Button>
                  </DialogFooter>
              </DialogContent>
          </Dialog>
        </div>
      </Card>

      <Accordion type="multiple" className="w-full" defaultValue={["registration"]}>
        <AccordionItem value="registration">
          <AccordionTrigger className="text-sm font-medium">Registration Details</AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Registrar Host *</Label>
                <Input className="mt-1 text-xs h-8" value={form.registrarHost} onChange={e => setForm({...form, registrarHost: e.target.value})} placeholder="pbx.company.com" />
              </div>
              <div>
                <Label className="text-xs">Registrar Port *</Label>
                <Input className="mt-1 text-xs h-8" type="number" value={form.registrarPort} onChange={e => setForm({...form, registrarPort: Number(e.target.value)})} />
              </div>
              <div>
                <Label className="text-xs">SIP Domain</Label>
                <Input className="mt-1 text-xs h-8" value={form.sipDomain} onChange={e => setForm({...form, sipDomain: e.target.value})} placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs">Transport</Label>
                <Select value={form.transport} onValueChange={(v: any) => setForm({...form, transport: v})}>
                  <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['udp', 'tcp', 'tls', 'wss'].map(t => <SelectItem key={t} value={t} className="text-xs uppercase">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Outbound Proxy Host</Label>
                <Input className="mt-1 text-xs h-8" value={form.outboundProxyHost} onChange={e => setForm({...form, outboundProxyHost: e.target.value})} placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs">Outbound Proxy Port</Label>
                <Input className="mt-1 text-xs h-8" type="number" value={form.outboundProxyPort} onChange={e => setForm({...form, outboundProxyPort: Number(e.target.value)})} />
              </div>
            </div>
            <div className="flex justify-end mt-2">
                <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 px-2" onClick={copyInstructions}><Copy className="w-3 h-3" /> Copy PBX Instructions</Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="auth">
          <AccordionTrigger className="text-sm font-medium">Authentication</AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Extension *</Label>
                <Input className="mt-1 text-xs h-8" value={form.extension} onChange={e => setForm({...form, extension: e.target.value})} />
              </div>
              <div>
                <Label className="text-xs">Display Name</Label>
                <Input className="mt-1 text-xs h-8" value={form.displayName} onChange={e => setForm({...form, displayName: e.target.value})} />
              </div>
              <div>
                <Label className="text-xs">Caller ID</Label>
                <Input className="mt-1 text-xs h-8" value={form.callerIdNumber} onChange={e => setForm({...form, callerIdNumber: e.target.value})} placeholder="e.g. +1234567890" />
              </div>
              <div>
                <Label className="text-xs">Auth Username *</Label>
                <Input className="mt-1 text-xs h-8" value={form.authUsername} onChange={e => setForm({...form, authUsername: e.target.value})} />
              </div>
              {(user?.role === "ADMIN" || user?.role === "OWNER") && (
                <div>
                  <Label className="text-xs">Password</Label>
                  <PasswordInput className="mt-1 text-xs h-8" placeholder={config?.passwordIsSet ? "•••••••• (Leave blank to keep)" : "Enter password"} value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
                  {config?.passwordIsSet && form.password.length === 0 && config.passwordMasked && (
                    <p className="text-[10px] text-muted-foreground mt-1">Current: {config.passwordMasked}</p>
                  )}
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="media">
          <AccordionTrigger className="text-sm font-medium">Media & Codecs</AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <div>
              <Label className="text-xs">Codecs (Order matters)</Label>
              <div className="mt-2 space-y-1.5 border border-border rounded-md p-1 bg-muted/10">
                {form.codecs.map((codec, idx) => (
                  <div key={codec} className="flex items-center justify-between bg-card px-2 py-1.5 rounded border border-border/50 text-xs">
                    <span className="font-mono">{codec}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="w-5 h-5" onClick={() => moveCodec(idx, -1)} disabled={idx === 0}><ArrowUp className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="icon" className="w-5 h-5" onClick={() => moveCodec(idx, 1)} disabled={idx === form.codecs.length - 1}><ArrowDown className="w-3 h-3" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <Label className="text-xs">DTMF Mode</Label>
                <Select value={form.dtmfMode} onValueChange={(v: any) => setForm({...form, dtmfMode: v})}>
                  <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['rfc2833', 'sip_info', 'inband'].map(t => <SelectItem key={t} value={t} className="text-xs uppercase">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">SRTP Mode</Label>
                <Select value={form.srtpMode} onValueChange={(v: any) => setForm({...form, srtpMode: v})}>
                  <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['disabled', 'optional', 'required'].map(t => <SelectItem key={t} value={t} className="text-xs uppercase">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Ptime (ms)</Label>
                <Input className="mt-1 text-xs h-8" type="number" value={form.ptimeMs} onChange={e => setForm({...form, ptimeMs: Number(e.target.value)})} />
              </div>
              <div className="flex items-center justify-between border border-border p-2 rounded-md">
                <Label className="text-xs">Record Calls</Label>
                <Switch checked={form.recordCalls} onCheckedChange={v => setForm({...form, recordCalls: v})} />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="nat">
          <AccordionTrigger className="text-sm font-medium">NAT & Network</AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">RTP Port Min</Label>
                <Input className="mt-1 text-xs h-8" type="number" value={form.rtpPortMin} onChange={e => setForm({...form, rtpPortMin: Number(e.target.value)})} />
              </div>
              <div>
                <Label className="text-xs">RTP Port Max</Label>
                <Input className="mt-1 text-xs h-8" type="number" value={form.rtpPortMax} onChange={e => setForm({...form, rtpPortMax: Number(e.target.value)})} />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">Ports must be even numbers {'>='} 100.</p>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <Label className="text-xs">NAT Traversal Mode</Label>
                <Select value={form.natTraversal} onValueChange={(v: any) => setForm({...form, natTraversal: v})}>
                  <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['none', 'stun', 'force_rport'].map(t => <SelectItem key={t} value={t} className="text-xs uppercase">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">STUN Server</Label>
                <Input className="mt-1 text-xs h-8" value={form.stunServer} onChange={e => setForm({...form, stunServer: e.target.value})} placeholder="stun.l.google.com:19302" />
              </div>
              <div>
                <Label className="text-xs">Local Bind IP</Label>
                <Input className="mt-1 text-xs h-8" value={form.localBindIp} onChange={e => setForm({...form, localBindIp: e.target.value})} placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs">External IP</Label>
                <Input className="mt-1 text-xs h-8" value={form.externalIp} onChange={e => setForm({...form, externalIp: e.target.value})} placeholder="Optional" />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="advanced">
          <AccordionTrigger className="text-sm font-medium">Advanced</AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Register Expiry (sec)</Label>
                <Input className="mt-1 text-xs h-8" type="number" value={form.registerExpirySeconds} onChange={e => setForm({...form, registerExpirySeconds: Number(e.target.value)})} />
              </div>
              <div>
                <Label className="text-xs">Keepalive (sec)</Label>
                <Input className="mt-1 text-xs h-8" type="number" value={form.keepaliveIntervalSeconds} onChange={e => setForm({...form, keepaliveIntervalSeconds: Number(e.target.value)})} />
              </div>
              <div>
                <Label className="text-xs">Max Concurrent Calls</Label>
                <Input className="mt-1 text-xs h-8" type="number" value={form.maxConcurrentCalls} onChange={e => setForm({...form, maxConcurrentCalls: Number(e.target.value)})} />
              </div>
              <div>
                <Label className="text-xs">Answer Delay (ms)</Label>
                <Input className="mt-1 text-xs h-8" type="number" value={form.answerDelayMs} onChange={e => setForm({...form, answerDelayMs: Number(e.target.value)})} />
              </div>
              <div>
                <Label className="text-xs">Outbound Prefix</Label>
                <Input className="mt-1 text-xs h-8" value={form.outboundPrefix} onChange={e => setForm({...form, outboundPrefix: e.target.value})} placeholder="e.g. 9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="flex items-center justify-between border border-border p-2 rounded-md">
                <Label className="text-xs">Outbound Calling Enabled</Label>
                <Switch checked={form.outboundEnabled} onCheckedChange={v => setForm({...form, outboundEnabled: v})} />
              </div>
              <div className="flex items-center justify-between border border-border p-2 rounded-md">
                <Label className="text-xs text-destructive">Allow Self-Signed Certs</Label>
                <Switch checked={form.allowSelfSigned} onCheckedChange={v => setForm({...form, allowSelfSigned: v})} />
              </div>
              <div className="flex items-center justify-between border border-border p-2 rounded-md">
                <Label className="text-xs text-muted-foreground">Debug Mode</Label>
                <Switch checked={form.debugLogging} onCheckedChange={v => setForm({...form, debugLogging: v})} />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Inbound DIDs</Label>
              <div className="flex gap-2">
                <Input className="text-xs h-8" value={didInput} onChange={e => setDidInput(e.target.value)} placeholder="+1234567890 or +123*" onKeyDown={e => e.key === 'Enter' && addDid()} />
                <Button size="sm" className="h-8 text-xs" onClick={addDid}>Add</Button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {form.inboundDids.map(did => (
                  <Badge key={did} variant="secondary" className="text-[10px] py-0 h-5 gap-1 pr-1">
                    {did}
                    <XCircle className="w-3 h-3 cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => removeDid(did)} />
                  </Badge>
                ))}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="logs">
          <AccordionTrigger className="text-sm font-medium">Status & Logs</AccordionTrigger>
          <AccordionContent className="space-y-2 pt-2">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Select value={eventLevel} onValueChange={(v: any) => setEventLevel(v)}>
                  <SelectTrigger className="h-6 text-[10px] w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[10px]">All Levels</SelectItem>
                    <SelectItem value="debug" className="text-[10px]">Debug</SelectItem>
                    <SelectItem value="info" className="text-[10px]">Info</SelectItem>
                    <SelectItem value="warn" className="text-[10px]">Warn</SelectItem>
                    <SelectItem value="error" className="text-[10px]">Error</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 px-2" onClick={() => refetchEvents()}><RefreshCw className="w-3 h-3" /> Refresh Logs</Button>
              </div>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 px-2" onClick={downloadLogs}><Download className="w-3 h-3" /> Download TXT</Button>
            </div>
            <div className="border border-border rounded-md bg-muted/10 p-2 max-h-60 overflow-y-auto font-mono text-[10px] space-y-1">
              {!eventsData?.length ? (
                <div className="text-muted-foreground text-center py-4">No events found.</div>
              ) : (
                eventsData.map((e, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
                    <span className={`font-semibold shrink-0 ${e.level === 'error' ? 'text-destructive' : e.level === 'warn' ? 'text-yellow-500' : 'text-primary'}`}>[{e.summary}]</span>
                    <span className="text-foreground break-all">{e.rawSnippet}</span>
                  </div>
                ))
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="flex justify-end pt-2 border-t border-border mt-4">
        <Button size="sm" className="h-8 text-xs px-6" onClick={handleSave} disabled={updateMut.isPending}>
          {updateMut.isPending ? "Saving..." : "Save SIP Config"}
        </Button>
      </div>
    </div>
  );
}
