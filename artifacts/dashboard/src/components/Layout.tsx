import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
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
} from "lucide-react";

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

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-border bg-sidebar">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
            <Radio className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-bold text-sidebar-foreground tracking-widest uppercase">VoxAgent</p>
            <p className="text-[10px] text-muted-foreground tracking-wider">Control Plane</p>
          </div>
        </div>
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
        </nav>
        <div className="px-4 py-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-[11px] text-muted-foreground">System Operational</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
