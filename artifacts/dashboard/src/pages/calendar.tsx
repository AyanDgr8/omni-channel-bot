import { useState } from "react";
import {
  useGetAvailableSlots,
  useCreateCalendarInvite,
  getGetAvailableSlotsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Clock, CheckCircle2, Plus, X } from "lucide-react";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export default function CalendarPage() {
  const { toast } = useToast();
  const [slotEmail, setSlotEmail] = useState("");
  const [slotDate, setSlotDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedSlot, setSelectedSlot] = useState<{ start: string; end: string } | null>(null);
  const [attendees, setAttendees] = useState<string[]>([""]);
  const [form, setForm] = useState({ title: "", description: "", timezone: "Asia/Kolkata", location: "" });
  const [queryParams, setQueryParams] = useState<{ email: string; date: string } | null>(null);

  const { data: slots, isLoading: slotsLoading } = useGetAvailableSlots(
    queryParams ?? { email: "", date: "" },
    { query: { enabled: !!queryParams, queryKey: getGetAvailableSlotsQueryKey(queryParams ?? undefined) } }
  );
  const createMut = useCreateCalendarInvite();

  const availableSlots = (slots ?? []).filter((s) => s.available);

  function handleCreate() {
    if (!selectedSlot) return;
    const filteredAttendees = attendees.filter(Boolean);
    createMut.mutate(
      {
        data: {
          title: form.title,
          description: form.description || null,
          start: selectedSlot.start,
          end: selectedSlot.end,
          timezone: form.timezone,
          attendees: filteredAttendees,
          location: form.location || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Calendar invite created", description: `Invite sent to ${filteredAttendees.join(", ")}` });
          setSelectedSlot(null);
          setForm({ title: "", description: "", timezone: "Asia/Kolkata", location: "" });
          setAttendees([""]);
        },
        onError: () => toast({ title: "Failed to create invite", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-bold text-foreground tracking-tight">Calendar</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Schedule appointments and send calendar invites</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Slot Picker */}
        <div className="space-y-4">
          <div className="bg-card border border-card-border rounded p-4 space-y-3">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Find Available Slots</h3>
            <div>
              <Label className="text-xs">Calendar Email</Label>
              <Input className="mt-1 text-xs" placeholder="calendar@company.com" value={slotEmail} onChange={(e) => setSlotEmail(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input className="mt-1 text-xs" type="date" value={slotDate} onChange={(e) => setSlotDate(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => setQueryParams({ email: slotEmail, date: slotDate })} disabled={!slotEmail || !slotDate} className="gap-1.5 text-xs">
              <Clock className="w-3 h-3" /> Check Availability
            </Button>
          </div>

          {/* Slot Grid */}
          {slotsLoading && <p className="text-xs text-muted-foreground">Loading slots...</p>}
          {availableSlots.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{availableSlots.length} available slots</p>
              <div className="grid grid-cols-3 gap-1.5">
                {availableSlots.map((slot) => {
                  const isSelected = selectedSlot?.start === slot.start;
                  return (
                    <button
                      key={slot.start}
                      onClick={() => setSelectedSlot(isSelected ? null : { start: slot.start, end: slot.end })}
                      className={`py-2 rounded text-[11px] font-medium border transition-colors ${isSelected ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border hover:border-primary/50"}`}
                    >
                      {fmtTime(slot.start)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {queryParams && !slotsLoading && availableSlots.length === 0 && (
            <p className="text-xs text-muted-foreground">No available slots for this date</p>
          )}
        </div>

        {/* Invite Form */}
        <div className="bg-card border border-card-border rounded p-4 space-y-3">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Create Invite</h3>
          {selectedSlot && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-primary/10 border border-primary/20">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <span className="text-[11px] text-primary font-medium">{fmtTime(selectedSlot.start)} — {fmtTime(selectedSlot.end)}</span>
            </div>
          )}
          <div>
            <Label className="text-xs">Title *</Label>
            <Input className="mt-1 text-xs" placeholder="Follow-up call — VoxAgent" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea className="mt-1 text-xs" rows={2} placeholder="Discussion topics..." value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Location</Label>
            <Input className="mt-1 text-xs" placeholder="https://meet.google.com/..." value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Timezone</Label>
            <Input className="mt-1 text-xs font-mono" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Attendees</Label>
            {attendees.map((att, i) => (
              <div key={i} className="flex gap-1.5">
                <Input
                  className="text-xs"
                  placeholder="attendee@example.com"
                  value={att}
                  onChange={(e) => {
                    const next = [...attendees];
                    next[i] = e.target.value;
                    setAttendees(next);
                  }}
                />
                {attendees.length > 1 && (
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 flex-shrink-0" onClick={() => setAttendees((a) => a.filter((_, j) => j !== i))}>
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setAttendees((a) => [...a, ""])} className="text-[11px] h-7 gap-1 text-muted-foreground">
              <Plus className="w-3 h-3" /> Add Attendee
            </Button>
          </div>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!selectedSlot || !form.title || createMut.isPending}
            className="gap-1.5 text-xs w-full mt-1"
          >
            <Calendar className="w-3 h-3" />
            {createMut.isPending ? "Creating..." : "Create Invite"}
          </Button>
        </div>
      </div>
    </div>
  );
}
