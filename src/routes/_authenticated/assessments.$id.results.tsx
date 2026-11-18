import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RoleGuard } from "@/components/role-guard";
import { adb, downloadCsv, fmtDuration, type Assessment, type Question } from "@/lib/assessments-db";
import { evaluateQuestion } from "@/lib/assessment-grading";

export const Route = createFileRoute("/_authenticated/assessments/$id/results")({
  head: () => ({ meta: [{ title: "Assessment Results · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin"]} fallbackTo="/me">
      <ResultsPage />
    </RoleGuard>
  ),
});

function ResultsPage() {
  const { id } = Route.useParams();
  const { data } = useQuery({
    queryKey: ["assessment-results", id],
    queryFn: async () => {
      const [a, q, asg, at] = await Promise.all([
        adb.from("assessments").select("*").eq("id", id).single(),
        adb.from("assessment_questions").select("*").eq("assessment_id", id).order("position"),
        adb.from("assessment_assignments").select("student_id,email,students(name,department)").eq("assessment_id", id),
        adb.from("assessment_attempts").select("*").eq("assessment_id", id),
      ]);
      if (a.error) throw a.error;
      return { a: a.data as Assessment, questions: (q.data ?? []) as Question[], assignments: asg.data ?? [], attempts: at.data ?? [] };
    },
  });

  const rows = useMemo(() => {
    if (!data) return [];
    return data.assignments.map((g: any) => {
      const at = data.attempts.find((x: any) => x.email.toLowerCase() === g.email.toLowerCase());
      const status = !at ? "Not started" : at.status === "submitted" ? (at.pending_review_count ? "Needs review" : at.passed ? "Passed" : "Failed") : "In progress";
      return { name: g.students?.name ?? g.email, email: g.email, department: g.students?.department ?? "—", at, status };
    });
  }, [data]);

  const analytics = useMemo(() => {
    if (!data) return null;
    const done = data.attempts.filter((x: any) => x.status === "submitted");
    const pcts = done.map((x: any) => Number(x.percentage ?? 0));
    const times = done.map((x: any) => x.time_taken_seconds ?? 0);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
    const dept: Record<string, number[]> = {};
    for (const r of rows) if (r.at?.status === "submitted") (dept[r.department] ??= []).push(Number(r.at.percentage ?? 0));
    const qStats = data.questions.map((q, i) => {
      let c = 0, w = 0, s = 0, t = 0;
      for (const at of done) {
        const o = evaluateQuestion({ id: q.id, type: q.type, marks: q.marks, correct: q.correct }, at.answers?.[q.id]);
        if (o === "correct" || (o === "pending" && Number(at.manual_marks?.[q.id] ?? 0) > 0)) c++;
        else if (o === "skipped") s++;
        else w++;
        t += Number(at.question_times?.[q.id] ?? 0);
      }
      const n = done.length || 1;
      return { label: `Q${i + 1}`, prompt: q.prompt, correct: Math.round((c / n) * 100), wrong: Math.round((w / n) * 100), skipped: Math.round((s / n) * 100), avgTime: Math.round(t / n) };
    });
    return {
      avg: avg(pcts), max: pcts.length ? Math.max(...pcts) : 0, min: pcts.length ? Math.min(...pcts) : 0,
      completion: data.assignments.length ? (done.length / data.assignments.length) * 100 : 0, avgTime: Math.round(avg(times)),
      fastest: times.length ? Math.min(...times) : null, slowest: times.length ? Math.max(...times) : null,
      dept: Object.entries(dept).map(([d, xs]) => ({ dept: d, avg: Math.round(avg(xs)) })), qStats,
    };
  }, [data, rows]);

  if (!data || !analytics) return <p className="p-8 text-muted-foreground">Loading…</p>;

  const exportCsv = () => downloadCsv(`${data.a.title}-results.csv`, [
    ["Employee", "Email", "Department", "Score", "Max", "Percentage", "Time Taken (s)", "Status"],
    ...rows.map((r: any) => [r.name, r.email, r.department, r.at?.score ?? "", r.at?.max_score ?? "", r.at?.percentage ?? "", r.at?.time_taken_seconds ?? "", r.status]),
  ]);

  const tiles: [string, string][] = [
    ["Average Score", `${analytics.avg.toFixed(1)}%`], ["Highest", `${analytics.max}%`], ["Lowest", `${analytics.min}%`], ["Completion Rate", `${analytics.completion.toFixed(0)}%`],
    ["Avg. Time", fmtDuration(analytics.avgTime)], ["Fastest", fmtDuration(analytics.fastest)], ["Slowest", fmtDuration(analytics.slowest)], ["Questions", String(data.questions.length)],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><Link to="/assessments" className="text-xs text-muted-foreground hover:underline">← Assessments</Link><h1 className="text-2xl font-semibold">{data.a.title}</h1></div>
        <Button variant="outline" onClick={exportCsv}><Download className="mr-1 h-4 w-4" />Export Excel (CSV)</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([l, v]) => <Card key={l}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 text-xl font-semibold">{v}</p></CardContent></Card>)}
      </div>
      <Tabs defaultValue="employees">
        <TabsList><TabsTrigger value="employees">Employees</TabsTrigger><TabsTrigger value="questions">Question Analytics</TabsTrigger><TabsTrigger value="departments">Departments</TabsTrigger></TabsList>
        <TabsContent value="employees">
          <Card><CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Department</TableHead><TableHead>Score</TableHead><TableHead>Percentage</TableHead><TableHead>Time</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {rows.map((r: any) => (
                  <TableRow key={r.email}>
                    <TableCell><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.email}</div></TableCell>
                    <TableCell>{r.department}</TableCell>
                    <TableCell>{r.at?.status === "submitted" ? `${r.at.score}/${r.at.max_score}` : "—"}</TableCell>
                    <TableCell>{r.at?.status === "submitted" ? `${r.at.percentage}%` : "—"}</TableCell>
                    <TableCell>{fmtDuration(r.at?.time_taken_seconds)}</TableCell>
                    <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                    <TableCell>{r.at && <Button asChild size="sm" variant="outline"><Link to="/assessments/$id/report/$attemptId" params={{ id, attemptId: r.at.id }}>Report</Link></Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="questions">
          <Card><CardHeader><CardTitle className="text-base">Correct / Wrong / Skipped by question</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="h-64"><ResponsiveContainer><BarChart data={analytics.qStats}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="label" stroke="var(--muted-foreground)" /><YAxis unit="%" stroke="var(--muted-foreground)" /><Tooltip />
                <Bar dataKey="correct" stackId="a" fill="var(--success)" /><Bar dataKey="wrong" stackId="a" fill="var(--destructive)" /><Bar dataKey="skipped" stackId="a" fill="var(--muted-foreground)" /></BarChart></ResponsiveContainer></div>
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Question</TableHead><TableHead>Correct</TableHead><TableHead>Wrong</TableHead><TableHead>Skipped</TableHead><TableHead>Avg. Time</TableHead><TableHead>Difficulty</TableHead></TableRow></TableHeader>
                <TableBody>{analytics.qStats.map((q) => (
                  <TableRow key={q.label}><TableCell>{q.label}</TableCell><TableCell className="max-w-xs truncate">{q.prompt}</TableCell><TableCell>{q.correct}%</TableCell><TableCell>{q.wrong}%</TableCell><TableCell>{q.skipped}%</TableCell><TableCell>{fmtDuration(q.avgTime)}</TableCell>
                    <TableCell><Badge variant="secondary">{q.correct >= 75 ? "Easy" : q.correct >= 40 ? "Medium" : "Hard"}</Badge></TableCell></TableRow>
                ))}</TableBody>
              </Table>
            </CardContent></Card>
        </TabsContent>
        <TabsContent value="departments">
          <Card><CardContent className="h-72 p-4">
            {analytics.dept.length === 0 ? <p className="text-sm text-muted-foreground">No submissions yet.</p> :
              <ResponsiveContainer><BarChart data={analytics.dept}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="dept" stroke="var(--muted-foreground)" /><YAxis unit="%" stroke="var(--muted-foreground)" /><Tooltip /><Bar dataKey="avg" fill="var(--primary)" name="Average %" /></BarChart></ResponsiveContainer>}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
