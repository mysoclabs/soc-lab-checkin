import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Download, Target, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { PipMetric, PipStatusBadge, formatPipDate, formatPipStatus } from "@/components/pip/pip-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { PIP_STATUSES } from "@/lib/pip-permissions";

// PIP report for the Reports page. The database limits HR Admins to their own plans.
export function PipReport() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [owner, setOwner] = useState("all");
  const plansQuery = useQuery({
    queryKey: ["pip-report"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_records")
        .select("id, employee_name, employee_email, department, hr_owner_email, manager_email, start_date, end_date, duration_days, status, progress_percent, close_reason")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const plans = plansQuery.data ?? [];
  const owners = [...new Set(plans.map((pip) => pip.hr_owner_email))].sort();
  const filtered = useMemo(() => plans.filter((pip) =>
    (!from || pip.start_date >= from) && (!to || pip.start_date <= to) && (owner === "all" || pip.hr_owner_email === owner),
  ), [plans, from, to, owner]);

  const count = (status: string) => filtered.filter((pip) => pip.status === status).length;
  const decided = count("completed") + count("unsuccessful");
  const successRate = decided ? `${Math.round((count("completed") / decided) * 100)}%` : "—";
  const avgDuration = filtered.length ? Math.round(filtered.reduce((sum, pip) => sum + pip.duration_days, 0) / filtered.length) : 0;

  function exportCsv() {
    if (!filtered.length) return toast.info("No PIPs match these filters");
    const columns = ["employee_name", "employee_email", "department", "hr_owner_email", "manager_email", "start_date", "end_date", "duration_days", "status", "progress_percent", "close_reason"] as const;
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [columns.join(","), ...filtered.map((pip) => columns.map((column) => escape(pip[column])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mysoclabs-pip-report-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1"><Label htmlFor="pip-report-from">Started from</Label><Input id="pip-report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
      <div className="grid gap-1"><Label htmlFor="pip-report-to">Started to</Label><Input id="pip-report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
      <div className="grid gap-1"><Label>HR owner</Label><Select value={owner} onValueChange={setOwner}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All HR owners</SelectItem>{owners.map((email) => <SelectItem key={email} value={email}>{email}</SelectItem>)}</SelectContent></Select></div>
      <Button variant="outline" className="ml-auto" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <PipMetric label="PIPs in period" value={filtered.length} icon={Target} caption={`${count("active") + count("extended")} running`} />
      <PipMetric label="Success rate" value={successRate} icon={TrendingUp} caption={`${count("completed")} successful of ${decided} closed`} />
      <PipMetric label="Extended" value={count("extended")} icon={Clock} caption="Currently extended" />
      <PipMetric label="Average duration" value={filtered.length ? `${avgDuration} days` : "—"} icon={CheckCircle2} />
    </div>
    <div className="flex flex-wrap gap-2">{PIP_STATUSES.map((status) => <span key={status} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5"><PipStatusBadge status={status} /><span className="text-sm font-semibold tabular-nums">{count(status)}</span></span>)}</div>
    {plansQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading PIPs…</p>
      : plansQuery.isError ? <p className="text-sm text-destructive">Unable to load PIPs.</p>
      : <div className="overflow-x-auto rounded-md border border-border"><table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Employee</th><th className="p-2">HR owner</th><th className="p-2">Manager</th><th className="p-2">Start</th><th className="p-2">End</th><th className="p-2">Status</th></tr></thead>
        <tbody>{filtered.map((pip) => <tr key={pip.id} className="border-t border-border"><td className="p-2">{pip.employee_name}</td><td className="p-2">{pip.hr_owner_email}</td><td className="p-2">{pip.manager_email ?? "—"}</td><td className="p-2 whitespace-nowrap">{formatPipDate(pip.start_date)}</td><td className="p-2 whitespace-nowrap">{formatPipDate(pip.end_date)}</td><td className="p-2"><PipStatusBadge status={formatPipStatus(pip.status)} /></td></tr>)}</tbody>
      </table></div>}
  </div>;
}
