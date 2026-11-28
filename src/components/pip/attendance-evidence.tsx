import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck } from "lucide-react";
import { formatPipDate } from "@/components/pip/pip-ui";
import { getPipAttendance } from "@/lib/pip.functions";

// Attendance during the plan, as supporting evidence for HR and the manager.
export function AttendanceEvidence({ pipId }: { pipId: string }) {
  const attendanceFn = useServerFn(getPipAttendance);
  const query = useQuery({ queryKey: ["pip-attendance", pipId], queryFn: () => attendanceFn({ data: { pipId } }) });
  const data = query.data;
  const statuses = data ? Object.entries(data.counts).sort(([a], [b]) => a.localeCompare(b)) : [];

  return <div className="space-y-3">
    <h3 className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="h-4 w-4 text-primary" />Attendance during the plan</h3>
    {query.isLoading ? <p className="text-sm text-muted-foreground">Loading attendance…</p>
      : query.isError || !data ? <p className="text-sm text-destructive">Unable to load attendance.</p>
      : <>
        <p className="text-xs text-muted-foreground">{formatPipDate(data.from)} – {formatPipDate(data.to)} · {data.total} days recorded</p>
        {statuses.length === 0 ? <p className="text-sm text-muted-foreground">No attendance recorded in this period yet.</p>
          : <div className="flex flex-wrap gap-2">{statuses.map(([status, count]) => <span key={status} className="rounded-md border border-border px-3 py-1.5 text-sm"><span className="font-semibold tabular-nums">{count}</span> <span className="capitalize text-muted-foreground">{status.replaceAll("_", " ")}</span></span>)}</div>}
      </>}
  </div>;
}
