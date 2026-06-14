import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserCheck, UserX, Clock, Activity, CalendarDays } from "lucide-react";
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, eachDayOfInterval } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend,
} from "recharts";

import { RoleGuard } from "@/components/role-guard";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard · MySOC Labs Attendance" }] }),
  component: () => (
    <RoleGuard allow={["super_admin", "hr_admin"]} fallbackTo="/me">
      <Dashboard />
    </RoleGuard>
  ),
});

type Stats = {
  total: number;
  present: number;
  absent: number;
  late: number;
  recent: Array<{
    id: string;
    check_in: string | null;
    status: string;
    students: { name: string; student_id: string } | null;
  }>;
};

const LATE_CUTOFF = "09:30:00";

async function loadStats(): Promise<Stats> {
  const today = format(new Date(), "yyyy-MM-dd");

  const [{ count: total }, { data: todayAtt }, { data: recent }] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }),
    supabase.from("attendance").select("status, check_in").eq("date", today),
    supabase
      .from("attendance")
      .select("id, check_in, status, students:student_id(name, student_id)")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const totalStudents = total ?? 0;
  const present = todayAtt?.length ?? 0;
  const late =
    todayAtt?.filter((a) => {
      if (!a.check_in) return false;
      const t = new Date(a.check_in).toTimeString().slice(0, 8);
      return t > LATE_CUTOFF;
    }).length ?? 0;
  const absent = Math.max(0, totalStudents - present);

  return { total: totalStudents, present, absent, late, recent: (recent as Stats["recent"]) ?? [] };
}

async function loadTrends() {
  const today = new Date();
  const dailyStart = format(subDays(today, 6), "yyyy-MM-dd");
  const monthlyStart = format(startOfMonth(subMonths(today, 5)), "yyyy-MM-dd");

  const [{ count: totalEmployees }, { data: rows }] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }),
    supabase
      .from("attendance")
      .select("date, check_in")
      .gte("date", monthlyStart)
      .lte("date", format(today, "yyyy-MM-dd")),
  ]);

  const total = totalEmployees ?? 0;
  const all = rows ?? [];

  // Daily: last 7 days
  const daily = eachDayOfInterval({ start: subDays(today, 6), end: today }).map((d) => {
    const key = format(d, "yyyy-MM-dd");
    const dayRows = all.filter((r) => r.date === key);
    const late = dayRows.filter((r) => r.check_in && new Date(r.check_in).toTimeString().slice(0, 8) > LATE_CUTOFF).length;
    return {
      label: format(d, "EEE"),
      Present: dayRows.length,
      Late: late,
      Absent: Math.max(0, total - dayRows.length),
    };
  }).filter((_, i, arr) => arr.length <= 7 || i >= arr.length - 7);

  // Weekly: last 4 weeks
  const weekly = [3, 2, 1, 0].map((wAgo) => {
    const anchor = subDays(today, wAgo * 7);
    const wStart = startOfWeek(anchor, { weekStartsOn: 1 });
    const wEnd = endOfWeek(anchor, { weekStartsOn: 1 });
    const wRows = all.filter((r) => r.date >= format(wStart, "yyyy-MM-dd") && r.date <= format(wEnd, "yyyy-MM-dd"));
    return { label: `W${format(wStart, "w")}`, Present: wRows.length };
  });

  // Monthly: last 6 months
  const monthly = [5, 4, 3, 2, 1, 0].map((mAgo) => {
    const anchor = subMonths(today, mAgo);
    const mStart = startOfMonth(anchor);
    const mEnd = endOfMonth(anchor);
    const mRows = all.filter((r) => r.date >= format(mStart, "yyyy-MM-dd") && r.date <= format(mEnd, "yyyy-MM-dd"));
    return { label: format(anchor, "MMM"), Present: mRows.length };
  });

  return { daily, weekly, monthly };
}

function StatCard({ title, value, icon: Icon, tone }: { title: string; value: number; icon: typeof Users; tone: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-6">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
        </div>
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-6 w-6" />
        </div>
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard-stats"], queryFn: loadStats, refetchInterval: 15000 });
  const { data: trends } = useQuery({ queryKey: ["dashboard-trends"], queryFn: loadTrends, refetchInterval: 60000 });

  const axisStyle = { fontSize: 12, fill: "hsl(var(--muted-foreground))" };
  const tooltipStyle = {
    backgroundColor: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    color: "hsl(var(--popover-foreground))",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of today's attendance.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Employees" value={data?.total ?? 0} icon={Users} tone="bg-primary/15 text-primary" />
        <StatCard title="Present Today" value={data?.present ?? 0} icon={UserCheck} tone="bg-success/15 text-success" />
        <StatCard title="Absent Today" value={data?.absent ?? 0} icon={UserX} tone="bg-destructive/15 text-destructive" />
        <StatCard title="Late Entries" value={data?.late ?? 0} icon={Clock} tone="bg-warning/15 text-warning" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Daily Attendance Trend (Last 7 days)</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trends?.daily ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={axisStyle} />
                <YAxis tick={axisStyle} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Present" stroke="hsl(var(--success))" strokeWidth={2} />
                <Line type="monotone" dataKey="Late" stroke="hsl(var(--warning))" strokeWidth={2} />
                <Line type="monotone" dataKey="Absent" stroke="hsl(var(--destructive))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Weekly Attendance (Last 4 weeks)</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trends?.weekly ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={axisStyle} />
                <YAxis tick={axisStyle} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="Present" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Monthly Attendance (Last 6 months)</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trends?.monthly ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={axisStyle} />
                <YAxis tick={axisStyle} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="Present" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Recent Attendance Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !data?.recent.length ? (
            <p className="text-sm text-muted-foreground">No attendance recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{r.students?.name ?? "Unknown"}</p>
                    <p className="text-xs text-muted-foreground">{r.students?.student_id}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {r.check_in ? format(new Date(r.check_in), "MMM d, h:mm a") : "—"}
                    </span>
                    <Badge variant="secondary" className="capitalize">{r.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
