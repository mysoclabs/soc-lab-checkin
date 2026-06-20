import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Search, Shield } from "lucide-react";
import { RoleGuard } from "@/components/role-guard";

export const Route = createFileRoute("/_authenticated/audit-logs")({
  head: () => ({ meta: [{ title: "Audit Logs · MySOC Labs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin", "hr_admin"]} fallbackTo="/me">
      <AuditLogsPage />
    </RoleGuard>
  ),
});

type Log = {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
};

function AuditLogsPage() {
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [date, setDate] = useState("");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit-logs"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Log[];
    },
  });

  const entities = useMemo(() => Array.from(new Set(logs.map((l) => l.entity))), [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (entityFilter !== "all" && l.entity !== entityFilter) return false;
      if (date && !l.created_at.startsWith(date)) return false;
      if (!q) return true;
      return (
        (l.user_name ?? "").toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.entity.toLowerCase().includes(q) ||
        (l.entity_id ?? "").toLowerCase().includes(q)
      );
    });
  }, [logs, search, entityFilter, date]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Shield className="h-6 w-6" /> Audit Logs
        </h1>
        <p className="text-sm text-muted-foreground">Track every action performed in the system.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search user, action, entity…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger><SelectValue placeholder="Entity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              {entities.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No audit entries.</TableCell></TableRow>
              ) : filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-xs">{format(new Date(l.created_at), "MMM d, h:mm:ss a")}</TableCell>
                  <TableCell className="text-sm">{l.user_name ?? "—"}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{l.action.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell className="text-sm">
                    <div>{l.entity}</div>
                    {l.entity_id && <div className="text-xs text-muted-foreground">{l.entity_id}</div>}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground" title={l.details ? JSON.stringify(l.details) : ""}>
                    {l.details ? JSON.stringify(l.details) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.ip_address ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
