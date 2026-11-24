import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CalendarClock, ClipboardList, Target } from "lucide-react";
import { RoleGuard } from "@/components/role-guard";
import { PipMetric, PipProgress, PipStatusBadge, formatPipDate, formatPipStatus } from "@/components/pip/pip-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/my-pip")({
  head: () => ({
    meta: [
      { title: "My PIP · MySocLabs" },
      { name: "description", content: "Review your performance plan, goals, progress, and check-in schedule." },
      { property: "og:title", content: "My PIP · MySocLabs" },
      { property: "og:description", content: "Review your performance plan, goals, progress, and check-in schedule." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <RoleGuard allow={["employee"]}><MyPip /></RoleGuard>,
});

function MyPip() {
  const plansQuery = useQuery({
    queryKey: ["my-pip-records"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_records").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const goalsQuery = useQuery({
    queryKey: ["my-pip-goals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_goals").select("id, pip_id, progress_percent");
      if (error) throw error;
      return data ?? [];
    },
  });
  const reviewsQuery = useQuery({
    queryKey: ["my-pip-checkins"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_checkins").select("id, pip_id, scheduled_date, completed_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const plans = plansQuery.data ?? [];
  const goals = goalsQuery.data ?? [];
  const reviews = reviewsQuery.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const active = plans.filter((pip) => pip.status === "active" || pip.status === "extended");
  const history = plans.filter((pip) => ["completed", "unsuccessful", "cancelled"].includes(pip.status));
  const nextReview = useMemo(() => {
    const next = new Map<string, string>();
    for (const review of reviews) {
      if (review.completed_at || review.scheduled_date < today) continue;
      const current = next.get(review.pip_id);
      if (!current || review.scheduled_date < current) next.set(review.pip_id, review.scheduled_date);
    }
    return next;
  }, [reviews, today]);
  const upcomingReviewCount = reviews.filter((review) => !review.completed_at && review.scheduled_date >= today).length;
  const overallProgress = goals.length ? Math.round(goals.reduce((sum, goal) => sum + goal.progress_percent, 0) / goals.length) : 0;

  return <div className="space-y-6">
    <div><p className="text-xs font-medium uppercase text-primary">My performance</p><h1 className="mt-1 text-2xl font-semibold">My PIP</h1><p className="mt-1 text-sm text-muted-foreground">Your active plan, progress, and review history.</p></div>
    <div className="grid gap-3 sm:grid-cols-3"><PipMetric label="Active plans" value={active.length} icon={Target} /><PipMetric label="Upcoming reviews" value={upcomingReviewCount} icon={CalendarClock} /><PipMetric label="Goal progress" value={`${overallProgress}%`} icon={ClipboardList} /></div>
    {plansQuery.isLoading ? <p className="py-10 text-center text-sm text-muted-foreground">Loading your plans…</p>
      : plansQuery.isError ? <p className="py-10 text-center text-sm text-destructive">{plansQuery.error instanceof Error ? plansQuery.error.message : "Unable to load your plans"}</p>
      : plans.length === 0 ? <div className="border-y border-dashed border-border py-12 text-center"><ClipboardList className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><h2 className="font-semibold">No published PIPs</h2><p className="mt-1 text-sm text-muted-foreground">Published plans assigned to you will appear here.</p></div>
      : <div className="space-y-8">
        {active.length > 0 && <section className="space-y-3"><div><h2 className="text-lg font-semibold">Active plans</h2><p className="text-sm text-muted-foreground">Plans currently in progress.</p></div><div className="grid gap-3 xl:grid-cols-2">{active.map((pip) => <PipCard key={pip.id} pip={pip} progress={goals.filter((goal) => goal.pip_id === pip.id)} nextReview={nextReview.get(pip.id)} />)}</div></section>}
        {history.length > 0 && <section className="space-y-3"><div><h2 className="text-lg font-semibold">PIP history</h2><p className="text-sm text-muted-foreground">Completed or otherwise closed plans.</p></div><div className="grid gap-3 xl:grid-cols-2">{history.map((pip) => <PipCard key={pip.id} pip={pip} progress={goals.filter((goal) => goal.pip_id === pip.id)} nextReview={nextReview.get(pip.id)} />)}</div></section>}
        {plans.some((pip) => pip.status === "draft") && <p className="text-xs text-muted-foreground">Draft plans are not shown.</p>}
      </div>}
  </div>;
}

function PipCard({ pip, progress, nextReview }: { pip: { id: string; employee_name: string; focus_areas: string[]; status: string; start_date: string; end_date: string }; progress: { progress_percent: number }[]; nextReview?: string }) {
  const percent = progress.length ? Math.round(progress.reduce((sum, item) => sum + item.progress_percent, 0) / progress.length) : 0;
  return <Card><CardContent className="space-y-4 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Performance plan</h3><p className="mt-1 text-xs text-muted-foreground">{formatPipDate(pip.start_date)} – {formatPipDate(pip.end_date)}</p></div><PipStatusBadge status={formatPipStatus(pip.status)} /></div>
    <div className="flex flex-wrap gap-2">{pip.focus_areas.map((focus) => <span key={focus} className="rounded-sm bg-muted px-2 py-1 text-xs">{focus}</span>)}</div>
    <PipProgress value={percent} />
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><p className="text-sm text-muted-foreground">Next review: <span className="font-medium text-foreground">{formatPipDate(nextReview)}</span></p><Button asChild variant="outline" size="sm"><Link to="/pip/$id" params={{ id: pip.id }}>View plan<ArrowUpRight className="ml-2 h-4 w-4" /></Link></Button></div>
  </CardContent></Card>;
}