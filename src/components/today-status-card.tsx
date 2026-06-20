import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, LogIn, LogOut, Activity } from "lucide-react";
import { useOfficeSettings, formatTimeStr, timeOnDate } from "@/hooks/use-office-settings";

type AttendanceRow = {
  id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
};

function formatDuration(ms: number) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function statusTone(status: string) {
  switch (status) {
    case "present": return "bg-success/15 text-success";
    case "late": return "bg-warning/15 text-warning";
    case "half_day":
    case "half-day": return "bg-warning/15 text-warning";
    case "on_leave":
    case "leave": return "bg-primary/15 text-primary";
    case "absent": return "bg-destructive/15 text-destructive";
    default: return "bg-muted text-muted-foreground";
  }
}

function deriveStatus(row: AttendanceRow | null, halfDayThreshold: string, onLeave: boolean): string {
  if (onLeave) return "on_leave";
  if (!row || !row.check_in) return "absent";
  if (row.status) return row.status;
  const inTime = new Date(row.check_in);
  const halfCutoff = timeOnDate(halfDayThreshold, inTime);
  if (inTime > halfCutoff) return "half_day";
  return "present";
}

export function TodayStatusCard({ email }: { email: string | null | undefined }) {
  const { data: office } = useOfficeSettings();
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const today = format(now, "yyyy-MM-dd");

  const { data: employee } = useQuery({
    queryKey: ["self-employee", email],
    enabled: !!email,
    queryFn: async () => {
      const { data } = await supabase.from("students").select("id, name").eq("email", email!).maybeSingle();
      return data;
    },
  });

  const { data: today_att } = useQuery({
    queryKey: ["self-today-attendance", employee?.id, today],
    enabled: !!employee?.id,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("attendance")
        .select("id, date, check_in, check_out, status")
        .eq("student_id", employee!.id)
        .eq("date", today)
        .maybeSingle();
      return (data as AttendanceRow | null) ?? null;
    },
  });

  const { data: onLeaveToday } = useQuery({
    queryKey: ["self-leave-today", employee?.id, today],
    enabled: !!employee?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("leave_requests")
        .select("id")
        .eq("employee_id", employee!.id)
        .eq("status", "approved")
        .lte("start_date", today)
        .gte("end_date", today)
        .limit(1);
      return (data?.length ?? 0) > 0;
    },
  });

  if (!email) return null;

  const startTime = office?.office_start_time ?? "09:30:00";
  const endTime = office?.office_end_time ?? "18:30:00";
  const workingHours = office?.working_hours ?? 8;
  const halfDayThreshold = office?.half_day_threshold ?? "11:00:00";

  const checkIn = today_att?.check_in ? new Date(today_att.check_in) : null;
  const checkOut = today_att?.check_out ? new Date(today_att.check_out) : null;
  const status = deriveStatus(today_att ?? null, halfDayThreshold, !!onLeaveToday);

  const expectedCheckout = checkIn
    ? new Date(checkIn.getTime() + workingHours * 3600_000)
    : timeOnDate(endTime, now);

  const elapsedMs = checkIn ? (checkOut ?? now).getTime() - checkIn.getTime() : 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" /> Today
        </CardTitle>
        <Badge className={statusTone(status)} variant="secondary">
          {status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Metric
            icon={<LogIn className="h-4 w-4" />}
            label="Check-In"
            value={checkIn ? format(checkIn, "hh:mm a") : "—"}
          />
          <Metric
            icon={<Clock className="h-4 w-4" />}
            label="Working Time"
            value={checkIn ? formatDuration(elapsedMs) : "00h 00m 00s"}
            mono
            live={!!checkIn && !checkOut}
          />
          <Metric
            icon={<LogOut className="h-4 w-4" />}
            label="Expected Checkout"
            value={format(expectedCheckout, "hh:mm a")}
          />
          <Metric
            icon={<Clock className="h-4 w-4" />}
            label="Office Time"
            value={`${formatTimeStr(startTime)} – ${formatTimeStr(endTime)}`}
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Timeline</p>
          <ol className="relative space-y-3 border-l border-border pl-4">
            {checkIn && (
              <TimelineItem time={format(checkIn, "hh:mm a")} label="Check-In" tone="bg-success" />
            )}
            {checkOut && (
              <TimelineItem time={format(checkOut, "hh:mm a")} label="Check-Out" tone="bg-primary" />
            )}
            {!checkIn && (
              <li className="text-xs text-muted-foreground">No activity yet today.</li>
            )}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  icon, label, value, mono, live,
}: { icon: React.ReactNode; label: string; value: string; mono?: boolean; live?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}<span>{label}</span>
        {live && <span className="ml-auto flex items-center gap-1 text-[10px] text-success">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> live
        </span>}
      </div>
      <p className={`mt-1 text-lg font-semibold tracking-tight ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function TimelineItem({ time, label, tone }: { time: string; label: string; tone: string }) {
  return (
    <li className="relative">
      <span className={`absolute -left-[21px] top-1 h-3 w-3 rounded-full ring-2 ring-background ${tone}`} />
      <p className="text-sm font-medium">{time} — {label}</p>
    </li>
  );
}
