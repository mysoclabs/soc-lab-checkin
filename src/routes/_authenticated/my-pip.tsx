import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { CheckCircle2, ClipboardList, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { RoleGuard } from "@/components/role-guard";
import { GoalStatusBadge, PipProgress, PipStatusBadge, formatPipDate, formatPipStatus } from "@/components/pip/pip-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useUserRole } from "@/hooks/use-role";
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
      // RLS returns only this employee's non-draft plans.
      const { data, error } = await supabase.from("pip_records").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const plans = (plansQuery.data ?? []).filter((pip) => pip.status !== "draft");
  const current = plans.find((pip) => pip.status === "active" || pip.status === "extended");
  const history = plans.filter((pip) => pip !== current);

  return <div className="space-y-6">
    {plansQuery.isLoading ? <p className="py-10 text-center text-sm text-muted-foreground">Loading your plan…</p>
      : plansQuery.isError ? <p className="py-10 text-center text-sm text-destructive">{plansQuery.error instanceof Error ? plansQuery.error.message : "Unable to load your plan"}</p>
      : !current ? <>
        <div><h1 className="text-2xl font-semibold">My PIP</h1><p className="mt-1 text-sm text-muted-foreground">You have no active performance plan.</p></div>
        {history.length === 0 && <div className="border-y border-dashed border-border py-12 text-center"><ClipboardList className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><h2 className="font-semibold">No published PIPs</h2><p className="mt-1 text-sm text-muted-foreground">Published plans assigned to you will appear here.</p></div>}
      </>
      : <CurrentPlan pip={current} />}
    {history.length > 0 && <section className="space-y-3"><h2 className="text-lg font-semibold">PIP history</h2><Card><CardContent className="divide-y divide-border p-0">{history.map((pip) => <div key={pip.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium">{formatPipDate(pip.start_date)} – {formatPipDate(pip.end_date)}</p><p className="text-xs text-muted-foreground">{pip.focus_areas.join(", ")}</p></div><PipStatusBadge status={formatPipStatus(pip.status)} /></div>)}</CardContent></Card></section>}
  </div>;
}

function CurrentPlan({ pip }: { pip: { id: string; start_date: string; end_date: string; status: string } }) {
  const { userId } = useUserRole();
  const queryClient = useQueryClient();
  const goalsQuery = useQuery({
    queryKey: ["my-pip-goals", pip.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_goals").select("id, title, kpi, target, status, rating, progress_percent").eq("pip_id", pip.id).order("position");
      if (error) throw error;
      return data ?? [];
    },
  });
  const feedbackQuery = useQuery({
    queryKey: ["my-pip-feedback", pip.id],
    queryFn: async () => {
      // Only the shared summary: hr_feedback is readable by RLS but is not meant for this page.
      const { data, error } = await supabase.from("pip_checkins").select("id, scheduled_date, completed_at, shared_summary").eq("pip_id", pip.id).order("scheduled_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const responseQuery = useQuery({
    queryKey: ["my-pip-response", pip.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_employee_responses").select("*").eq("pip_id", pip.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const response = responseQuery.data;
  const [responseText, setResponseText] = useState("");
  useEffect(() => setResponseText(response?.response ?? ""), [response]);

  const save = useMutation({
    mutationFn: async (payload: { response: string | null; acknowledged_at: string | null }) => {
      if (!userId) throw new Error("Please sign in again");
      const result = response
        ? await supabase.from("pip_employee_responses").update(payload).eq("id", response.id)
        : await supabase.from("pip_employee_responses").insert({ ...payload, pip_id: pip.id, created_by: userId });
      if (result.error) throw result.error;
    },
    onSuccess: async () => { toast.success("Saved"); await queryClient.invalidateQueries({ queryKey: ["my-pip-response", pip.id] }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save"),
  });

  const goals = goalsQuery.data ?? [];
  const feedback = (feedbackQuery.data ?? []).filter((review) => review.shared_summary?.trim());
  const daysLeft = Math.max(0, differenceInCalendarDays(parseISO(pip.end_date), new Date()));
  const acknowledgedAt = response?.acknowledged_at ?? null;

  return <>
    {!responseQuery.isLoading && !acknowledgedAt && <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-semibold text-warning">Your Performance Improvement Plan is active</p><p className="text-sm text-muted-foreground">Please read the goals below and acknowledge to confirm you have seen the plan.</p></div>
      <Button onClick={() => save.mutate({ response: responseText.trim() || null, acknowledged_at: new Date().toISOString() })} disabled={save.isPending}>I acknowledge this PIP</Button>
    </div>}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">My PIP</h1><p className="mt-1 text-sm text-muted-foreground">{formatPipDate(pip.start_date)} – {formatPipDate(pip.end_date)} · {daysLeft} days left</p></div>
      <div className="flex items-center gap-2">{acknowledgedAt && <span className="flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-success" />Acknowledged {formatPipDate(acknowledgedAt)}</span>}<PipStatusBadge status={formatPipStatus(pip.status)} /></div>
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardContent className="p-4">
        <h2 className="mb-2 text-sm font-semibold">My goals</h2>
        {goalsQuery.isLoading ? <p className="py-6 text-sm text-muted-foreground">Loading goals…</p>
          : goals.length === 0 ? <p className="py-6 text-sm text-muted-foreground">No goals have been added yet.</p>
          : <div className="divide-y divide-border">{goals.map((goal) => {
            return <div key={goal.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto_auto_8rem] sm:items-center sm:gap-4">
              <div className="min-w-0"><p className="text-sm font-medium">{goal.title}</p><p className="text-xs text-muted-foreground">{goal.kpi} · Target {goal.target}</p></div>
              <GoalStatusBadge status={goal.status} />
              <span className="text-xs text-muted-foreground">Rating {goal.rating ?? "–"}/5</span>
              <PipProgress value={goal.progress_percent} compact />
            </div>;
          })}</div>}
      </CardContent></Card>
      <Card><CardContent className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Manager feedback</h2>
        {feedback.length === 0 ? <p className="py-6 text-sm text-muted-foreground">Feedback from your reviews will appear here.</p>
          : <ul className="space-y-4">{feedback.map((review) => <li key={review.id} className="flex gap-3"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${review.completed_at ? "bg-success" : "bg-warning"}`} aria-hidden="true" /><div><p className="text-xs font-medium">{formatPipDate(review.scheduled_date)}</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{review.shared_summary}</p></div></li>)}</ul>}
      </CardContent></Card>
    </div>
    <Card><CardContent className="space-y-3 p-4">
      <h2 className="text-sm font-semibold">My response</h2>
      <Textarea aria-label="Your PIP response" rows={4} value={responseText} onChange={(event) => setResponseText(event.target.value)} placeholder="Add a comment for your manager and HR" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1 text-xs text-muted-foreground"><ShieldAlert className="h-3.5 w-3.5" />HR-only internal notes are never shown on this page.</p>
        <Button onClick={() => save.mutate({ response: responseText.trim() || null, acknowledged_at: acknowledgedAt })} disabled={save.isPending}>Save response</Button>
      </div>
    </CardContent></Card>
  </>;
}
