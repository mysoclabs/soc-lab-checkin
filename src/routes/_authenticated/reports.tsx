import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports · MySOC Labs" }] }),
  component: ReportsPage,
});

type AttRow = {
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  students: { name: string; student_id: string; department: string | null } | null;
};

function ReportsPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [day, setDay] = useState(today);
  const [weekAnchor, setWeekAnchor] = useState(today);
  const [monthAnchor, setMonthAnchor] = useState(today);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Daily, weekly, monthly attendance and employee percentages.</p>
      </div>

      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="percentage">Employee %</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="pt-4">
          <RangeReport
            title={`Daily Report — ${format(new Date(day), "PPP")}`}
            startDate={day}
            endDate={day}
            anchorControl={
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-auto" />
            }
          />
        </TabsContent>
        <TabsContent value="weekly" className="pt-4">
          <WeekReport anchor={weekAnchor} setAnchor={setWeekAnchor} />
        </TabsContent>
        <TabsContent value="monthly" className="pt-4">
          <MonthReport anchor={monthAnchor} setAnchor={setMonthAnchor} />
        </TabsContent>
        <TabsContent value="percentage" className="pt-4">
          <PercentageReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useAttendanceRange(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["report-range", startDate, endDate],
    queryFn: async (): Promise<AttRow[]> => {
      const { data, error } = await supabase
        .from("attendance")
        .select("date, check_in, check_out, status, students:student_id(name, student_id, department)")
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data as AttRow[]) ?? [];
    },
  });
}

function exportExcel(rows: Array<Record<string, string | number>>, filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

function exportPdf(title: string, head: string[], body: (string | number)[][], filename: string) {
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  autoTable(doc, { head: [head], body, startY: 22, styles: { fontSize: 9 } });
  doc.save(`${filename}.pdf`);
}

function RangeReport({
  title, startDate, endDate, anchorControl,
}: { title: string; startDate: string; endDate: string; anchorControl: React.ReactNode }) {
  const { data = [], isLoading } = useAttendanceRange(startDate, endDate);

  const rows = data.map((r) => ({
    Date: r.date,
    Name: r.students?.name ?? "—",
    "Employee ID": r.students?.student_id ?? "—",
    Department: r.students?.department ?? "—",
    "Check-in": r.check_in ? format(new Date(r.check_in), "HH:mm") : "—",
    "Check-out": r.check_out ? format(new Date(r.check_out), "HH:mm") : "—",
    Status: r.status,
  }));

  const fileBase = `attendance-${startDate}_to_${endDate}`;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {anchorControl}
          <Button variant="secondary" size="sm" onClick={() => exportExcel(rows, fileBase)}>
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={() =>
            exportPdf(title, ["Date", "Name", "Employee ID", "Department", "Check-in", "Check-out", "Status"],
              rows.map((r) => [r.Date, r.Name, r["Employee ID"], r.Department, r["Check-in"], r["Check-out"], r.Status]),
              fileBase)
          }>
            <FileText className="mr-1 h-4 w-4" /> PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead><TableHead>Name</TableHead><TableHead>Employee ID</TableHead>
                <TableHead>Department</TableHead><TableHead>Check-in</TableHead><TableHead>Check-out</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No data.</TableCell></TableRow>
              ) : (
                rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.Date}</TableCell><TableCell>{r.Name}</TableCell>
                    <TableCell className="font-mono text-xs">{r["Employee ID"]}</TableCell>
                    <TableCell>{r.Department}</TableCell><TableCell>{r["Check-in"]}</TableCell>
                    <TableCell>{r["Check-out"]}</TableCell><TableCell className="capitalize">{r.Status}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function WeekReport({ anchor, setAnchor }: { anchor: string; setAnchor: (v: string) => void }) {
  const d = new Date(anchor);
  const start = format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const end = format(endOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
  return (
    <RangeReport
      title={`Weekly Report — ${start} to ${end}`}
      startDate={start} endDate={end}
      anchorControl={<Input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} className="w-auto" />}
    />
  );
}

function MonthReport({ anchor, setAnchor }: { anchor: string; setAnchor: (v: string) => void }) {
  const d = new Date(anchor);
  const start = format(startOfMonth(d), "yyyy-MM-dd");
  const end = format(endOfMonth(d), "yyyy-MM-dd");
  return (
    <RangeReport
      title={`Monthly Report — ${format(d, "MMMM yyyy")}`}
      startDate={start} endDate={end}
      anchorControl={<Input type="month" value={format(d, "yyyy-MM")} onChange={(e) => setAnchor(`${e.target.value}-01`)} className="w-auto" />}
    />
  );
}

function PercentageReport() {
  const today = new Date();
  const start = format(startOfMonth(today), "yyyy-MM-dd");
  const end = format(endOfMonth(today), "yyyy-MM-dd");

  const { data: students = [] } = useQuery({
    queryKey: ["students-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("students").select("id, name, student_id, department");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: att = [] } = useAttendanceRange(start, end);

  const businessDays = useMemo(() => {
    return eachDayOfInterval({ start: startOfMonth(today), end: today }).filter((d) => {
      const day = d.getDay();
      return day !== 0 && day !== 6;
    }).length;
  }, [today]);

  const rows = students.map((s) => {
    const presentCount = att.filter((a) => a.students?.student_id === s.student_id).length;
    const pct = businessDays > 0 ? Math.round((presentCount / businessDays) * 100) : 0;
    return {
      Name: s.name,
      "Employee ID": s.student_id,
      Department: s.department ?? "—",
      "Days Present": presentCount,
      "Business Days": businessDays,
      "Attendance %": `${pct}%`,
    };
  });

  const fileBase = `attendance-percentage-${format(today, "yyyy-MM")}`;
  const title = `Attendance Percentage — ${format(today, "MMMM yyyy")}`;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => exportExcel(rows, fileBase)}>
            <Download className="mr-1 h-4 w-4" /> Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={() =>
            exportPdf(title, ["Name", "Employee ID", "Department", "Days Present", "Business Days", "Attendance %"],
              rows.map((r) => [r.Name, r["Employee ID"], r.Department, r["Days Present"], r["Business Days"], r["Attendance %"]]),
              fileBase)}>
            <Download className="mr-1 h-4 w-4" /> PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Employee ID</TableHead><TableHead>Department</TableHead>
                <TableHead>Days Present</TableHead><TableHead>Business Days</TableHead><TableHead>Attendance %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No data.</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.Name}</TableCell>
                  <TableCell className="font-mono text-xs">{r["Employee ID"]}</TableCell>
                  <TableCell>{r.Department}</TableCell>
                  <TableCell>{r["Days Present"]}</TableCell>
                  <TableCell>{r["Business Days"]}</TableCell>
                  <TableCell className="font-semibold">{r["Attendance %"]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
