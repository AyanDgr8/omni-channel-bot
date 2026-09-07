import {
  useGetStatsOverview,
  useGetCallsByHour,
  useGetHangupReasons,
  useGetConnectOutcomes,
  useGetLanguageMix,
  useGetCallIntelligence,
} from "@workspace/api-client-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { Phone, Bot, Activity, Clock, Cpu, Database, CheckCircle2, Mic, Languages, Zap, BarChart3, PieChart as PieIcon, LayoutDashboard } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

const COLORS = [
  "hsl(214,92%,60%)",
  "hsl(160,78%,45%)",
  "hsl(266,86%,68%)",
  "hsl(38,94%,58%)",
  "hsl(340,82%,64%)",
];
const OUTCOME_LABELS: Record<string, string> = {
  HUMAN: "Human",
  ANSWERING_MACHINE: "Voicemail",
  VOICEMAIL: "Voicemail",
  IVR: "IVR",
  SILENCE: "Silence",
  NO_RESPONSE: "No Response",
};

const AXIS_TICK = { fontSize: 10, fill: "hsl(219,15%,68%)" } as const;

type Tone = "primary" | "accent" | "violet" | "amber" | "destructive";

/** Icon-tile tints, kept in one place so every card pulls from the same ramp. */
const TONE: Record<Tone, { tile: string; icon: string; glow: string }> = {
  primary: { tile: "from-primary/25 to-primary/5 border-primary/25", icon: "text-primary", glow: "bg-primary/25" },
  accent: { tile: "from-accent/25 to-accent/5 border-accent/25", icon: "text-accent", glow: "bg-accent/25" },
  violet: { tile: "from-brand-to/25 to-brand-to/5 border-brand-to/25", icon: "text-brand-to", glow: "bg-brand-to/25" },
  amber: { tile: "from-warning/25 to-warning/5 border-warning/25", icon: "text-warning", glow: "bg-warning/25" },
  destructive: { tile: "from-destructive/25 to-destructive/5 border-destructive/25", icon: "text-destructive", glow: "bg-destructive/25" },
};

function StatCard({ label, value, icon: Icon, sub, tone = "primary", loading }: {
  label: string; value: string | number; icon: React.ElementType; sub?: string; tone?: Tone; loading?: boolean;
}) {
  const t = TONE[tone];
  return (
    <div className="panel panel-interactive group p-4">
      {/* Tinted corner wash, revealed on hover */}
      <div className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full ${t.glow} opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100`} />
      <div className="relative flex items-start gap-3.5">
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border bg-gradient-to-b ${t.tile}`}>
          <Icon className={`h-[18px] w-[18px] ${t.icon}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="section-label">{label}</p>
          {loading ? (
            <Skeleton className="mt-1.5 h-7 w-20" />
          ) : (
            <p className="mt-1 text-[1.75rem] font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground">
              {value}
            </p>
          )}
          {sub && <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

/** Chart container with a consistent title row. */
function Panel({ title, icon: Icon, className, children }: {
  title: string; icon?: React.ElementType; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={`panel p-5 ${className ?? ""}`}>
      <div className="mb-4 flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <h2 className="section-label">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function ChartState({ label }: { label: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}

/** Colour-swatch legend rows shared by the two pie charts. */
function LegendRows({ rows }: { rows: { key: string; label: string; value: string }[] }) {
  return (
    <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
      {rows.map((r, i) => (
        <div key={r.key} className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ background: COLORS[i % COLORS.length], boxShadow: `0 0 8px ${COLORS[i % COLORS.length]}` }}
            />
            <span className="truncate text-[11px] text-muted-foreground">{r.label}</span>
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[hsl(228_32%_8%/0.96)] px-3 py-2 text-xs shadow-xl backdrop-blur-md">
      {label !== undefined && <p className="mb-1 font-medium text-muted-foreground">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex items-center gap-2 font-medium text-foreground">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />
          {p.name}: <span className="tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetStatsOverview();
  const { data: hourly, isLoading: hourlyLoading } = useGetCallsByHour();
  const { data: hangupReasons, isLoading: reasonsLoading } = useGetHangupReasons();
  const { data: connectOutcomes, isLoading: outcomesLoading } = useGetConnectOutcomes();
  const { data: languageMix, isLoading: langLoading } = useGetLanguageMix();
  const { data: intelligence, isLoading: intelLoading } = useGetCallIntelligence();

  return (
    <div className="animate-fade-in space-y-7 p-6 md:p-8">
      <PageHeader
        title="Overview"
        subtitle="Real-time platform telemetry"
        icon={LayoutDashboard}
        actions={
          <div className="flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5">
            <span className="h-1.5 w-1.5 animate-pulse-ring rounded-full bg-accent" />
            <span className="text-[11px] font-medium text-accent">Live</span>
          </div>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Calls" value={(stats?.totalCalls ?? 0).toLocaleString()} icon={Phone} sub="All time" loading={statsLoading} />
        <StatCard label="Active Calls" value={stats?.activeCalls ?? 0} icon={Activity} sub="Right now" tone="accent" loading={statsLoading} />
        <StatCard label="Completed Today" value={stats?.completedToday ?? 0} icon={CheckCircle2} sub={statsLoading ? "" : `${stats?.successRate ?? 0}% success rate`} loading={statsLoading} />
        <StatCard label="Avg Duration" value={`${stats?.avgDurationSeconds ?? 0}s`} icon={Clock} sub="Per completed call" tone="violet" loading={statsLoading} />
        <StatCard label="AMD Accuracy" value={`${stats?.amdAccuracy ?? 0}%`} icon={Mic} sub="Human detection rate" tone="accent" loading={statsLoading} />
        <StatCard label="Memory Hit Rate" value={`${stats?.memoryHitRate ?? 0}%`} icon={Database} sub="L1+L2+L3 combined" loading={statsLoading} />
        <StatCard label="Active Bots" value={stats?.totalBots ?? 0} icon={Bot} sub="Registered agents" tone="amber" loading={statsLoading} />
        <StatCard label="LLM Engine" value="OpenAI" icon={Cpu} sub="Primary provider" tone="violet" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Call Volume */}
        <Panel title="Call Volume — Last 24h" icon={BarChart3} className="lg:col-span-2">
          {hourlyLoading ? (
            <ChartState label="Loading…" />
          ) : (
            <ResponsiveContainer width="100%" height={268}>
              <BarChart data={hourly ?? []} barSize={7} barGap={3}>
                <defs>
                  <linearGradient id="barInbound" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS[0]} stopOpacity={1} />
                    <stop offset="100%" stopColor={COLORS[0]} stopOpacity={0.35} />
                  </linearGradient>
                  <linearGradient id="barOutbound" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS[1]} stopOpacity={1} />
                    <stop offset="100%" stopColor={COLORS[1]} stopOpacity={0.35} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(226,16%,26%)" />
                <XAxis dataKey="hour" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={3} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={28} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(214,92%,60%,0.07)" }} />
                <Bar dataKey="inbound" name="Inbound" fill="url(#barInbound)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="outbound" name="Outbound" fill="url(#barOutbound)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="mt-3 flex gap-5 border-t border-border/60 pt-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
              <span className="text-[11px] text-muted-foreground">Inbound</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_hsl(var(--accent))]" />
              <span className="text-[11px] text-muted-foreground">Outbound</span>
            </div>
          </div>
        </Panel>

        {/* Hangup Reasons */}
        <Panel title="Hangup Reasons" icon={PieIcon}>
          {reasonsLoading ? (
            <ChartState label="Loading…" />
          ) : !hangupReasons?.length ? (
            <ChartState label="No data yet" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={hangupReasons} dataKey="count" nameKey="reason" cx="50%" cy="50%" outerRadius={72} innerRadius={46} paddingAngle={2} stroke="none">
                    {hangupReasons.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <LegendRows
                rows={hangupReasons.slice(0, 4).map((r) => ({ key: r.reason, label: r.reason, value: `${r.percentage}%` }))}
              />
            </>
          )}
        </Panel>
      </div>

      {/* Intelligence */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Connect Outcomes" icon={BarChart3}>
          {outcomesLoading ? (
            <ChartState label="Loading…" />
          ) : !connectOutcomes?.some((outcome) => outcome.count > 0) ? (
            /* The API now zero-fills every outcome, so emptiness is "all counts
               are zero" rather than "no rows returned". */
            <ChartState label="No data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={connectOutcomes} layout="vertical" barSize={11}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(226,16%,26%)" />
                <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis
                  dataKey="outcome"
                  type="category"
                  width={100}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value: string) => OUTCOME_LABELS[value] ?? value}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(214,92%,60%,0.07)" }} />
                <Bar dataKey="count" name="Calls" radius={[0, 4, 4, 0]}>
                  {(connectOutcomes ?? []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Language Mix" icon={Languages}>
          {langLoading ? (
            <ChartState label="Loading…" />
          ) : !languageMix?.length ? (
            <ChartState label="No data yet" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={168}>
                <PieChart>
                  <Pie data={languageMix} dataKey="count" nameKey="language" cx="50%" cy="50%" outerRadius={66} innerRadius={40} paddingAngle={2} stroke="none">
                    {(languageMix ?? []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <LegendRows
                rows={(languageMix ?? []).slice(0, 4).map((l) => ({ key: l.language, label: l.language.toUpperCase(), value: `${l.percentage}%` }))}
              />
            </>
          )}
        </Panel>

        {/* The API now returns a 14-day rollup, so the flat stat list is
            replaced by a trend chart with the headline figures beneath it. */}
        <Panel title="Barge-in & Escalation Rate" icon={Zap}>
          {intelLoading ? (
            <ChartState label="Loading…" />
          ) : !intelligence?.timeSeries?.some((point) => point.callsAnalyzed > 0) ? (
            <ChartState label="No data yet" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={175}>
                <LineChart data={intelligence.timeSeries} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(226,16%,26%)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(date: string) => date.slice(5)}
                    tick={AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                    interval={2}
                  />
                  <YAxis yAxisId="rate" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} />
                  <YAxis yAxisId="interruptions" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "10px" }} />
                  <Line yAxisId="rate" type="monotone" dataKey="bargeInRate" name="Barge-in rate (%)" stroke={COLORS[0]} strokeWidth={2} dot={false} />
                  <Line yAxisId="rate" type="monotone" dataKey="escalationRate" name="Escalation rate (%)" stroke={COLORS[4]} strokeWidth={2} dot={false} />
                  <Line yAxisId="interruptions" type="monotone" dataKey="avgInterruptionsPerCall" name="Avg interruptions" stroke={COLORS[3]} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-border">
                <div>
                  <p className="text-[10px] text-muted-foreground">Avg interruptions</p>
                  <p className="text-sm font-bold text-warning tabular-nums">{intelligence.avgInterruptionsPerCall}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Barge-in rate</p>
                  <p className="text-sm font-bold text-primary tabular-nums">{intelligence.bargeInRate}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Avg escalations</p>
                  <p className="text-sm font-bold text-destructive tabular-nums">{intelligence.avgEscalationsPerCall}</p>
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
