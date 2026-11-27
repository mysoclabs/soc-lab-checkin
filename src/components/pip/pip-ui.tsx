import type { LucideIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { PipStatus } from "@/lib/pip-permissions";

const statusLabels: Record<PipStatus, string> = {
  draft: "Draft",
  active: "Active",
  extended: "Extended",
  completed: "Completed",
  unsuccessful: "Unsuccessful",
  cancelled: "Cancelled",
};

export function PipStatusBadge({ status }: { status: PipStatus }) {
  const colorClass = status === "completed"
    ? "bg-success/15 text-success"
    : status === "unsuccessful" || status === "cancelled"
      ? "bg-destructive/15 text-destructive"
      : status === "extended"
        ? "bg-warning/15 text-warning"
        : status === "active"
          ? "bg-primary/15 text-primary"
          : "bg-muted text-muted-foreground";
  return <Badge variant="secondary" className={colorClass}>{statusLabels[status]}</Badge>;
}

const goalStatuses: Record<string, { label: string; className: string }> = {
  complete: { label: "Met", className: "bg-success/15 text-success" },
  in_progress: { label: "In progress", className: "bg-warning/15 text-warning" },
  not_started: { label: "Not started", className: "bg-muted text-muted-foreground" },
};

export function GoalStatusBadge({ status }: { status: string }) {
  const { label, className } = goalStatuses[status] ?? goalStatuses.not_started;
  return <Badge variant="secondary" className={className}>{label}</Badge>;
}

export function PipMetric({
  label,
  value,
  icon: Icon,
  caption,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  caption?: string;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-28 items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
          {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </CardContent>
    </Card>
  );
}

export function PipProgress({ value, compact = false }: { value: number; compact?: boolean }) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={compact ? "min-w-24" : "space-y-2"}>
      <div className="flex items-center justify-between gap-2 text-xs">
        {!compact && <span className="text-muted-foreground">Progress</span>}
        <span className="font-medium tabular-nums">{safeValue}%</span>
      </div>
      <Progress value={safeValue} className="h-2" />
    </div>
  );
}

export function formatPipDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? "—" : format(date, "dd MMM yyyy");
}

export function formatPipStatus(value: string): PipStatus {
  if (value === "draft" || value === "active" || value === "extended" || value === "completed" || value === "unsuccessful" || value === "cancelled") {
    return value;
  }
  return "draft";
}