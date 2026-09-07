import { useState } from "react";
import {
  useListMessageLogs,
  useSendWhatsApp,
  useSendTelegram,
  useSendEmail,
  getListMessageLogsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Send, MessageSquare, Mail } from "lucide-react";

const statusColors: Record<string, string> = {
  sent: "bg-accent/15 text-accent",
  delivered: "bg-primary/15 text-primary",
  failed: "bg-destructive/15 text-destructive",
};

function fmtDate(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function MessageLogTable({ channel }: { channel?: "whatsapp" | "telegram" | "email" }) {
  const params = { limit: 20, ...(channel ? { channel } : {}) };
  const { data } = useListMessageLogs(params, { query: { queryKey: getListMessageLogsQueryKey(params) } });
  const logs = data ?? [];
  if (!logs.length) return <p className="text-xs text-muted-foreground py-3">No messages sent yet</p>;
  return (
    <div className="border border-border rounded overflow-hidden mt-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-white/[0.03]">
            <th className="text-left px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Recipient</th>
            <th className="text-left px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Template</th>
            <th className="text-left px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Status</th>
            <th className="text-left px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Sent</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b border-border/50">
              <td className="px-3 py-2 font-mono text-foreground">{log.recipient}</td>
              <td className="px-3 py-2 text-muted-foreground">{log.templateName ?? "—"}</td>
              <td className="px-3 py-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColors[log.status] ?? ""}`}>{log.status}</span>
              </td>
              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(log.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Messaging() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [wa, setWa] = useState({ to: "", templateName: "", freeText: "" });
  const [tg, setTg] = useState({ chatId: "", text: "" });
  const [em, setEm] = useState({ to: "", subject: "", templateName: "call_summary" as const });

  const waMut = useSendWhatsApp();
  const tgMut = useSendTelegram();
  const emMut = useSendEmail();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListMessageLogsQueryKey({}) });
  }

  function sendWa() {
    waMut.mutate(
      { data: { to: wa.to, templateName: wa.templateName || null, freeText: wa.freeText || null } },
      { onSuccess: () => { toast({ title: "WhatsApp sent" }); setWa({ to: "", templateName: "", freeText: "" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) }
    );
  }

  function sendTg() {
    tgMut.mutate(
      { data: { chatId: tg.chatId, text: tg.text } },
      { onSuccess: () => { toast({ title: "Telegram sent" }); setTg({ chatId: "", text: "" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) }
    );
  }

  function sendEm() {
    emMut.mutate(
      { data: { to: em.to, subject: em.subject, templateName: em.templateName } },
      { onSuccess: () => { toast({ title: "Email sent" }); setEm({ to: "", subject: "", templateName: "call_summary" }); invalidate(); }, onError: () => toast({ title: "Failed", variant: "destructive" }) }
    );
  }

  return (
    <div className="animate-fade-in space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.022em] text-foreground">Messaging Hub</h1>
        <p className="mt-1 text-sm text-muted-foreground">Send post-call messages via WhatsApp, Telegram, and Email</p>
      </div>

      <Tabs defaultValue="whatsapp">
        <TabsList className="bg-muted text-xs">
          <TabsTrigger value="whatsapp" className="text-xs gap-1.5"><MessageSquare className="w-3 h-3" /> WhatsApp</TabsTrigger>
          <TabsTrigger value="telegram" className="text-xs gap-1.5"><Send className="w-3 h-3" /> Telegram</TabsTrigger>
          <TabsTrigger value="email" className="text-xs gap-1.5"><Mail className="w-3 h-3" /> Email</TabsTrigger>
        </TabsList>

        <TabsContent value="whatsapp" className="mt-4">
          <div className="panel p-4 max-w-md space-y-3">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Send WhatsApp</h3>
            <div>
              <Label className="text-xs">To (E.164)</Label>
              <Input className="mt-1 text-xs font-mono" placeholder="+919876543210" value={wa.to} onChange={(e) => setWa((x) => ({ ...x, to: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Template Name (optional)</Label>
              <Input className="mt-1 text-xs" placeholder="call_summary_v1" value={wa.templateName} onChange={(e) => setWa((x) => ({ ...x, templateName: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Free-form Message (optional)</Label>
              <Textarea className="mt-1 text-xs" rows={3} placeholder="Your call has been logged..." value={wa.freeText} onChange={(e) => setWa((x) => ({ ...x, freeText: e.target.value }))} />
            </div>
            <Button size="sm" onClick={sendWa} disabled={!wa.to || waMut.isPending} className="gap-1.5 text-xs">
              <Send className="w-3 h-3" /> {waMut.isPending ? "Sending..." : "Send WhatsApp"}
            </Button>
          </div>
          <MessageLogTable channel="whatsapp" />
        </TabsContent>

        <TabsContent value="telegram" className="mt-4">
          <div className="panel p-4 max-w-md space-y-3">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Send Telegram</h3>
            <div>
              <Label className="text-xs">Chat ID</Label>
              <Input className="mt-1 text-xs font-mono" placeholder="123456789" value={tg.chatId} onChange={(e) => setTg((x) => ({ ...x, chatId: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Message</Label>
              <Textarea className="mt-1 text-xs" rows={4} placeholder="Your call has been processed..." value={tg.text} onChange={(e) => setTg((x) => ({ ...x, text: e.target.value }))} />
            </div>
            <Button size="sm" onClick={sendTg} disabled={!tg.chatId || !tg.text || tgMut.isPending} className="gap-1.5 text-xs">
              <Send className="w-3 h-3" /> {tgMut.isPending ? "Sending..." : "Send Telegram"}
            </Button>
          </div>
          <MessageLogTable channel="telegram" />
        </TabsContent>

        <TabsContent value="email" className="mt-4">
          <div className="panel p-4 max-w-md space-y-3">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Send Email</h3>
            <div>
              <Label className="text-xs">To</Label>
              <Input className="mt-1 text-xs" placeholder="customer@example.com" value={em.to} onChange={(e) => setEm((x) => ({ ...x, to: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Subject</Label>
              <Input className="mt-1 text-xs" placeholder="Call Summary — VoxAgent" value={em.subject} onChange={(e) => setEm((x) => ({ ...x, subject: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Template</Label>
              <Select value={em.templateName} onValueChange={(v) => setEm((x) => ({ ...x, templateName: v as any }))}>
                <SelectTrigger className="mt-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["call_summary", "follow_up", "appointment_confirmation", "missed_call_notification"].map((t) => (
                    <SelectItem key={t} value={t} className="text-xs capitalize">{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={sendEm} disabled={!em.to || !em.subject || emMut.isPending} className="gap-1.5 text-xs">
              <Mail className="w-3 h-3" /> {emMut.isPending ? "Sending..." : "Send Email"}
            </Button>
          </div>
          <MessageLogTable channel="email" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
