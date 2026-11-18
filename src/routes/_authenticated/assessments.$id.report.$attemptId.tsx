import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RoleGuard } from "@/components/role-guard";
import { adb, fmtDuration, TYPE_LABELS, type Question } from "@/lib/assessments-db";
import { evaluateQuestion, EVENT_LABELS } from "@/lib/assessment-grading";
import { gradeTheoryAnswers } from "@/lib/assessments.functions";

export const Route = createFileRoute("/_authenticated/assessments/$id/report/$attemptId")({
  head: () => ({ meta: [{ title: "Employee Report · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin"]} fallbackTo="/me">
      <ReportPage />
    </RoleGuard>
  ),
});

function answerText(q: Question, a: any) {
  if (a == null || (Array.isArray(a) && !a.length) || a === "") return "—";
  if (q.type === "mcq" || q.type === "multi") return (Array.isArray(a) ? a : [a]).map((id) => q.options.find((o) => o.id === id)?.text ?? id).join(", ");
  if (q.type === "truefalse") return a === "true" ? "True" : "False";
  return String(a);
}

function ReportPage() {
  const { id, attemptId } = Route.useParams();
  const qc = useQueryClient();
  const grade = useServerFn(gradeTheoryAnswers);
  const { data } = useQuery({
    queryKey: ["attempt-report", attemptId],
    queryFn: async () => {
      const [at, q, ev] = await Promise.all([
        adb.from("assessment_attempts").select("*").eq("id", attemptId).single(),
        adb.from("assessment_questions").select("*").eq("assessment_id", id).order("position"),
        adb.from("assessment_events").select("*").eq("attempt_id", attemptId).order("created_at"),
      ]);
      if (at.error) throw at.error;
      const emp = await adb.from("students").select("name,department").ilike("email", at.data.email).maybeSingle();
      return { at: at.data, questions: (q.data ?? []) as Question[], events: ev.data ?? [], emp: emp.data };
    },
  });
  const [marks, setMarks] = useState<Record<string, number>>({});
  useEffect(() => { if (data) setMarks(data.at.manual_marks ?? {}); }, [data]);
  const save = useMutation({
    mutationFn: () => grade({ data: { attemptId, manual_marks: marks } }),
    onSuccess: () => { toast.success("Marks saved"); qc.invalidateQueries({ queryKey: ["attempt-report", attemptId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return <p className="p-8 text-muted-foreground">Loading…</p>;
  const { at, questions, events } = data;
  const count = (t: string) => events.filter((e: any) => e.type === t).length;
  const away = events.filter((e: any) => e.type === "focus_returned").reduce((s: number, e: any) => s + (e.duration_seconds ?? 0), 0);
  const answered = questions.length - (at.skipped_count ?? 0);
  const tiles: [string, string | number][] = [
    ["Score", at.score != null ? `${at.score}/${at.max_score}` : "—"], ["Percentage", at.percentage != null ? `${at.percentage}%` : "—"],
    ["Correct", at.correct_count ?? "—"], ["Wrong", at.wrong_count ?? "—"], ["Skipped", at.skipped_count ?? "—"],
    ["Time Taken", fmtDuration(at.time_taken_seconds)], ["Avg. per Question", at.time_taken_seconds && answered ? fmtDuration(Math.round(at.time_taken_seconds / Math.max(1, questions.length))) : "—"],
    ["Pending Review", at.pending_review_count ?? 0],
  ];
  const activity: [string, number | string][] = [
    ["Focus changes", count("focus_lost")], ["Time away", fmtDuration(away)], ["Copy attempts", count("copy")],
    ["Paste attempts", count("paste")], ["Right clicks", count("right_click")], ["Refreshes", count("refresh")],
  ];
  const hasTheory = questions.some((q) => q.type === "theory");

  return (
    <div className="space-y-6">
      <div>
        <Link to="/assessments/$id/results" params={{ id }} className="text-xs text-muted-foreground hover:underline">← Results</Link>
        <h1 className="text-2xl font-semibold">{data.emp?.name ?? at.email}</h1>
        <p className="text-sm text-muted-foreground">{data.emp?.department ?? ""} · {at.status === "submitted" ? `Submitted ${format(new Date(at.submitted_at), "dd MMM yyyy, HH:mm")}` : "In progress"}
          {at.passed != null && <Badge className="ml-2" variant="secondary">{at.passed ? "Passed" : "Failed"}</Badge>}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([l, v]) => <Card key={l}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 text-xl font-semibold">{v}</p></CardContent></Card>)}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card><CardHeader><CardTitle className="text-base">Activity Summary</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">{activity.map(([l, v]) => <div key={l} className="flex justify-between"><span className="text-muted-foreground">{l}</span><span className="font-medium">{v}</span></div>)}</CardContent></Card>
        <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
          <CardContent className="max-h-80 overflow-y-auto">
            <ol className="space-y-1.5 text-sm">
              {events.map((e: any) => (
                <li key={e.id} className="flex gap-3"><span className="w-16 shrink-0 font-mono text-muted-foreground">{format(new Date(e.created_at), "HH:mm:ss")}</span>
                  <span>{EVENT_LABELS[e.type] ?? e.type}{e.question_index != null && !["started", "submitted"].includes(e.type) ? ` · Question ${e.question_index + 1}` : ""}{e.duration_seconds ? ` · away ${fmtDuration(e.duration_seconds)}` : ""}</span></li>
              ))}
            </ol>
          </CardContent></Card>
      </div>
      <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Answers</CardTitle>
          {hasTheory && at.status === "submitted" && <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save theory marks</Button>}</CardHeader>
        <CardContent className="space-y-3">
          {questions.map((q, i) => {
            const o = evaluateQuestion({ id: q.id, type: q.type, marks: q.marks, correct: q.correct }, at.answers?.[q.id]);
            return (
              <div key={q.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs"><Badge variant="secondary">Q{i + 1}</Badge><span className="text-muted-foreground">{TYPE_LABELS[q.type]} · {q.marks} marks · {fmtDuration(Math.round(at.question_times?.[q.id] ?? 0))}</span>
                  <Badge variant="secondary" className={o === "correct" ? "bg-success/15 text-success" : o === "wrong" ? "bg-destructive/15 text-destructive" : ""}>{o}</Badge></div>
                <p className="mt-2 font-medium">{q.prompt}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm"><span className="text-muted-foreground">Answer: </span>{answerText(q, at.answers?.[q.id])}</p>
                {q.type !== "theory" && <p className="text-sm"><span className="text-muted-foreground">Correct: </span>{q.type === "short" ? q.correct.join(" / ") : answerText(q, q.type === "multi" ? q.correct : q.correct[0])}</p>}
                {q.type === "theory" && o !== "skipped" && (
                  <div className="mt-2 flex items-center gap-2 text-sm"><span className="text-muted-foreground">Award marks</span>
                    <Input type="number" className="w-24" min={0} max={q.marks} value={marks[q.id] ?? ""} onChange={(e) => setMarks({ ...marks, [q.id]: Math.min(q.marks, Math.max(0, Number(e.target.value))) })} /><span>/ {q.marks}</span></div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
