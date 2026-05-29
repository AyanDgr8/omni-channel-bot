import { useGetStatsOverview, useGetCallsByHour, useGetHangupReasons } from "@workspace/api-client-react";
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
} from "recharts";
import { Phone, Bot, Activity, Clock, Cpu, Database, CheckCircle2, Mic } from "lucide-react";

const COLORS = ["hsl(210,100%,50%)", "hsl(150,100%,40%)", "hsl(280,100%,60%)", "hsl(40,100%,50%)", "hsl(0,84%,60%)"];

function StatCard({ label, value, icon: Icon, sub, color = "primary" }: {
  label: string; value: string | number; icon: React.ElementType; sub?: string; color?: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded flex items-center justify-center flex-shrink-0 ${color === "accent" ? "bg-accent/15" : color === "destructive" ? "bg-destructive/15" : "bg-primary/15"}`}>
        <Icon className={`w-4 h-4 ${color === "accent" ? "text-accent" : color === "destructive" ? "text-destructive" : "text-primary"}`} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-foreground mt-0.5 tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-popover-border rounded px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="font-medium">{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetStatsOverview();
  const { data: hourly, isLoading: hourlyLoading } = useGetCallsByHour();
  const { data: hangupReasons, isLoading: reasonsLoading } = useGetHangupReasons();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-bold text-foreground tracking-tight">Overview</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Real-time platform telemetry</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total Calls"
          value={statsLoading ? "—" : (stats?.totalCalls ?? 0).toLocaleString()}
          icon={Phone}
          sub="All time"
        />
        <StatCard
          label="Active Calls"
          value={statsLoading ? "—" : stats?.activeCalls ?? 0}
          icon={Activity}
          sub="Right now"
          color="accent"
        />
        <StatCard
          label="Completed Today"
          value={statsLoading ? "—" : stats?.completedToday ?? 0}
          icon={CheckCircle2}
          sub={statsLoading ? "" : `${stats?.successRate ?? 0}% success rate`}
        />
        <StatCard
          label="Avg Duration"
          value={statsLoading ? "—" : `${stats?.avgDurationSeconds ?? 0}s`}
          icon={Clock}
          sub="Per completed call"
        />
        <StatCard
          label="AMD Accuracy"
          value={statsLoading ? "—" : `${stats?.amdAccuracy ?? 0}%`}
          icon={Mic}
          sub="Human detection rate"
          color="accent"
        />
        <StatCard
          label="Memory Hit Rate"
          value={statsLoading ? "—" : `${stats?.memoryHitRate ?? 0}%`}
          icon={Database}
          sub="L1+L2+L3 combined"
        />
        <StatCard
          label="Active Bots"
          value={statsLoading ? "—" : stats?.totalBots ?? 0}
          icon={Bot}
          sub="Registered agents"
        />
        <StatCard
          label="LLM Engine"
          value="OpenAI"
          icon={Cpu}
          sub="Primary provider"
          color="accent"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Call Volume Chart */}
        <div className="lg:col-span-2 bg-card border border-card-border rounded p-4">
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">Call Volume — Last 24h</h2>
          {hourlyLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-xs">Loading...</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hourly ?? []} barSize={6} barGap={2}>
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "hsl(210,20%,60%)" }} axisLine={false} tickLine={false} interval={3} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(210,20%,60%)" }} axisLine={false} tickLine={false} width={28} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="inbound" name="Inbound" fill="hsl(210,100%,50%)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="outbound" name="Outbound" fill="hsl(150,100%,40%)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-primary" /><span className="text-[11px] text-muted-foreground">Inbound</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-accent" /><span className="text-[11px] text-muted-foreground">Outbound</span></div>
          </div>
        </div>

        {/* Hangup Reasons Pie */}
        <div className="bg-card border border-card-border rounded p-4">
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">Hangup Reasons</h2>
          {reasonsLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-xs">Loading...</div>
          ) : !hangupReasons?.length ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-xs">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={hangupReasons} dataKey="count" nameKey="reason" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                  {hangupReasons.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
          {hangupReasons && hangupReasons.length > 0 && (
            <div className="space-y-1 mt-2">
              {hangupReasons.slice(0, 4).map((r, i) => (
                <div key={r.reason} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">{r.reason}</span>
                  </div>
                  <span className="text-[10px] text-foreground font-medium">{r.percentage}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
