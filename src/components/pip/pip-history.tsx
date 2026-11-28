import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PipStatusBadge, formatPipDate, formatPipStatus } from "@/components/pip/pip-ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

// PIP history on the employee profile. HR Admins only see the plans they own (database rule).
export function PipHistory({ employeeId }: { employeeId: string }) {
  const query = useQuery({
    queryKey: ["pip-history", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_records")
        .select("id, start_date, end_date, status, close_reason, hr_owner_email")
        .eq("employee_id", employeeId).order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const plans = query.data ?? [];

  return <Card>
    <CardHeader><CardTitle>PIP history</CardTitle></CardHeader>
    <CardContent>
      {query.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : plans.length === 0 ? <p className="text-sm text-muted-foreground">No performance improvement plans.</p>
        : <ul className="divide-y divide-border">{plans.map((pip) => <li key={pip.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <Link to="/pip/$id" params={{ id: pip.id }} className="text-sm font-medium hover:text-primary">{formatPipDate(pip.start_date)} – {formatPipDate(pip.end_date)}</Link>
            <p className="text-xs text-muted-foreground">HR owner {pip.hr_owner_email}{pip.close_reason ? ` · ${pip.close_reason}` : ""}</p>
          </div>
          <PipStatusBadge status={formatPipStatus(pip.status)} />
        </li>)}</ul>}
    </CardContent>
  </Card>;
}
