import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, Search, Settings, Sparkles, Send, RefreshCw, CheckCircle2,
  XCircle, Loader2, ChevronRight, ArrowLeft, Reply, Inbox, Clock, Paperclip
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as any).error ?? res.statusText);
  }
  return res.json();
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface EmailConfig {
  tenantId: string; clientId: string; clientSecret: string;
  userEmail: string; isEnabled: boolean;
}

interface EmailMessage {
  id: string; subject: string;
  from: { emailAddress: { name: string; address: string } };
  receivedDateTime: string; isRead: boolean; bodyPreview: string;
  hasAttachments: boolean;
  body?: { content: string; contentType: string };
}

interface StyleProfile {
  greeting: string; signOff: string; tone: string;
  callSummaryTemplate: string; styleExamples: string[];
  lastLearnedAt?: string;
}

// ─── Config Tab ──────────────────────────────────────────────────────────────
function ConfigTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: cfg } = useQuery<EmailConfig>({ queryKey: ["email-config"], queryFn: () => apiFetch("/api/v1/email-agent/config") });
  const [form, setForm] = useState<EmailConfig>({ tenantId: "", clientId: "", clientSecret: "", userEmail: "", isEnabled: false });
  useEffect(() => { if (cfg) setForm(cfg); }, [cfg]);

  const save = useMutation({
    mutationFn: (d: EmailConfig) => apiFetch("/api/v1/email-agent/config", { method: "PUT", body: JSON.stringify(d) }),
    onSuccess: () => { toast({ title: "Configuration saved" }); qc.invalidateQueries({ queryKey: ["email-config"] }); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const test = useMutation({
    mutationFn: () => apiFetch("/api/v1/email-agent/test-connection", { method: "POST" }),
    onSuccess: (d: any) => toast({ title: d.success ? "Connection successful" : "Connection failed", description: d.message ?? d.error }),
    onError: (e: Error) => toast({ title: "Connection failed", description: e.message, variant: "destructive" }),
  });

  const f = (k: keyof EmailConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(x => ({ ...x, [k]: e.target.value }));

  return (
    <div className="space-y-6 max-w-xl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Microsoft 365 / Azure AD</CardTitle>
          <CardDescription className="text-xs">Client credentials flow — no user sign-in required. Grant Mail.Read, Mail.ReadWrite, Mail.Send, User.Read application permissions in Azure AD.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["tenantId", "clientId"] as const).map(k => (
            <div key={k} className="space-y-1">
              <Label className="text-xs">{k === "tenantId" ? "Tenant ID" : "Client ID (Application ID)"}</Label>
              <Input className="text-xs h-8" value={form[k]} onChange={f(k)} placeholder={k === "tenantId" ? "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" : "App registration Client ID"} />
            </div>
          ))}
          <div className="space-y-1">
            <Label className="text-xs">Client Secret</Label>
            <Input className="text-xs h-8" type="password" value={form.clientSecret} onChange={f("clientSecret")} placeholder="App registration secret value" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mailbox Email Address</Label>
            <Input className="text-xs h-8" value={form.userEmail} onChange={f("userEmail")} placeholder="agent@yourdomain.com" />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Switch checked={form.isEnabled} onCheckedChange={v => setForm(x => ({ ...x, isEnabled: v }))} />
            <span className="text-xs text-muted-foreground">Enable Email Agent</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button size="sm" className="text-xs h-8" onClick={() => save.mutate(form)} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Save Configuration
        </Button>
        <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />} Test Connection
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold">Azure AD Setup Guide</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
            <li>Go to <span className="font-medium text-foreground">portal.azure.com</span> → Azure Active Directory → App registrations → New registration</li>
            <li>Name it anything (e.g. "VoxAgent") — Accounts in this org directory only</li>
            <li>Go to <span className="font-medium text-foreground">API permissions</span> → Add permission → Microsoft Graph → Application permissions → add <code className="rounded-md bg-white/[0.07] px-1 font-mono text-[0.95em] text-foreground/90">Mail.Read</code>, <code className="rounded-md bg-white/[0.07] px-1 font-mono text-[0.95em] text-foreground/90">Mail.ReadWrite</code>, <code className="rounded-md bg-white/[0.07] px-1 font-mono text-[0.95em] text-foreground/90">Mail.Send</code>, <code className="rounded-md bg-white/[0.07] px-1 font-mono text-[0.95em] text-foreground/90">User.Read.All</code></li>
            <li>Click <span className="font-medium text-foreground">Grant admin consent</span></li>
            <li>Go to <span className="font-medium text-foreground">Certificates &amp; secrets</span> → New client secret — copy the value immediately</li>
            <li>Paste Tenant ID, Client ID, and Secret above</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Inbox Tab ────────────────────────────────────────────────────────────────
function InboxTab() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [activeSearch, setActiveSearch] = useState("");

  const inbox = useQuery<{ value: EmailMessage[] }>({
    queryKey: ["email-inbox"],
    queryFn: () => apiFetch("/api/v1/email-agent/inbox"),
    retry: false,
  });

  const searchResults = useQuery<{ value: EmailMessage[] }>({
    queryKey: ["email-search", activeSearch],
    queryFn: () => apiFetch(`/api/v1/email-agent/search?q=${encodeURIComponent(activeSearch)}`),
    enabled: !!activeSearch,
    retry: false,
  });

  const messageDetail = useQuery<EmailMessage>({
    queryKey: ["email-message", selected?.id],
    queryFn: () => apiFetch(`/api/v1/email-agent/message/${selected!.id}`),
    enabled: !!selected?.id,
    retry: false,
  });

  const reply = useMutation({
    mutationFn: ({ send }: { send: boolean }) => apiFetch("/api/v1/email-agent/reply", {
      method: "POST",
      body: JSON.stringify({ messageId: selected!.id, body: replyBody.replace(/\n/g, "<br>"), send }),
    }),
    onSuccess: (d: any) => {
      toast({ title: d.sent ? "Reply sent" : "Draft saved" });
      setShowReply(false); setReplyBody("");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const messages = activeSearch ? (searchResults.data?.value ?? []) : (inbox.data?.value ?? []);
  const isLoading = activeSearch ? searchResults.isLoading : inbox.isLoading;
  const isError = activeSearch ? searchResults.isError : inbox.isError;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setActiveSearch(searchQ);
    setSelected(null);
  }

  if (selected) {
    const detail = messageDetail.data ?? selected;
    return (
      <div className="space-y-3">
        <button onClick={() => { setSelected(null); setShowReply(false); setReplyBody(""); }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3 h-3" /> Back to inbox
        </button>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm">{detail.subject}</CardTitle>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">{detail.from?.emailAddress?.name} &lt;{detail.from?.emailAddress?.address}&gt;</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">{new Date(detail.receivedDateTime).toLocaleString()}</span>
                </div>
              </div>
              {detail.hasAttachments && <Paperclip className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-1" />}
            </div>
          </CardHeader>
          <CardContent>
            {messageDetail.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Loading...</div>
            ) : detail.body?.contentType === "html" ? (
              <iframe
                srcDoc={detail.body.content}
                className="w-full min-h-64 border-0 rounded"
                sandbox="allow-same-origin"
                title="Email body"
              />
            ) : (
              <pre className="text-xs whitespace-pre-wrap text-foreground font-sans">{detail.body?.content ?? detail.bodyPreview}</pre>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowReply(!showReply)}>
            <Reply className="w-3 h-3 mr-1" /> Reply
          </Button>
        </div>

        {showReply && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold">Compose Reply</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                className="text-xs min-h-32"
                placeholder="Type your reply..."
                value={replyBody}
                onChange={e => setReplyBody(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" className="text-xs h-8" onClick={() => reply.mutate({ send: true })} disabled={reply.isPending || !replyBody}>
                  <Send className="w-3 h-3 mr-1" /> Send Reply
                </Button>
                <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => reply.mutate({ send: false })} disabled={reply.isPending || !replyBody}>
                  Save Draft
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          className="text-xs h-8"
          placeholder="Search by subject, sender, keyword, or date..."
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" className="text-xs h-8 flex-shrink-0">
          <Search className="w-3 h-3 mr-1" /> Search
        </Button>
        {activeSearch && (
          <Button type="button" size="sm" variant="ghost" className="text-xs h-8" onClick={() => { setActiveSearch(""); setSearchQ(""); }}>
            Clear
          </Button>
        )}
      </form>

      {activeSearch && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Search className="w-3 h-3" /> Results for <span className="font-medium text-foreground">"{activeSearch}"</span>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading emails...
        </div>
      )}

      {isError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-xs text-destructive">
              <XCircle className="w-4 h-4" />
              <span>Could not load emails. Verify your Microsoft 365 configuration in the Settings tab.</span>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && messages.length === 0 && (
        <div className="text-center py-12 text-xs text-muted-foreground">
          <Inbox className="w-8 h-8 mx-auto mb-2 opacity-30" />
          {activeSearch ? "No emails found matching your search." : "Inbox is empty."}
        </div>
      )}

      <div className="space-y-1">
        {messages.map(msg => (
          <button
            key={msg.id}
            onClick={() => setSelected(msg)}
            className="w-full text-left rounded border border-border transition-colors hover:bg-white/[0.05] p-3 flex items-start gap-3 group"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {!msg.isRead && <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                <span className={`text-xs truncate ${!msg.isRead ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  {msg.from?.emailAddress?.name || msg.from?.emailAddress?.address}
                </span>
                <span className="text-xs text-muted-foreground ml-auto flex-shrink-0 flex items-center gap-1">
                  {msg.hasAttachments && <Paperclip className="w-3 h-3" />}
                  <Clock className="w-3 h-3" />
                  {new Date(msg.receivedDateTime).toLocaleDateString()}
                </span>
              </div>
              <div className={`text-xs mt-0.5 truncate ${!msg.isRead ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                {msg.subject}
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">{msg.bodyPreview}</div>
            </div>
            <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Writing Style Tab ────────────────────────────────────────────────────────
function StyleTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: style } = useQuery<StyleProfile>({ queryKey: ["email-style"], queryFn: () => apiFetch("/api/v1/email-agent/style") });
  const [form, setForm] = useState<StyleProfile>({ greeting: "Hi,", signOff: "Best regards,", tone: "professional", callSummaryTemplate: "", styleExamples: [] });
  useEffect(() => { if (style) setForm(style); }, [style]);

  const save = useMutation({
    mutationFn: (d: StyleProfile) => apiFetch("/api/v1/email-agent/style", { method: "PUT", body: JSON.stringify(d) }),
    onSuccess: () => { toast({ title: "Writing style saved" }); qc.invalidateQueries({ queryKey: ["email-style"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const learn = useMutation({
    mutationFn: () => apiFetch("/api/v1/email-agent/learn-style", { method: "POST" }),
    onSuccess: (d: any) => {
      toast({ title: `Learned from ${d.sampledCount} sent emails`, description: `Greeting: "${d.greeting}" · Sign-off: "${d.signOff}"` });
      qc.invalidateQueries({ queryKey: ["email-style"] });
    },
    onError: (e: Error) => toast({ title: "Learning failed", description: e.message, variant: "destructive" }),
  });

  const tones = ["professional", "friendly", "concise", "formal", "casual"];

  return (
    <div className="space-y-4 max-w-xl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Email Writing Style</CardTitle>
          <CardDescription className="text-xs">The voice bot uses this profile when composing replies and call summaries.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Default Greeting</Label>
            <Input className="text-xs h-8" value={form.greeting} onChange={e => setForm(x => ({ ...x, greeting: e.target.value }))} placeholder="Hi, / Dear, / Hello," />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sign-off</Label>
            <Input className="text-xs h-8" value={form.signOff} onChange={e => setForm(x => ({ ...x, signOff: e.target.value }))} placeholder="Best regards, / Warm regards, / Thanks," />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tone</Label>
            <Select value={form.tone} onValueChange={v => setForm(x => ({ ...x, tone: v }))}>
              <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{tones.map(t => <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Call Summary Template</CardTitle>
          <CardDescription className="text-xs">Used when the bot emails a call summary. Available variables: <code className="rounded-md bg-white/[0.07] px-1 font-mono text-[0.95em] text-foreground/90">{"{{customerName}}"}</code>, <code className="rounded-md bg-white/[0.07] px-1 font-mono text-[0.95em] text-foreground/90">{"{{summary}}"}</code>, <code className="rounded-md bg-white/[0.07] px-1 font-mono text-[0.95em] text-foreground/90">{"{{signOff}}"}</code></CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            className="text-xs min-h-40 font-mono"
            value={form.callSummaryTemplate}
            onChange={e => setForm(x => ({ ...x, callSummaryTemplate: e.target.value }))}
          />
        </CardContent>
      </Card>

      <div className="flex gap-2 flex-wrap">
        <Button size="sm" className="text-xs h-8" onClick={() => save.mutate(form)} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Save Style
        </Button>
        <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => learn.mutate()} disabled={learn.isPending}>
          {learn.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
          Learn from Sent Items
        </Button>
      </div>

      {style?.lastLearnedAt && (
        <p className="text-xs text-muted-foreground">Last learned: {new Date(style.lastLearnedAt).toLocaleString()}</p>
      )}

      {(form.styleExamples?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold">Style Examples (from Sent Items)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {form.styleExamples.slice(0, 3).map((ex, i) => (
              <div key={i} className="text-xs text-muted-foreground rounded-lg bg-black/20 p-2 line-clamp-3">{ex}</div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Call Summary Tab ─────────────────────────────────────────────────────────
function CallSummaryTab() {
  const { toast } = useToast();
  const [form, setForm] = useState({ toEmail: "", customerName: "", subject: "", summary: "" });

  const send = useMutation({
    mutationFn: () => apiFetch("/api/v1/email-agent/send-summary", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => { toast({ title: "Call summary sent" }); setForm({ toEmail: "", customerName: "", subject: "", summary: "" }); },
    onError: (e: Error) => toast({ title: "Failed to send", description: e.message, variant: "destructive" }),
  });

  const fields = [
    { key: "toEmail" as const, label: "Customer Email", placeholder: "customer@example.com" },
    { key: "customerName" as const, label: "Customer Name", placeholder: "Jane Smith" },
    { key: "subject" as const, label: "Subject (optional)", placeholder: "Call Summary — leave blank for auto" },
  ];

  return (
    <div className="space-y-4 max-w-xl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Send Call Summary Email</CardTitle>
          <CardDescription className="text-xs">Sends from the configured mailbox directly to the customer, with a CC copy to your inbox.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {fields.map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <Input className="text-xs h-8" value={form[key]} onChange={e => setForm(x => ({ ...x, [key]: e.target.value }))} placeholder={placeholder} />
            </div>
          ))}
          <div className="space-y-1">
            <Label className="text-xs">Call Summary</Label>
            <Textarea
              className="text-xs min-h-28"
              placeholder="Paste or type the call summary here..."
              value={form.summary}
              onChange={e => setForm(x => ({ ...x, summary: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>
      <Button size="sm" className="text-xs h-8" onClick={() => send.mutate()} disabled={send.isPending || !form.toEmail || !form.customerName || !form.summary}>
        {send.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
        Send Summary Email
      </Button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function EmailAgent() {
  return (
    <div className="animate-fade-in space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.022em] text-foreground">Email Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">Live Microsoft 365 mailbox access — search, read, reply, and send call summaries in real time</p>
      </div>

      <Tabs defaultValue="inbox">
        <TabsList className="h-8">
          <TabsTrigger value="inbox" className="text-xs"><Inbox className="w-3 h-3 mr-1" />Inbox</TabsTrigger>
          <TabsTrigger value="summary" className="text-xs"><Send className="w-3 h-3 mr-1" />Call Summary</TabsTrigger>
          <TabsTrigger value="style" className="text-xs"><Sparkles className="w-3 h-3 mr-1" />Writing Style</TabsTrigger>
          <TabsTrigger value="config" className="text-xs"><Settings className="w-3 h-3 mr-1" />Configuration</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-4"><InboxTab /></TabsContent>
        <TabsContent value="summary" className="mt-4"><CallSummaryTab /></TabsContent>
        <TabsContent value="style" className="mt-4"><StyleTab /></TabsContent>
        <TabsContent value="config" className="mt-4"><ConfigTab /></TabsContent>
      </Tabs>
    </div>
  );
}
