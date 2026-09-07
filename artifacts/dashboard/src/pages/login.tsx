import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Radio, Loader2, AlertCircle, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const { login, loginError, loginPending, isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Already logged in — redirect to dashboard
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/");
    }
  }, [isAuthenticated, isLoading, navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    login({ email: email.trim(), password });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* Ambient backdrop: blueprint grid + two drifting brand orbs */}
      <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-40" />
      <div className="pointer-events-none absolute -left-24 top-1/4 h-80 w-80 animate-float rounded-full bg-brand-from/20 blur-[110px]" />
      <div
        className="pointer-events-none absolute -right-20 bottom-1/4 h-80 w-80 animate-float rounded-full bg-brand-to/20 blur-[110px]"
        style={{ animationDelay: "-3.5s" }}
      />

      <div className="relative w-full max-w-[26rem] animate-fade-in-up">
        {/* Logo */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="relative">
            <div className="brand-gradient flex h-11 w-11 items-center justify-center rounded-2xl shadow-[0_10px_30px_-8px_hsl(var(--primary)/0.9)] ring-1 ring-inset ring-white/25">
              <Radio className="h-5 w-5 text-white" />
            </div>
            <div className="brand-gradient pointer-events-none absolute inset-0 -z-10 rounded-2xl opacity-60 blur-xl" />
          </div>
          <div>
            <p className="gradient-text text-xl font-bold uppercase leading-none tracking-[0.2em]">
              VoxAgent
            </p>
            <p className="mt-1.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Control Plane
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="panel p-7 shadow-2xl">
          <div className="mb-6">
            <h1 className="text-[1.375rem] font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your credentials to continue
            </p>
          </div>

          {loginError && (
            <Alert variant="destructive" className="mb-5 animate-fade-in">
              <AlertCircle />
              <AlertDescription>{loginError.message}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@voxagent.local"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={loginPending}>
              {loginPending && <Loader2 className="animate-spin" />}
              {loginPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-6 flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
            <ShieldCheck className="mt-px h-3.5 w-3.5 flex-shrink-0 text-accent" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Default credentials:{" "}
              <span className="font-mono text-foreground/80">admin@voxagent.local</span>
              {" / "}
              <span className="font-mono text-foreground/80">voxagent</span>
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] tracking-wide text-muted-foreground/70">
          Secured session · VoxAgent Control Plane
        </p>
      </div>
    </div>
  );
}
