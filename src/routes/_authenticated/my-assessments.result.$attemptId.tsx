import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getMyAssessmentResult } from "@/lib/assessments.functions";
import { fmtDuration } from "@/lib/assessments-db";

export const Route = createFileRoute("/_authenticated/my-assessments/result/$attemptId")({
  head: () => ({ meta: [{ title: "Assessment Result · MySocLabs" }] }),
  component: ResultPage,
});

function fmtAnswer(r: any, a: any) {
  if (a == null || a === "" || (Array.isArray(a) && !a.length)) return "Not answered";
  if (r.type === "mcq" || r.type === "multi") return (Array.isArray(a) ? a : [a]).map((id: string) => r.options.find((o: any) => o.id === id)?.text ?? id).join(", ");
  if (r.type === "truefalse") return a === "true" ? "True" : "False";
  return String(a);
}

function ResultPage() {
  const { attemptId } = Route.useParams();
  const get = useServerFn(getMyAssessmentResult);
  const { data, error } = useQuery({ queryKey: ["my-result", attemptId], queryFn: () => get({ data: { attemptId } }) });
  if (error) return <p className="p-8 text-destructive">{(error as Error).message}</p>;
  if (!data) return <p className="p-8 text-muted-foreground">Loading…</p>;
  const { attempt: at, assessment: a } = data;
  const tiles: [string, string | number][] = [
    ["Score", `${at.score}/${at.max_score}`], ["Percentage", `${at.percentage}%`], ["Correct", at.correct_count], ["Wrong", at.wrong_count],
    ["Skipped", at.skipped_count], ["Time Taken", fmtDuration(at.time_taken_seconds)],
  ];
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div><Link to="/my-assessments" className="text-xs text-muted-foreground hover:underline">← My Assessments</Link>
        <h1 className="text-2xl font-semibold">{a.title}</h1>
        <p className="text-sm text-muted-foreground">
          {at.pending_review_count ? `${at.pending_review_count} answer(s) awaiting review — your score may change.` : at.passed ? `Passed (pass mark ${a.passing_percentage}%)` : `Not passed (pass mark ${a.passing_percentage}%)`}
        </p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map(([l, v]) => <Card key={l}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 text-2xl font-semibold">{v}</p></CardContent></Card>)}
      </div>
      <Card><CardHeader><CardTitle className="text-base">Question Review</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.review.map((r: any) => (
            <div key={r.index} className="rounded-md border border-border p-3">
              <div className="flex items-center gap-2 text-xs"><Badge variant="secondary">Q{r.index}</Badge>
                <Badge variant="secondary" className={r.outcome === "correct" ? "bg-success/15 text-success" : r.outcome === "wrong" ? "bg-destructive/15 text-destructive" : ""}>
                  {r.outcome === "pending" ? (r.awarded != null ? `${r.awarded}/${r.marks} awarded` : "Awaiting review") : r.outcome}</Badge></div>
              <p className="mt-2 font-medium">{r.prompt}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm"><span className="text-muted-foreground">Your answer: </span>{fmtAnswer(r, r.answer)}</p>
              {a.show_correct && r.correct && r.type !== "theory" && (
                <p className="text-sm text-success"><span className="text-muted-foreground">Correct answer: </span>{r.type === "short" ? r.correct.join(" / ") : fmtAnswer(r, r.type === "multi" ? r.correct : r.correct[0])}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
