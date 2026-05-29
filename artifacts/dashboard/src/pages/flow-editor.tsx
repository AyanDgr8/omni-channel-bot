import { useState, useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  Handle,
  Position,
  BackgroundVariant,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Save, Plus, Trash2, Play, Phone, Calendar, MessageSquare,
  GitBranch, Mic, PhoneCall, PhoneOff, ChevronDown, X, Loader2, FileText,
} from "lucide-react";

// ─── Node type definitions ────────────────────────────────────────────────────

const NODE_TYPES_META = [
  { type: "start", label: "Call Begins", icon: PhoneCall, color: "emerald", desc: "Entry point" },
  { type: "botSays", label: "Bot Says", icon: Mic, color: "blue", desc: "Bot speaks text" },
  { type: "askQuestion", label: "Ask Question", icon: MessageSquare, color: "violet", desc: "Ask & wait for reply" },
  { type: "condition", label: "Condition", icon: GitBranch, color: "amber", desc: "Branch on keywords" },
  { type: "transfer", label: "Transfer", icon: Phone, color: "orange", desc: "Transfer to agent" },
  { type: "schedule", label: "Schedule", icon: Calendar, color: "teal", desc: "Book appointment" },
  { type: "sendMessage", label: "Send Message", icon: MessageSquare, color: "indigo", desc: "WhatsApp / Email" },
  { type: "end", label: "End Call", icon: PhoneOff, color: "red", desc: "Terminate call" },
] as const;

const colorMap: Record<string, string> = {
  emerald: "border-emerald-500 bg-emerald-500/10 text-emerald-400",
  blue: "border-blue-500 bg-blue-500/10 text-blue-400",
  violet: "border-violet-500 bg-violet-500/10 text-violet-400",
  amber: "border-amber-500 bg-amber-500/10 text-amber-400",
  orange: "border-orange-500 bg-orange-500/10 text-orange-400",
  teal: "border-teal-500 bg-teal-500/10 text-teal-400",
  indigo: "border-indigo-500 bg-indigo-500/10 text-indigo-400",
  red: "border-red-500 bg-red-500/10 text-red-400",
};

const typeToColor: Record<string, string> = {
  start: "emerald", botSays: "blue", askQuestion: "violet",
  condition: "amber", transfer: "orange", schedule: "teal",
  sendMessage: "indigo", end: "red",
};

const handleStyle = { width: 10, height: 10, background: "#334155", border: "2px solid #64748b" };

// ─── Custom node components ───────────────────────────────────────────────────

function NodeWrapper({ type, children, selected }: { type: string; children: React.ReactNode; selected: boolean }) {
  const color = typeToColor[type] ?? "blue";
  const cls = colorMap[color] ?? colorMap.blue;
  return (
    <div className={`rounded border-2 min-w-[180px] max-w-[240px] text-xs shadow-lg transition-shadow ${cls} ${selected ? "shadow-[0_0_0_2px_hsl(210,100%,50%)]" : ""}`}>
      {children}
    </div>
  );
}

function NodeHeader({ icon: Icon, label, color }: { icon: React.ElementType; label: string; color: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 border-b border-white/10`}>
      <Icon className="w-3 h-3 flex-shrink-0" />
      <span className="font-semibold uppercase tracking-wider text-[10px]">{label}</span>
    </div>
  );
}

export function StartNode({ data, selected }: NodeProps) {
  return (
    <NodeWrapper type="start" selected={!!selected}>
      <NodeHeader icon={PhoneCall} label="Call Begins" color="emerald" />
      <div className="px-2.5 py-2 text-[11px] text-foreground/70">{(data.label as string) || "Entry point"}</div>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </NodeWrapper>
  );
}

export function BotSaysNode({ data, selected }: NodeProps) {
  return (
    <NodeWrapper type="botSays" selected={!!selected}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <NodeHeader icon={Mic} label={(data.label as string) || "Bot Says"} color="blue" />
      <div className="px-2.5 py-2 text-[11px] text-foreground/80 leading-relaxed line-clamp-3">{(data.text as string) || "Bot speaks…"}</div>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </NodeWrapper>
  );
}

export function AskQuestionNode({ data, selected }: NodeProps) {
  const kw = (data.keywords as string[]) ?? [];
  return (
    <NodeWrapper type="askQuestion" selected={!!selected}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <NodeHeader icon={MessageSquare} label={(data.label as string) || "Ask Question"} color="violet" />
      <div className="px-2.5 py-2 space-y-1.5">
        <p className="text-[11px] text-foreground/80 leading-relaxed">{(data.question as string) || "Question…"}</p>
        {kw.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {kw.slice(0, 4).map((k) => (
              <span key={k} className="px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[9px] font-mono">{k}</span>
            ))}
            {kw.length > 4 && <span className="text-[9px] text-muted-foreground">+{kw.length - 4}</span>}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="default" style={handleStyle} />
    </NodeWrapper>
  );
}

export function ConditionNode({ data, selected }: NodeProps) {
  return (
    <NodeWrapper type="condition" selected={!!selected}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <NodeHeader icon={GitBranch} label={(data.label as string) || "Condition"} color="amber" />
      <div className="px-2.5 py-2 text-[11px] text-foreground/80 leading-relaxed">{(data.condition as string) || "If…"}</div>
      <div className="flex justify-between px-2.5 pb-2">
        <span className="text-[9px] text-amber-400 font-medium">YES</span>
        <span className="text-[9px] text-muted-foreground font-medium">NO</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="yes" style={{ ...handleStyle, left: "30%" }} />
      <Handle type="source" position={Position.Bottom} id="no" style={{ ...handleStyle, left: "70%" }} />
    </NodeWrapper>
  );
}

export function TransferNode({ data, selected }: NodeProps) {
  return (
    <NodeWrapper type="transfer" selected={!!selected}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <NodeHeader icon={Phone} label={(data.label as string) || "Transfer"} color="orange" />
      <div className="px-2.5 py-2 space-y-0.5">
        <p className="text-[10px] text-muted-foreground">To: <span className="text-foreground font-mono">{(data.target as string) || "—"}</span></p>
        <p className="text-[10px] text-muted-foreground">Via: <span className="text-foreground capitalize">{(data.targetType as string) || "extension"}</span></p>
      </div>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </NodeWrapper>
  );
}

export function ScheduleNode({ data, selected }: NodeProps) {
  return (
    <NodeWrapper type="schedule" selected={!!selected}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <NodeHeader icon={Calendar} label={(data.label as string) || "Schedule"} color="teal" />
      <div className="px-2.5 py-2 text-[11px] text-foreground/80">{(data.description as string) || "Book appointment"}</div>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </NodeWrapper>
  );
}

export function SendMessageNode({ data, selected }: NodeProps) {
  return (
    <NodeWrapper type="sendMessage" selected={!!selected}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <NodeHeader icon={MessageSquare} label={(data.label as string) || "Send Message"} color="indigo" />
      <div className="px-2.5 py-2 space-y-0.5">
        <p className="text-[10px] text-muted-foreground">Channel: <span className="text-foreground capitalize">{(data.channel as string) || "whatsapp"}</span></p>
        <p className="text-[10px] text-muted-foreground truncate">Template: <span className="text-foreground">{(data.template as string) || "—"}</span></p>
      </div>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </NodeWrapper>
  );
}

export function EndNode({ data, selected }: NodeProps) {
  return (
    <NodeWrapper type="end" selected={!!selected}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <NodeHeader icon={PhoneOff} label="End Call" color="red" />
      <div className="px-2.5 py-2 text-[11px] text-foreground/70">{(data.label as string) || "Terminate call"}</div>
    </NodeWrapper>
  );
}

const nodeTypes = {
  start: StartNode,
  botSays: BotSaysNode,
  askQuestion: AskQuestionNode,
  condition: ConditionNode,
  transfer: TransferNode,
  schedule: ScheduleNode,
  sendMessage: SendMessageNode,
  end: EndNode,
};

// ─── Properties panel ────────────────────────────────────────────────────────

function PropertiesPanel({ node, onChange, onDelete }: {
  node: Node;
  onChange: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const d = node.data as Record<string, unknown>;

  function field(label: string, key: string, placeholder = "") {
    return (
      <div key={key}>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</Label>
        <Input
          className="mt-1 text-xs h-7"
          placeholder={placeholder}
          value={(d[key] as string) ?? ""}
          onChange={(e) => onChange(node.id, { ...d, [key]: e.target.value })}
        />
      </div>
    );
  }

  function textArea(label: string, key: string, placeholder = "") {
    return (
      <div key={key}>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</Label>
        <Textarea
          className="mt-1 text-xs"
          rows={3}
          placeholder={placeholder}
          value={(d[key] as string) ?? ""}
          onChange={(e) => onChange(node.id, { ...d, [key]: e.target.value })}
        />
      </div>
    );
  }

  return (
    <div className="w-60 bg-card border-l border-border flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Properties</span>
        <button onClick={() => onDelete(node.id)} className="text-muted-foreground hover:text-destructive transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="px-2 py-1.5 rounded bg-muted text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
          {node.type}
        </div>

        {node.type === "start" && field("Label", "label", "Call Begins")}

        {node.type === "botSays" && (
          <>
            {field("Label", "label", "Bot Says")}
            {textArea("Script", "text", "What the bot will say…")}
          </>
        )}

        {node.type === "askQuestion" && (
          <>
            {field("Label", "label", "Ask Question")}
            {textArea("Question", "question", "What should the bot ask?")}
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Keywords (comma-separated)</Label>
              <Input
                className="mt-1 text-xs h-7 font-mono"
                placeholder="yes, no, cancel"
                value={((d.keywords as string[]) ?? []).join(", ")}
                onChange={(e) => onChange(node.id, { ...d, keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
              />
            </div>
          </>
        )}

        {node.type === "condition" && (
          <>
            {field("Label", "label", "Condition")}
            {textArea("Condition", "condition", "Contains: billing OR payment")}
            <p className="text-[10px] text-muted-foreground">Two outputs: YES (left) and NO (right)</p>
          </>
        )}

        {node.type === "transfer" && (
          <>
            {field("Label", "label", "Transfer")}
            {field("Target", "target", "1000 or +919876543210")}
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Transfer Type</Label>
              <Select value={(d.targetType as string) ?? "extension"} onValueChange={(v) => onChange(node.id, { ...d, targetType: v })}>
                <SelectTrigger className="mt-1 text-xs h-7"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="extension" className="text-xs">Extension</SelectItem>
                  <SelectItem value="e164" className="text-xs">E.164 Number</SelectItem>
                  <SelectItem value="agent" className="text-xs">Named Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {node.type === "schedule" && (
          <>
            {field("Label", "label", "Schedule")}
            {textArea("Description", "description", "Book a callback appointment")}
          </>
        )}

        {node.type === "sendMessage" && (
          <>
            {field("Label", "label", "Send Message")}
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Channel</Label>
              <Select value={(d.channel as string) ?? "whatsapp"} onValueChange={(v) => onChange(node.id, { ...d, channel: v })}>
                <SelectTrigger className="mt-1 text-xs h-7"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp" className="text-xs">WhatsApp</SelectItem>
                  <SelectItem value="telegram" className="text-xs">Telegram</SelectItem>
                  <SelectItem value="email" className="text-xs">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {field("Template", "template", "call_summary")}
          </>
        )}

        {node.type === "end" && field("Label", "label", "End Call")}
      </div>
    </div>
  );
}

// ─── Node Palette ─────────────────────────────────────────────────────────────

function NodePalette() {
  return (
    <div className="w-48 bg-sidebar border-r border-sidebar-border flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2.5 border-b border-sidebar-border">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Node Palette</p>
        <p className="text-[9px] text-muted-foreground mt-0.5">Drag onto canvas</p>
      </div>
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
        {NODE_TYPES_META.map(({ type, label, icon: Icon, color, desc }) => {
          const cls = colorMap[color] ?? "";
          return (
            <div
              key={type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/reactflow-type", type);
                e.dataTransfer.effectAllowed = "move";
              }}
              className={`flex items-center gap-2 px-2.5 py-2 rounded border cursor-grab active:cursor-grabbing select-none transition-opacity hover:opacity-90 ${cls}`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium leading-none">{label}</p>
                <p className="text-[9px] opacity-60 mt-0.5">{desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Flow List ────────────────────────────────────────────────────────────────

function FlowList({ flows, activeId, onSelect, onCreate, onDelete }: {
  flows: FlowConfigItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
      {flows.map((f) => (
        <div key={f.id} className={`flex items-center gap-1 px-2.5 py-1 rounded border text-xs cursor-pointer whitespace-nowrap transition-colors ${f.id === activeId ? "bg-primary/15 border-primary text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
          <button onClick={() => onSelect(f.id)} className="max-w-[100px] truncate">{f.name}</button>
          <button onClick={() => onDelete(f.id)} className="text-muted-foreground hover:text-destructive ml-1"><X className="w-2.5 h-2.5" /></button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={onCreate} className="text-xs h-6 px-2 gap-1 whitespace-nowrap flex-shrink-0">
        <Plus className="w-3 h-3" /> New Flow
      </Button>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlowConfigItem {
  id: string;
  name: string;
  description?: string;
  definition: { nodes: Node[]; edges: Edge[] };
  updatedAt: string;
}

// ─── Main Editor ──────────────────────────────────────────────────────────────

let nodeIdCounter = 100;
function newId() { return `node-${++nodeIdCounter}`; }

export default function FlowEditor() {
  const { toast } = useToast();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [flows, setFlows] = useState<FlowConfigItem[]>([]);
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [flowName, setFlowName] = useState("");
  const [showNameInput, setShowNameInput] = useState(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // Load flow list
  useEffect(() => {
    fetch("/api/v1/flow/configs")
      .then((r) => r.json())
      .then((data: FlowConfigItem[]) => {
        setFlows(data);
        if (data.length > 0) loadFlow(data[0]);
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function loadFlow(flow: FlowConfigItem) {
    setActiveFlowId(flow.id);
    setNodes((flow.definition.nodes ?? []) as Node[]);
    setEdges((flow.definition.edges ?? []) as Edge[]);
    setSelectedNode(null);
    setLoading(false);
  }

  async function selectFlow(id: string) {
    const f = flows.find((x) => x.id === id);
    if (f) loadFlow(f);
  }

  async function saveFlow() {
    if (!activeFlowId) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/v1/flow/configs/${activeFlowId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: { nodes, edges } }),
      });
      if (r.ok) {
        toast({ title: "Flow saved" });
        const updated = await r.json() as FlowConfigItem;
        setFlows((fs) => fs.map((f) => f.id === activeFlowId ? updated : f));
      } else {
        toast({ title: "Save failed", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function createFlow() {
    if (!flowName.trim()) return;
    const r = await fetch("/api/v1/flow/configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: flowName.trim() }),
    });
    if (r.ok) {
      const created = await r.json() as FlowConfigItem;
      setFlows((fs) => [...fs, created]);
      loadFlow(created);
      setShowNameInput(false);
      setFlowName("");
    }
  }

  async function deleteFlow(id: string) {
    await fetch(`/api/v1/flow/configs/${id}`, { method: "DELETE" });
    const remaining = flows.filter((f) => f.id !== id);
    setFlows(remaining);
    if (activeFlowId === id) {
      if (remaining.length > 0) loadFlow(remaining[0]);
      else { setNodes([]); setEdges([]); setActiveFlowId(null); }
    }
    toast({ title: "Flow deleted" });
  }

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: false }, eds)),
    [setEdges]
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow-type");
      if (!type || !reactFlowWrapper.current || !reactFlowInstance) return;
      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      const defaults: Record<string, Record<string, unknown>> = {
        start: { label: "Call Begins" },
        botSays: { label: "Bot Says", text: "" },
        askQuestion: { label: "Ask Question", question: "", keywords: [] },
        condition: { label: "Condition", condition: "" },
        transfer: { label: "Transfer", target: "1000", targetType: "extension" },
        schedule: { label: "Schedule", description: "Book appointment" },
        sendMessage: { label: "Send Message", channel: "whatsapp", template: "call_summary" },
        end: { label: "End Call" },
      };
      const newNode: Node = {
        id: newId(),
        type,
        position,
        data: defaults[type] ?? { label: type },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, setNodes]
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  function onNodeClick(_: React.MouseEvent, node: Node) {
    setSelectedNode(node);
  }

  function onPaneClick() {
    setSelectedNode(null);
  }

  function updateNodeData(id: string, data: Record<string, unknown>) {
    setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data } : n));
    setSelectedNode((s) => s?.id === id ? { ...s, data } : s);
  }

  function deleteNode(id: string) {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedNode(null);
  }

  const edgeOptions = {
    style: { stroke: "#475569", strokeWidth: 1.5 },
    labelStyle: { fill: "#94a3b8", fontSize: 10 },
    labelBgStyle: { fill: "#0f172a", fillOpacity: 0.8 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 3,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card flex-shrink-0">
        <div>
          <p className="text-xs font-bold text-foreground tracking-tight">Flow Builder</p>
          <p className="text-[10px] text-muted-foreground">Decision tree for voice bot logic</p>
        </div>
        <div className="w-px h-6 bg-border mx-1" />
        <div className="flex-1 min-w-0">
          {showNameInput ? (
            <div className="flex items-center gap-2">
              <Input
                className="h-6 text-xs w-40"
                placeholder="Flow name…"
                value={flowName}
                onChange={(e) => setFlowName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createFlow(); if (e.key === "Escape") setShowNameInput(false); }}
                autoFocus
              />
              <Button size="sm" className="h-6 text-xs" onClick={createFlow} disabled={!flowName.trim()}>Create</Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowNameInput(false)}>Cancel</Button>
            </div>
          ) : (
            <FlowList
              flows={flows}
              activeId={activeFlowId}
              onSelect={selectFlow}
              onCreate={() => setShowNameInput(true)}
              onDelete={deleteFlow}
            />
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {activeFlowId && (
            <Button size="sm" onClick={saveFlow} disabled={saving} className="gap-1.5 text-xs h-7">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              {saving ? "Saving…" : "Save Flow"}
            </Button>
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        <NodePalette />

        {/* Canvas */}
        <div className="flex-1 relative" ref={reactFlowWrapper}>
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : !activeFlowId ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <FileText className="w-10 h-10 opacity-20" />
              <p className="text-sm">No flow selected</p>
              <Button size="sm" variant="outline" onClick={() => setShowNameInput(true)} className="gap-1.5 text-xs">
                <Plus className="w-3 h-3" /> Create your first flow
              </Button>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onInit={setReactFlowInstance}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={edgeOptions}
              fitView
              deleteKeyCode="Delete"
              proOptions={{ hideAttribution: true }}
              style={{ background: "hsl(220, 40%, 6%)" }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
              <Controls
                style={{ background: "hsl(220,40%,10%)", border: "1px solid hsl(220,30%,15%)" }}
                showInteractive={false}
              />
              <MiniMap
                style={{ background: "hsl(220,40%,8%)", border: "1px solid hsl(220,30%,15%)" }}
                nodeColor={(n) => {
                  const color = typeToColor[n.type ?? ""] ?? "blue";
                  const map: Record<string, string> = {
                    emerald: "#10b981", blue: "#3b82f6", violet: "#8b5cf6",
                    amber: "#f59e0b", orange: "#f97316", teal: "#14b8a6",
                    indigo: "#6366f1", red: "#ef4444",
                  };
                  return map[color] ?? "#3b82f6";
                }}
                maskColor="rgba(0,0,0,0.4)"
              />
              <Panel position="top-right" style={{ margin: 8 }}>
                <div className="text-[10px] text-muted-foreground bg-card border border-border px-2 py-1 rounded">
                  {nodes.length} nodes · {edges.length} edges · Del to remove selected
                </div>
              </Panel>
            </ReactFlow>
          )}
        </div>

        {/* Properties panel */}
        {selectedNode && (
          <PropertiesPanel
            node={selectedNode}
            onChange={updateNodeData}
            onDelete={deleteNode}
          />
        )}
      </div>
    </div>
  );
}
