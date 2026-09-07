import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, ShieldOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const ROLES = ["ANALYST", "SUPERVISOR", "ADMIN", "OWNER"] as const;
const ROLE_COLORS: Record<string, string> = {
  OWNER: "bg-amber-100 text-amber-800 border-amber-200",
  ADMIN: "bg-blue-100 text-blue-800 border-blue-200",
  SUPERVISOR: "bg-green-100 text-green-800 border-green-200",
  ANALYST: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

interface User {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

async function fetchUsers(): Promise<User[]> {
  const r = await fetch(`${BASE}/api/v1/users`, { credentials: "include" });
  if (!r.ok) throw new Error("Failed to load users");
  return r.json() as Promise<User[]>;
}

export default function UsersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<string>("ANALYST");
  const [createErr, setCreateErr] = useState<string | null>(null);

  if (user?.role !== "OWNER") {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ShieldOff className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">Access Denied</p>
          <p className="text-sm text-muted-foreground">Only OWNER accounts can manage users.</p>
        </div>
      </div>
    );
  }

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: fetchUsers,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/v1/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: newEmail, password: newPassword, role: newRole }),
      });
      if (!r.ok) {
        const { error } = await r.json() as { error: string };
        throw new Error(error);
      }
      return r.json() as Promise<User>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setOpen(false);
      setNewEmail("");
      setNewPassword("");
      setNewRole("ANALYST");
      setCreateErr(null);
      toast({ title: "User created" });
    },
    onError: (e: Error) => setCreateErr(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, role, status }: { id: string; role?: string; status?: string }) => {
      const r = await fetch(`${BASE}/api/v1/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role, status }),
      });
      if (!r.ok) {
        const { error } = await r.json() as { error: string };
        throw new Error(error);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "User updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="animate-fade-in max-w-3xl space-y-6 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage team access for your organisation</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite a team member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {createErr && (
                <Alert variant="destructive">
                  <AlertDescription>{createErr}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="user@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Initial password</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !newEmail || !newPassword}
                className="w-full"
              >
                Create user
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-4 px-4 py-3 bg-card">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{u.email}</p>
                <p className="text-xs text-muted-foreground">
                  {u.id === user?.id ? "You · " : ""}
                  {u.status === "inactive" ? "Deactivated" : `Active since ${new Date(u.createdAt).toLocaleDateString()}`}
                </p>
              </div>
              <Badge className={`text-xs border ${ROLE_COLORS[u.role] ?? ""}`}>{u.role}</Badge>
              {u.id !== user?.id && (
                <div className="flex items-center gap-2">
                  <Select
                    value={u.role}
                    onValueChange={(role) => updateMutation.mutate({ id: u.id, role })}
                    disabled={updateMutation.isPending}
                  >
                    <SelectTrigger className="h-7 text-xs w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => updateMutation.mutate({ id: u.id, status: u.status === "active" ? "inactive" : "active" })}
                    disabled={updateMutation.isPending}
                  >
                    {u.status === "active" ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
