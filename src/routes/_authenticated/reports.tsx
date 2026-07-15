import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileSpreadsheet, FileText, UserCheck, UserX, Clock, CalendarDays } from "lucide-react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { RoleGuard } from "@/components/role-guard";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin", "hr_admin"]} fallbackTo="/me">
      <ReportsPage />
    </RoleGuard>
  ),
});

const LATE_CUTOFF = "09:30:00";

type AttRow = {
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  students: { name: string; student_id: string; department: string | null } | null;
};

type Employee = { id: string; name: string; student_id: string; department: string | null };

function ReportsPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [day, setDay] = useState(today);
  const [weekAnchor, setWeekAnchor] = useState(today);
  const [monthAnchor, setMonthAnchor] = useState(today);
  const [rangeStart, setRangeStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [rangeEnd, setRangeEnd] = useState(today);

  const [nameFilter, setNameFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data } = await supabase.from("students").select("department");
      const set = new Set<string>();
      (data ?? []).forEach((r: { department: string | null }) => { if (r.department) set.add(r.department); });
      return Array.from(set).sort();
    },
  });

  const filters = { nameFilter, deptFilter, setNameFilter, setDeptFilter, departments };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Daily, weekly, monthly attendance with employee statistics.</p>
      </div>

      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="range">Date Range</TabsTrigger>
          <TabsTrigger value="percentage">Statistics</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="pt-4 space-y-4">
          <DailyBreakdown date={day} setDate={setDay} {...filters} />
          <RangeReport
            title={`Daily Detail — ${format(new Date(day), "PPP")}`}
            startDate={day} endDate={day} {...filters}
            anchorControl={<Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-auto" />}
          />
        </TabsContent>
        <TabsContent value="weekly" className="pt-4">
          <WeekReport anchor={weekAnchor} setAnchor={setWeekAnchor} {...filters} />
        </TabsContent>
        <TabsContent value="monthly" className="pt-4">
          <MonthReport anchor={monthAnchor} setAnchor={setMonthAnchor} {...filters} />
        </TabsContent>
        <TabsContent value="range" className="pt-4">
          <RangeReport
            title={`Range Report — ${rangeStart} to ${rangeEnd}`}
            startDate={rangeStart} endDate={rangeEnd} {...filters}
            anchorControl={
              <div className="flex items-center gap-2">
                <Input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} className="w-auto" />
                <span className="text-muted-foreground text-sm">to</span>
                <Input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} className="w-auto" />
              </div>
            }
          />
        </TabsContent>
        <TabsContent value="percentage" className="pt-4">
          <PercentageReport {...filters} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Filters = {
  nameFilter: string;
  deptFilter: string;
  setNameFilter: (v: string) => void;
  setDeptFilter: (v: string) => void;
  departments: string[];
};

function FilterBar({ nameFilter, deptFilter, setNameFilter, setDeptFilter, departments }: Filters) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Search employee name…"
        value={nameFilter}
        onChange={(e) => setNameFilter(e.target.value)}
        className="w-56"
      />
      <Select value={deptFilter} onValueChange={setDeptFilter}>
        <SelectTrigger className="w-48"><SelectValue placeholder="Department" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Departments</SelectItem>
          {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
        </SelectContent>
      </Select>
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

function useEmployees() {
  return useQuery({
    queryKey: ["employees-all"],
    queryFn: async (): Promise<Employee[]> => {
      const { data, error } = await supabase.from("students").select("id, name, student_id, department");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function applyFilters<T extends { students: { name: string; department: string | null } | null }>(
  rows: T[], nameFilter: string, deptFilter: string,
) {
  const q = nameFilter.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !(r.students?.name?.toLowerCase().includes(q))) return false;
    if (deptFilter !== "all" && r.students?.department !== deptFilter) return false;
    return true;
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

function DailyBreakdown({ date, setDate, ...filters }: { date: string; setDate: (v: string) => void } & Filters) {
  const { data: employees = [] } = useEmployees();
  const { data: att = [] } = useAttendanceRange(date, date);

  const filteredEmployees = useMemo(() => {
    const q = filters.nameFilter.trim().toLowerCase();
    return employees.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (filters.deptFilter !== "all" && e.department !== filters.deptFilter) return false;
      return true;
    });
  }, [employees, filters.nameFilter, filters.deptFilter]);

  const presentIds = new Set(att.map((a) => a.students?.student_id).filter(Boolean) as string[]);
  const presentEmployees = filteredEmployees.filter((e) => presentIds.has(e.student_id));
  const absentEmployees = filteredEmployees.filter((e) => !presentIds.has(e.student_id));
  const lateEntries = applyFilters(att, filters.nameFilter, filters.deptFilter).filter(
    (a) => a.check_in && new Date(a.check_in).toTimeString().slice(0, 8) > LATE_CUTOFF,
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-4 w-4" /> Breakdown — {format(new Date(date), "PPP")}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
          <FilterBar {...filters} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat title="Present" value={presentEmployees.length} icon={UserCheck} tone="bg-success/15 text-success" />
          <Stat title="Absent" value={absentEmployees.length} icon={UserX} tone="bg-destructive/15 text-destructive" />
          <Stat title="Late" value={lateEntries.length} icon={Clock} tone="bg-warning/15 text-warning" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <EmployeeList title="Present" employees={presentEmployees} variant="default" />
          <EmployeeList title="Absent" employees={absentEmployees} variant="destructive" />
          <EmployeeList
            title="Late Entries"
            employees={lateEntries.map((l) => ({
              id: l.students?.student_id ?? "",
              name: l.students?.name ?? "—",
              student_id: l.students?.student_id ?? "",
              department: l.students?.department ?? null,
              extra: l.check_in ? format(new Date(l.check_in), "HH:mm") : "—",
            }))}
            variant="warning"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ title, value, icon: Icon, tone }: { title: string; value: number; icon: typeof UserCheck; tone: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-4">
      <div>
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </div>
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}

function EmployeeList({
  title, employees, variant,
}: {
  title: string;
  employees: Array<Employee & { extra?: string }>;
  variant: "default" | "destructive" | "warning";
}) {
  const badgeClass =
    variant === "destructive" ? "bg-destructive/15 text-destructive" :
    variant === "warning" ? "bg-warning/15 text-warning" :
    "bg-success/15 text-success";
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="secondary" className={badgeClass}>{employees.length}</Badge>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {employees.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">No records.</p>
        ) : (
          <ul className="divide-y divide-border">
            {employees.map((e, i) => (
              <li key={`${e.id}-${i}`} className="flex items-center justify-between px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{e.name}</p>
                  <p className="text-xs text-muted-foreground">{e.student_id} · {e.department ?? "—"}</p>
                </div>
                {e.extra && <span className="text-xs font-mono text-muted-foreground">{e.extra}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RangeReport({
  title, startDate, endDate, anchorControl, ...filters
}: { title: string; startDate: string; endDate: string; anchorControl: React.ReactNode } & Filters) {
  const { data = [], isLoading } = useAttendanceRange(startDate, endDate);
  const filtered = applyFilters(data, filters.nameFilter, filters.deptFilter);

  const rows = filtered.map((r) => ({
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
          <FilterBar {...filters} />
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

function WeekReport({ anchor, setAnchor, ...filters }: { anchor: string; setAnchor: (v: string) => void } & Filters) {
  const d = new Date(anchor);
  const start = format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const end = format(endOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
  return (
    <RangeReport
      title={`Weekly Report — ${start} to ${end}`}
      startDate={start} endDate={end} {...filters}
      anchorControl={<Input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} className="w-auto" />}
    />
  );
}

function MonthReport({ anchor, setAnchor, ...filters }: { anchor: string; setAnchor: (v: string) => void } & Filters) {
  const d = new Date(anchor);
  const start = format(startOfMonth(d), "yyyy-MM-dd");
  const end = format(endOfMonth(d), "yyyy-MM-dd");
  return (
    <RangeReport
      title={`Monthly Report — ${format(d, "MMMM yyyy")}`}
      startDate={start} endDate={end} {...filters}
      anchorControl={<Input type="month" value={format(d, "yyyy-MM")} onChange={(e) => setAnchor(`${e.target.value}-01`)} className="w-auto" />}
    />
  );
}

function PercentageReport(filters: Filters) {
  const today = new Date();
  const start = format(startOfMonth(today), "yyyy-MM-dd");
  const end = format(endOfMonth(today), "yyyy-MM-dd");

  const { data: employees = [] } = useEmployees();
  const { data: att = [] } = useAttendanceRange(start, end);

  const businessDays = useMemo(() => {
    return eachDayOfInterval({ start: startOfMonth(today), end: today }).filter((d) => {
      const day = d.getDay();
      return day !== 0 && day !== 6;
    }).length;
  }, [today]);

  const q = filters.nameFilter.trim().toLowerCase();
  const filteredEmployees = employees.filter((s) => {
    if (q && !s.name.toLowerCase().includes(q)) return false;
    if (filters.deptFilter !== "all" && s.department !== filters.deptFilter) return false;
    return true;
  });

  const rows = filteredEmployees.map((s) => {
    const presentCount = att.filter((a) => a.students?.student_id === s.student_id).length;
    const absentDays = Math.max(0, businessDays - presentCount);
    const pct = businessDays > 0 ? Math.round((presentCount / businessDays) * 100) : 0;
    return {
      Name: s.name,
      "Employee ID": s.student_id,
      Department: s.department ?? "—",
      "Working Days": businessDays,
      "Present Days": presentCount,
      "Absent Days": absentDays,
      "Attendance %": `${pct}%`,
    };
  });

  const fileBase = `attendance-statistics-${format(today, "yyyy-MM")}`;
  const title = `Attendance Statistics — ${format(today, "MMMM yyyy")}`;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <FilterBar {...filters} />
          <Button variant="secondary" size="sm" onClick={() => exportExcel(rows, fileBase)}>
            <Download className="mr-1 h-4 w-4" /> Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={() =>
            exportPdf(title, ["Name", "Employee ID", "Department", "Working Days", "Present Days", "Absent Days", "Attendance %"],
              rows.map((r) => [r.Name, r["Employee ID"], r.Department, r["Working Days"], r["Present Days"], r["Absent Days"], r["Attendance %"]]),
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
                <TableHead>Working Days</TableHead><TableHead>Present Days</TableHead>
                <TableHead>Absent Days</TableHead><TableHead>Attendance %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No data.</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.Name}</TableCell>
                  <TableCell className="font-mono text-xs">{r["Employee ID"]}</TableCell>
                  <TableCell>{r.Department}</TableCell>
                  <TableCell>{r["Working Days"]}</TableCell>
                  <TableCell>{r["Present Days"]}</TableCell>
                  <TableCell>{r["Absent Days"]}</TableCell>
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
