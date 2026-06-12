import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Calendar as CalendarIcon, LogOut as LogOutIcon } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({ meta: [{ title: "Attendance · MySOC Labs" }] }),
  component: AttendancePage,
});

type Row = {
  id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  students: { id: string; name: string; student_id: string; department: string | null } | null;
};

function AttendancePage() {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [query, setQuery] = useState("");

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ["attendance", date],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("attendance")
        .select("id, date, check_in, check_out, status, students:student_id(id, name, student_id, department)")
        .eq("date", date)
        .order("check_in", { ascending: true });
      if (error) throw error;
      return (data as Row[]) ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) =>
      [r.students?.name ?? "", r.students?.student_id ?? ""].some((v) => v.toLowerCase().includes(q)),
    );
  }, [data, query]);

  const handleCheckOut = async (row: Row) => {
    const { error } = await supabase
      .from("attendance")
      .update({ check_out: new Date().toISOString() })
      .eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success(`Checked out ${row.students?.name ?? ""}`);
    refetch();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
        <p className="text-sm text-muted-foreground">Today's attendance with check-in and check-out times.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by employee name or ID…"
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Student ID</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Check-in</TableHead>
                  <TableHead>Check-out</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No records.</TableCell></TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.students?.name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.students?.student_id ?? "—"}</TableCell>
                      <TableCell>{r.students?.batch ?? "—"}</TableCell>
                      <TableCell>{r.check_in ? format(new Date(r.check_in), "h:mm a") : "—"}</TableCell>
                      <TableCell>{r.check_out ? format(new Date(r.check_out), "h:mm a") : "—"}</TableCell>
                      <TableCell><Badge variant="secondary" className="capitalize">{r.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {!r.check_out && (
                          <Button size="sm" variant="ghost" onClick={() => handleCheckOut(r)}>
                            <LogOutIcon className="mr-1 h-4 w-4" /> Check-out
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
