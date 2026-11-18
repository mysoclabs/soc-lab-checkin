import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listMyAssessments } from "@/lib/assessments.functions";

export const Route = createFileRoute("/_authenticated/my-assessments/")({
  head: () => ({ meta: [{ title: "My Assessments · MySocLabs" }] }),
  component: MyAssessments,
});

type Item = Awaited<ReturnType<typeof listMyAssessments>>[number];

function group(a: Item, now: Date) {
  if (a.attempt?.status === "submitted") return "completed";
  if (a.due_at && new Date(a.due_at) < now) return "expired";
  if (a.status === "completed") return "expired";
  if (a.available_from && new Date(a.available_from) > now) return "upcoming";
  return "active";
}

function MyAssessments() {
  const fetchList = useServerFn(listMyAssessments);
  const { data = [], isLoading } = useQuery({ queryKey: ["my-assessments"], queryFn: () => fetchList() });
  const now = new Date();
  const groups = useMemo(() => {
    const g: Record<string, Item[]> = { upcoming: [], active: [], completed: [], expired: [] };
    for (const a of data) g[group(a, now)].push(a);
    return g;
  }, [data]);
  const done = groups.completed.filter((a) => a.attempt?.percentage != null);
  const pcts = done.map((a) => Number(a.attempt!.percentage));
  const trend = [...done].sort((x, y) => +new Date(x.attempt!.submitted_at) - +new Date(y.attempt!.submitted_at))
    .map((a) => ({ name: format(new Date(a.attempt!.submitted_at), "dd MMM"), score: Number(a.attempt!.percentage) }));

  const tiles: [string, string | number][] = [
    ["Pending", groups.active.length + groups.upcoming.length], ["Completed", groups.completed.length],
    ["Average Score", pcts.length ? `${(pcts.reduce((s, x) => s + x, 0) / pcts.length).toFixed(1)}%` : "—"], ["Highest Score", pcts.length ? `${Math.max(...pcts)}%` : "—"],
  ];

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">My Assessments</h1><p className="text-sm text-muted-foreground">Your assigned quizzes and results.</p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([l, v]) => <Card key={l}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 text-2xl font-semibold">{v}</p></CardContent></Card>)}
      </div>
      {trend.length > 1 && (
        <Card><CardHeader><CardTitle className="text-base">Performance Trend</CardTitle></CardHeader>
          <CardContent className="h-56"><ResponsiveContainer><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="name" stroke="var(--muted-foreground)" /><YAxis unit="%" domain={[0, 100]} stroke="var(--muted-foreground)" /><Tooltip /><Line dataKey="score" stroke="var(--primary)" strokeWidth={2} /></LineChart></ResponsiveContainer></CardContent></Card>
      )}
      <Tabs defaultValue="active">
        <TabsList>
          {(["active", "upcoming", "completed", "expired"] as const).map((k) => <TabsTrigger key={k} value={k} className="capitalize">{k} ({groups[k].length})</TabsTrigger>)}
        </TabsList>
        {(["active", "upcoming", "completed", "expired"] as const).map((k) => (
          <TabsContent key={k} value={k}>
            {isLoading ? <p className="text-muted-foreground">Loading…</p> : groups[k].length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nothing here.</p> : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {groups[k].map((a) => (
                  <Card key={a.id}><CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{a.title}</h3><Badge variant="secondary" className="capitalize">{k}</Badge></div>
                    {a.description && <p className="line-clamp-2 text-sm text-muted-foreground">{a.description}</p>}
                    <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                      <span>{a.question_count} questions</span><span>{a.duration_minutes} min</span>
                      {a.due_at && <span>Due {format(new Date(a.due_at), "dd MMM, HH:mm")}</span>}
                      {k === "upcoming" && a.available_from && <span>Opens {format(new Date(a.available_from), "dd MMM, HH:mm")}</span>}
                    </div>
                    {k === "completed" && a.attempt && (
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-semibold">{a.attempt.pending_review_count ? "Awaiting review" : `${a.attempt.percentage}%`}</span>
                        <Button asChild size="sm" variant="outline"><Link to="/my-assessments/result/$attemptId" params={{ attemptId: a.attempt.id }}>View Result</Link></Button>
                      </div>
                    )}
                    {k === "active" && <Button asChild className="w-full"><Link to="/my-assessments/$id/take" params={{ id: a.id }}>{a.attempt ? "Resume" : "Start"}</Link></Button>}
                  </CardContent></Card>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
