import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarClock } from "lucide-react";
import { format } from "date-fns";
import { RoleGuard } from "@/components/role-guard";
import { useUserRole } from "@/hooks/use-role";

export const Route = createFileRoute("/_authenticated/my-attendance")({
  head: () => ({ meta: [{ title: "My Attendance · MySOC Labs" }] }),
  component: () => (
    <RoleGuard allow={["employee", "hr_admin", "super_admin"]} fallbackTo="/">
      <MyAttendance />
    </RoleGuard>
  ),
});

function hoursBetween(checkIn: string | null, checkOut: string | null) {
  if (!checkIn || !checkOut) return "—";
  const h = (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 3600000;
  return h > 0 ? `${h.toFixed(2)}h` : "—";
}

function MyAttendance() {
  const { email } = useUserRole();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["my-attendance", email],
    enabled: !!email,
    queryFn: async () => {
      const { data: emp } = await supabase.from("students").select("id").eq("email", email!).maybeSingle();
      if (!emp) return [];
      const { data, error } = await supabase
        .from("attendance")
        .select("id, date, check_in, check_out, status")
        .eq("student_id", emp.id)
        .order("date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CalendarClock className="h-6 w-6 text-primary" /> My Attendance
        </h1>
        <p className="text-sm text-muted-foreground">Your recent check-in history.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent records</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Check-in</TableHead>
                  <TableHead>Check-out</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No attendance records yet.</TableCell></TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.date}</TableCell>
                    <TableCell>{r.check_in ? format(new Date(r.check_in), "HH:mm") : "—"}</TableCell>
                    <TableCell>{r.check_out ? format(new Date(r.check_out), "HH:mm") : "—"}</TableCell>
                    <TableCell>{hoursBetween(r.check_in, r.check_out)}</TableCell>
                    <TableCell><Badge variant="secondary" className="capitalize">{r.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
