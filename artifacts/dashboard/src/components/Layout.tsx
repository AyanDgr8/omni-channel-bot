import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard,
  Phone,
  Bot,
  Settings,
  Brain,
  MessageSquare,
  AudioLines,
  Calendar,
  Radio,
  GitBranch,
  MailOpen,
  Users,
  LogOut,
  Loader2,
  Building2,
  Key,
  BookOpen,
  ShieldCheck,
  Megaphone,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

type Role = "OWNER" | "ADMIN" | "SUPERVISOR" | "ANALYST";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  /** Roles allowed to see the item; omit for everyone. */
  roles?: Role[];
};

type NavSection = { title: string; items: NavItem[] };

/**
 * Grouping the routes turns a flat 12-item list into three scannable blocks,
 * and folds the role-gated links into the same declarative shape.
 */
const NAV: NavSection[] = [
  {
    title: "Operations",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/calls", label: "Call Log", icon: Phone },
      { href: "/bots", label: "Bot Network", icon: Bot },
      { href: "/messaging", label: "Messaging Hub", icon: MessageSquare },
      { href: "/voice-agent", label: "Talk to Vox", icon: AudioLines },
      { href: "/calendar", label: "Calendar", icon: Calendar },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/compliance", label: "Compliance", icon: ShieldCheck },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { href: "/memory", label: "Knowledge Base", icon: Brain },
      { href: "/flow", label: "Flow Builder", icon: GitBranch },
      { href: "/email-agent", label: "Email Agent", icon: MailOpen },
      { href: "/config", label: "Configuration", icon: Settings },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/providers", label: "Providers", icon: Key, roles: ["ADMIN", "OWNER"] },
      { href: "/model-catalog", label: "Model Catalog", icon: BookOpen, roles: ["ADMIN", "OWNER"] },
      { href: "/users", label: "Users", icon: Users, roles: ["OWNER"] },
    ],
  },
];

const ROLE_COLOR: Record<string, string> = {
  OWNER: "border-amber-400/30 bg-amber-400/12 text-amber-300",
  ADMIN: "border-primary/30 bg-primary/12 text-primary-soft",
  SUPERVISOR: "border-accent/30 bg-accent/12 text-accent",
  ANALYST: "border-white/10 bg-white/[0.05] text-muted-foreground",
};

function initialsOf(email?: string | null) {
  const name = email?.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  const initials = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
  return initials.toUpperCase();
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const { icon: Icon, href, label } = item;
  return (
    <Link href={href}>
      <div
        className={cn(
          "group relative mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm",
          "transition-[background-color,color,transform] duration-200",
          active
            ? "bg-gradient-to-r from-primary/20 via-primary/10 to-transparent font-medium text-primary-soft"
            : "text-sidebar-foreground hover:bg-white/[0.045] hover:text-foreground"
        )}
      >
        {/* Left rail marker: grows in on the active route */}
        <span
          className={cn(
            "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-brand-from to-brand-to transition-all duration-300",
            active ? "h-5 opacity-100 shadow-[0_0_10px_hsl(var(--primary)/0.9)]" : "h-0 opacity-0"
          )}
        />
        <Icon
          className={cn(
            "h-4 w-4 flex-shrink-0 transition-colors duration-200",
            active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
          )}
        />
        <span className="truncate">{label}</span>
      </div>
    </Link>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout, logoutPending } = useAuth();

  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ---------------------------------------------------------------- */}
      {/* Sidebar                                                          */}
      {/* ---------------------------------------------------------------- */}
      <aside className="relative flex w-60 flex-shrink-0 flex-col bg-gradient-to-b from-sidebar via-sidebar to-[hsl(230_26%_11%)]">
        {/* Gradient hairline instead of a flat 1px border */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />

        {/* Branding + tenant */}
        <div className="space-y-3 px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl shadow-[0_6px_18px_-6px_hsl(var(--primary)/0.9)] ring-1 ring-inset ring-white/25">
                <Radio className="h-[18px] w-[18px] text-white" />
              </div>
              {/* Soft halo behind the mark */}
              <div className="brand-gradient pointer-events-none absolute inset-0 -z-10 rounded-xl blur-lg opacity-55" />
            </div>
            <div className="min-w-0">
              <p className="gradient-text text-[15px] font-bold uppercase leading-none tracking-[0.18em]">
                VoxAgent
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Control Plane
              </p>
            </div>
          </div>

          {user?.tenantName && (
            <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5">
              <Building2 className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <span className="truncate text-[11px] text-muted-foreground">
                {user.tenantName}
              </span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-5 overflow-y-auto pb-3">
          {NAV.map((section) => {
            const items = section.items.filter(
              (i) => !i.roles || (user?.role && i.roles.includes(user.role as Role))
            );
            if (!items.length) return null;
            return (
              <div key={section.title} className="space-y-0.5">
                <p className="section-label px-5 pb-1.5">{section.title}</p>
                {items.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} />
                ))}
              </div>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-white/[0.06] px-3 py-3">
          {user ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2">
              <div className="brand-gradient flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white ring-1 ring-inset ring-white/20">
                {initialsOf(user.email)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-sidebar-foreground">
                  {user.email}
                </p>
                <span
                  className={cn(
                    "mt-1 inline-block rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.08em]",
                    ROLE_COLOR[user.role] ?? ROLE_COLOR.ANALYST
                  )}
                >
                  {user.role}
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    onClick={() => logout()}
                    disabled={logoutPending}
                  >
                    {logoutPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <LogOut />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign out</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-1 py-1.5">
              <span className="h-2 w-2 animate-pulse-ring rounded-full bg-accent" />
              <span className="text-[11px] text-muted-foreground">
                System Operational
              </span>
            </div>
          )}
        </div>
      </aside>

      {/* ---------------------------------------------------------------- */}
      {/* Main                                                             */}
      {/* ---------------------------------------------------------------- */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
