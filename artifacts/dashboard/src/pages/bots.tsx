import { useState } from "react";
import {
  useListBots,
  useCreateBot,
  useUpdateBot,
  useDeleteBot,
  getListBotsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, Plus, Trash2, Edit, Wifi, WifiOff, Phone, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const statusConfig: Record<string, { label: string; icon: React.ElementType; class: string }> = {
  ONLINE: { label: "Online", icon: Wifi, class: "text-accent" },
  OFFLINE: { label: "Offline", icon: WifiOff, class: "text-muted-foreground" },
  BUSY: { label: "Busy", icon: Phone, class: "text-yellow-400" },
  ERROR: { label: "Error", icon: AlertCircle, class: "text-destructive" },
};

const emptyForm = { displayName: "", email: "", sipExtension: "", sipDomain: "", whatsappNumber: "" };

export default function Bots() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editBot, setEditBot] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: bots, isLoading } = useListBots();
  const createMut = useCreateBot();
  const updateMut = useUpdateBot();
  const deleteMut = useDeleteBot();

  function openCreate() {
    setEditBot(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(b: NonNullable<typeof bots>[0]) {
    setEditBot(b.id);
    setForm({ displayName: b.displayName, email: b.email ?? "", sipExtension: b.sipExtension, sipDomain: b.sipDomain ?? "", whatsappNumber: b.whatsappNumber ?? "" });
    setOpen(true);
  }

  function handleSave() {
    const payload = { ...form, email: form.email || null, sipDomain: form.sipDomain || null, whatsappNumber: form.whatsappNumber || null };
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
        { data: { displayName: form.displayName, sipExtension: form.sipExtension, email: form.email || null, sipDomain: form.sipDomain || null, whatsappNumber: form.whatsappNumber || null } },
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
            return (
              <div key={bot.id} className="bg-card border border-card-border rounded p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded bg-primary/15 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{bot.displayName}</p>
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
                  <div className="flex justify-between"><span className="text-muted-foreground">Active Calls</span><span className="text-foreground font-medium tabular-nums">{bot.activeCalls}</span></div>
                </div>
                <div className="flex gap-2 pt-1 border-t border-border">
                  <Button size="sm" variant="ghost" className="text-[11px] h-6 px-2 gap-1" onClick={() => openEdit(bot)}>
                    <Edit className="w-3 h-3" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-[11px] h-6 px-2 gap-1 text-destructive hover:text-destructive ml-auto" onClick={() => handleDelete(bot.id)}>
                    <Trash2 className="w-3 h-3" /> Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Bot className="w-4 h-4 text-primary" />
              {editBot ? "Edit Bot" : "Register Bot"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
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
                  value={(form as any)[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} className="text-xs">Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={!form.displayName || !form.sipExtension || createMut.isPending || updateMut.isPending} className="text-xs">
              {editBot ? "Save Changes" : "Register"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
