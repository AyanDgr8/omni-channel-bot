import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AuthUser {
  id: string;
  email: string;
  role: "OWNER" | "ADMIN" | "SUPERVISOR" | "ANALYST";
  tenantId: string;
  tenantName: string | null;
  tenantSlug: string | null;
}

async function fetchMe(): Promise<AuthUser | null> {
  const r = await fetch(`${BASE}/api/v1/auth/me`, { credentials: "include" });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error("Failed to fetch current user");
  return r.json() as Promise<AuthUser>;
}

export function useAuth() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const r = await fetch(`${BASE}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        const { error } = await r.json() as { error: string };
        throw new Error(error ?? "Login failed");
      }
      return r.json() as Promise<AuthUser>;
    },
    onSuccess: (data) => {
      qc.setQueryData(["auth", "me"], data);
      navigate("/");
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch(`${BASE}/api/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    },
    onSuccess: () => {
      qc.setQueryData(["auth", "me"], null);
      qc.clear();
      navigate("/login");
    },
  });

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: !!user,
    login: loginMutation.mutate,
    loginAsync: loginMutation.mutateAsync,
    loginError: loginMutation.error,
    loginPending: loginMutation.isPending,
    logout: logoutMutation.mutate,
    logoutPending: logoutMutation.isPending,
  };
}
