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
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calls", label: "Call Log", icon: Phone },
  { href: "/bots", label: "Bot Network", icon: Bot },
  { href: "/config", label: "Configuration", icon: Settings },
  { href: "/memory", label: "Knowledge Base", icon: Brain },
  { href: "/flow", label: "Flow Builder", icon: GitBranch },
  { href: "/email-agent", label: "Email Agent", icon: MailOpen },
  { href: "/messaging", label: "Messaging Hub", icon: MessageSquare },
  { href: "/calendar", label: "Calendar", icon: Calendar },
];

/** Role badge colours */
const ROLE_COLOR: Record<string, string> = {
  OWNER: "bg-amber-500/15 text-amber-600",
  ADMIN: "bg-blue-500/15 text-blue-600",
  SUPERVISOR: "bg-green-500/15 text-green-600",
  ANALYST: "bg-zinc-500/15 text-zinc-500",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout, logoutPending } = useAuth();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-border bg-sidebar">

        {/* Branding + tenant */}
        <div className="px-4 py-4 border-b border-sidebar-border space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
              <Radio className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm font-bold text-sidebar-foreground tracking-widest uppercase">VoxAgent</p>
              <p className="text-[10px] text-muted-foreground tracking-wider">Control Plane</p>
            </div>
          </div>
          {user?.tenantName && (
            <div className="flex items-center gap-1.5 px-1">
              <Building2 className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="text-[11px] text-muted-foreground truncate">{user.tenantName}</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link key={href} href={href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 mx-2 rounded text-sm cursor-pointer transition-colors",
                    active
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </div>
              </Link>
            );
          })}

          {/* Providers link — visible to ADMIN+ */}
          {(user?.role === "ADMIN" || user?.role === "OWNER") && (
            <Link href="/providers">
              <div
                className={cn(
                  "flex items-center gap-3 px-4 py-2 mx-2 rounded text-sm cursor-pointer transition-colors",
                  location.startsWith("/providers")
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Key className="w-4 h-4 flex-shrink-0" />
                Providers
              </div>
            </Link>
          )}

          {/* Model Catalog link — visible to ADMIN+ */}
          {(user?.role === "ADMIN" || user?.role === "OWNER") && (
            <Link href="/model-catalog">
              <div
                className={cn(
                  "flex items-center gap-3 px-4 py-2 mx-2 rounded text-sm cursor-pointer transition-colors",
                  location.startsWith("/model-catalog")
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <BookOpen className="w-4 h-4 flex-shrink-0" />
                Model Catalog
              </div>
            </Link>
          )}

          {/* Users link — visible only to OWNER */}
          {user?.role === "OWNER" && (
            <Link href="/users">
              <div
                className={cn(
                  "flex items-center gap-3 px-4 py-2 mx-2 rounded text-sm cursor-pointer transition-colors",
                  location.startsWith("/users")
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Users className="w-4 h-4 flex-shrink-0" />
                Users
              </div>
            </Link>
          )}
        </nav>

        {/* User footer */}
        <div className="px-3 py-3 border-t border-sidebar-border space-y-2">
          {user ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-sidebar-foreground truncate">{user.email}</p>
                <span className={cn("inline-block text-[9px] font-semibold px-1 py-0.5 rounded uppercase tracking-wider mt-0.5", ROLE_COLOR[user.role] ?? "")}>
                  {user.role}
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => logout()}
                    disabled={logoutPending}
                  >
                    {logoutPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <LogOut className="w-3.5 h-3.5" />
                    }
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign out</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span className="text-[11px] text-muted-foreground">System Operational</span>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
