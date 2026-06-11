import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserCheck, UserX, Clock, Activity } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard · MySOC Labs Attendance" }] }),
  component: Dashboard,
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

async function loadStats(): Promise<Stats> {
  const today = format(new Date(), "yyyy-MM-dd");
  const lateCutoff = "09:30:00";

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
      return t > lateCutoff;
    }).length ?? 0;
  const absent = Math.max(0, totalStudents - present);

  return { total: totalStudents, present, absent, late, recent: (recent as Stats["recent"]) ?? [] };
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of today's attendance.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Students" value={data?.total ?? 0} icon={Users} tone="bg-primary/15 text-primary" />
        <StatCard title="Present Today" value={data?.present ?? 0} icon={UserCheck} tone="bg-success/15 text-success" />
        <StatCard title="Absent Today" value={data?.absent ?? 0} icon={UserX} tone="bg-destructive/15 text-destructive" />
        <StatCard title="Late Entries" value={data?.late ?? 0} icon={Clock} tone="bg-warning/15 text-warning" />
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
