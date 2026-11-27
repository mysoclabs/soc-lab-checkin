import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { ArrowLeft, CalendarClock, Check, CheckCircle2, ClipboardList, FileText, MessageSquareText, Plus, Save, Shield, Star, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RoleGuard } from "@/components/role-guard";
import { GoalStatusBadge, PipMetric, PipProgress, PipStatusBadge, formatPipDate, formatPipStatus } from "@/components/pip/pip-ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUserRole } from "@/hooks/use-role";
import { supabase } from "@/integrations/supabase/client";
import { addPipInternalNote, deletePip, deletePipGoal, publishPip, setPipStatus, updatePip, upsertPipCheckin, upsertPipGoal } from "@/lib/pip.functions";
import { canChangePipStatus, canEditPipBasics, canManagePipGoals, canPublishPip, type PipRole, type PipStatus } from "@/lib/pip-permissions";

export const Route = createFileRoute("/_authenticated/pip/$id")({
  head: () => ({
    meta: [
      { title: "PIP Details · MySocLabs" },
      { name: "description", content: "Review employee performance plan goals, progress, feedback, and check-ins." },
      { property: "og:title", content: "PIP Details · MySocLabs" },
      { property: "og:description", content: "Review employee performance plan goals, progress, feedback, and check-ins." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <RoleGuard allow={["super_admin", "hr_admin", "employee"]}><PipDetail /></RoleGuard>,
});

type GoalRow = { id?: string; title: string; description: string; kpi: string; target: string; weight: number; due_date: string; supporting_evidence: string; progress_percent: number; status: string; rating: number | null; shared_feedback: string };
type ReviewRow = { id?: string; scheduledDate: string; completed: boolean; progressPercent: number; rating: number | null; sharedSummary: string; hrFeedback: string };
const newGoal = (): GoalRow => ({ title: "", description: "", kpi: "", target: "", weight: 25, due_date: "", supporting_evidence: "", progress_percent: 0, status: "not_started", rating: null, shared_feedback: "" });

function PipDetail() {
  const { id } = Route.useParams();
  const { role, userId } = useUserRole();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pipRole: PipRole | null = role === "super_admin" || role === "hr_admin" || role === "employee" ? role : null;
  const isAdmin = role === "super_admin" || role === "hr_admin";
  const isSuperAdmin = role === "super_admin";
  const planQuery = useQuery({
    queryKey: ["pip", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_records").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const goalsQuery = useQuery({
    queryKey: ["pip-goals", id], enabled: !!planQuery.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_goals").select("*").eq("pip_id", id).order("position");
      if (error) throw error;
      return data ?? [];
    },
  });
  const reviewsQuery = useQuery({
    queryKey: ["pip-checkins", id], enabled: !!planQuery.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_checkins").select("*").eq("pip_id", id).order("scheduled_date");
      if (error) throw error;
      return data ?? [];
    },
  });
  const responseQuery = useQuery({
    queryKey: ["pip-response", id], enabled: !!planQuery.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_employee_responses").select("*").eq("pip_id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const notesQuery = useQuery({
    queryKey: ["pip-notes", id], enabled: isAdmin && !!planQuery.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_internal_notes").select("*").eq("pip_id", id).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const activityQuery = useQuery({
    queryKey: ["pip-activity", id], enabled: isAdmin && !!planQuery.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_logs").select("id, action, user_name, created_at")
        .eq("entity", "pip").eq("entity_id", id).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const createGoalFn = useServerFn(upsertPipGoal);
  const deleteGoalFn = useServerFn(deletePipGoal);
  const updatePlanFn = useServerFn(updatePip);
  const publishFn = useServerFn(publishPip);
  const checkinFn = useServerFn(upsertPipCheckin);
  const noteFn = useServerFn(addPipInternalNote);
  const statusFn = useServerFn(setPipStatus);
  const deletePipFn = useServerFn(deletePip);
  const pip = planQuery.data;
  const goals = goalsQuery.data ?? [];
  const reviews = reviewsQuery.data ?? [];
  const response = responseQuery.data;
  const [editOpen, setEditOpen] = useState(false);
  const [editStartDate, setEditStartDate] = useState("");
  const [editDuration, setEditDuration] = useState(30);
  const [editEndDate, setEditEndDate] = useState("");
  const [editFrequency, setEditFrequency] = useState(14);
  const [editFocus, setEditFocus] = useState("");
  const [editConcerns, setEditConcerns] = useState("");
  const [editSupport, setEditSupport] = useState("");
  const [editConsequences, setEditConsequences] = useState("");
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalForm, setGoalForm] = useState<GoalRow>(newGoal());
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinForm, setCheckinForm] = useState<ReviewRow>({ scheduledDate: new Date().toISOString().slice(0, 10), completed: false, progressPercent: 0, rating: null, sharedSummary: "", hrFeedback: "" });
  const [internalNote, setInternalNote] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<PipStatus>("active");
  const [statusReason, setStatusReason] = useState("");
  const [revisedEndDate, setRevisedEndDate] = useState("");
  const [employeeText, setEmployeeText] = useState("");
  const [employeeAcknowledge, setEmployeeAcknowledge] = useState(false);
  useEffect(() => {
    setEmployeeText(response?.response ?? "");
    setEmployeeAcknowledge(Boolean(response?.acknowledged_at));
  }, [response]);

  const invalidatePip = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pip", id] }),
      queryClient.invalidateQueries({ queryKey: ["pip-records"] }),
      queryClient.invalidateQueries({ queryKey: ["pip-goals"] }),
      queryClient.invalidateQueries({ queryKey: ["pip-goals", id] }),
      queryClient.invalidateQueries({ queryKey: ["pip-checkins"] }),
      queryClient.invalidateQueries({ queryKey: ["pip-checkins", id] }),
      queryClient.invalidateQueries({ queryKey: ["pip-notes", id] }),
      queryClient.invalidateQueries({ queryKey: ["pip-activity", id] }),
      queryClient.invalidateQueries({ queryKey: ["pip-response", id] }),
    ]);
  };
  const mutationOptions = { onSuccess: async () => { toast.success("PIP updated"); await invalidatePip(); }, onError: (error: Error) => toast.error(error.message) };
  const updatePlan = useMutation({ mutationFn: (input: Parameters<typeof updatePlanFn>[0]["data"]) => updatePlanFn({ data: input }), ...mutationOptions, onSuccess: async () => { setEditOpen(false); await mutationOptions.onSuccess(); } });
  const publish = useMutation({ mutationFn: () => publishFn({ data: { pipId: id } }), ...mutationOptions, onSuccess: async () => { toast.success("PIP published"); await invalidatePip(); } });
  const saveGoal = useMutation({ mutationFn: (input: Omit<GoalRow, "id"> & { goalId?: string }) => createGoalFn({ data: {
    pipId: id, goalId: input.goalId, title: input.title, description: input.description || null, kpi: input.kpi, target: input.target,
    weight: input.weight, due_date: input.due_date || null, supporting_evidence: input.supporting_evidence || null,
    progress_percent: input.progress_percent, status: input.status as "not_started" | "in_progress" | "complete", rating: input.rating, shared_feedback: input.shared_feedback || null,
  } }), ...mutationOptions, onSuccess: async () => { setGoalOpen(false); setGoalForm(newGoal()); await mutationOptions.onSuccess(); } });
  const removeGoal = useMutation({ mutationFn: (goalId: string) => deleteGoalFn({ data: { pipId: id, goalId } }), ...mutationOptions });
  const saveReview = useMutation({ mutationFn: (input: ReviewRow) => checkinFn({ data: {
    pipId: id, checkinId: input.id, scheduledDate: input.scheduledDate, completed: input.completed,
    progressPercent: input.progressPercent, rating: input.rating, sharedSummary: input.sharedSummary || null, hrFeedback: input.hrFeedback || null,
  } }), ...mutationOptions, onSuccess: async () => { setCheckinOpen(false); await mutationOptions.onSuccess(); } });
  const saveNote = useMutation({ mutationFn: (note: string) => noteFn({ data: { pipId: id, note } }), ...mutationOptions, onSuccess: async () => { setInternalNote(""); await mutationOptions.onSuccess(); } });
  const changeStatus = useMutation({ mutationFn: () => statusFn({ data: { pipId: id, status: nextStatus, reason: statusReason || null, endDate: revisedEndDate || undefined } }), ...mutationOptions, onSuccess: async () => { setStatusOpen(false); setStatusReason(""); await mutationOptions.onSuccess(); } });
  const removePip = useMutation({ mutationFn: () => deletePipFn({ data: { pipId: id } }), onSuccess: async () => { toast.success("PIP deleted"); await queryClient.invalidateQueries({ queryKey: ["pip-records"] }); navigate({ to: "/pip" }); }, onError: (error: Error) => toast.error(error.message) });
  const saveEmployeeResponse = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Please sign in again");
      const payload = { response: employeeText.trim() || null, acknowledged_at: employeeAcknowledge ? response?.acknowledged_at ?? new Date().toISOString() : null };
      const result = response
        ? await supabase.from("pip_employee_responses").update(payload).eq("id", response.id)
        : await supabase.from("pip_employee_responses").insert({ ...payload, pip_id: id, created_by: userId });
      if (result.error) throw result.error;
    },
    onSuccess: async () => { toast.success("Your response was saved"); await invalidatePip(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save your response"),
  });

  if (planQuery.isLoading) return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Loading PIP…</div>;
  if (planQuery.isError || !pip) return <div className="space-y-4"><Button asChild variant="ghost"><Link to={isAdmin ? "/pip" : "/my-pip"}><ArrowLeft className="mr-2 h-4 w-4" />Back to PIPs</Link></Button><p className="py-12 text-center text-muted-foreground">This PIP is unavailable or you do not have access.</p></div>;

  const accessRecord = { status: formatPipStatus(pip.status), hr_owner_user_id: pip.hr_owner_user_id, employee_email: pip.employee_email };
  const canEditBasics = pipRole ? canEditPipBasics(pipRole, userId ?? "", accessRecord) : false;
  const canPublish = pipRole ? canPublishPip(pipRole, userId ?? "", accessRecord) : false;
  const canManageGoals = pipRole ? canManagePipGoals(pipRole, userId ?? "", accessRecord) : false;
  const averageProgress = goals.length ? Math.round(goals.reduce((sum, goal) => sum + goal.progress_percent, 0) / goals.length) : pip.progress_percent;
  const goalsMet = goals.filter((goal) => goal.status === "complete").length;
  const ratings = goals.flatMap((goal) => goal.rating ? [goal.rating] : []);
  const averageRating = ratings.length ? (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1) : null;
  const today = new Date().toISOString().slice(0, 10);
  const nextReview = reviews.find((review) => !review.completed_at && review.scheduled_date >= today)?.scheduled_date;
  const isRunning = pip.status === "active" || pip.status === "extended";
  const daysLeft = Math.max(0, differenceInCalendarDays(parseISO(pip.end_date), new Date()));
  const canSetStatus = (next: PipStatus) => pipRole ? canChangePipStatus(pipRole, userId ?? "", accessRecord, next) : false;
  const closeOptions: PipStatus[] = (["completed", "unsuccessful", "cancelled"] as const).filter(canSetStatus);
  const closeLabels: Record<string, string> = { completed: "Successful", unsuccessful: "Unsuccessful", cancelled: "Cancelled" };

  const openEditPlan = () => {
    setEditStartDate(pip.start_date);
    setEditDuration(pip.duration_days);
    setEditEndDate(pip.end_date);
    setEditFrequency(pip.review_frequency_days);
    setEditFocus(pip.focus_areas.join(", "));
    setEditConcerns(pip.performance_concerns);
    setEditSupport(pip.support_provided ?? "");
    setEditConsequences(pip.consequences ?? "");
    setEditOpen(true);
  }

  const openStatus = (next: PipStatus) => {
    setNextStatus(next);
    setRevisedEndDate(pip.end_date);
    setStatusReason("");
    setStatusOpen(true);
  }

  function openAddGoal() { setGoalForm(newGoal()); setGoalOpen(true); }
  function openEditGoal(goal: typeof goals[number]) {
    setGoalForm({ id: goal.id, title: goal.title, description: goal.description ?? "", kpi: goal.kpi, target: goal.target, weight: goal.weight, due_date: goal.due_date ?? "", supporting_evidence: goal.supporting_evidence ?? "", progress_percent: goal.progress_percent, status: goal.status, rating: goal.rating, shared_feedback: goal.shared_feedback ?? "" });
    setGoalOpen(true);
  }
  function openAddReview() {
    setCheckinForm({ scheduledDate: new Date().toISOString().slice(0, 10), completed: false, progressPercent: averageProgress, rating: null, sharedSummary: "", hrFeedback: "" });
    setCheckinOpen(true);
  }
  function openEditReview(review: typeof reviews[number]) {
    setCheckinForm({ id: review.id, scheduledDate: review.scheduled_date, completed: Boolean(review.completed_at), progressPercent: review.progress_percent, rating: review.rating, sharedSummary: review.shared_summary ?? "", hrFeedback: review.hr_feedback ?? "" });
    setCheckinOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" className="-ml-3"><Link to={isAdmin ? "/pip" : "/my-pip"}><ArrowLeft className="mr-2 h-4 w-4" />{isAdmin ? "PIP Management" : "My PIP"}</Link></Button>
        <div className="flex flex-wrap gap-2">
          {canEditBasics && <Button variant="outline" onClick={openEditPlan}>Edit plan</Button>}
          {canPublish && <Button onClick={() => publish.mutate()} disabled={publish.isPending}><Check className="mr-2 h-4 w-4" />{publish.isPending ? "Publishing…" : "Publish PIP"}</Button>}
          {isRunning && canSetStatus("extended") && <Button variant="outline" onClick={() => openStatus("extended")}>Extend</Button>}
          {isRunning && closeOptions.length > 0 && <Button onClick={() => openStatus(closeOptions[0])}>Close PIP</Button>}
          {!isRunning && pip.status !== "draft" && canSetStatus("active") && <Button variant="outline" onClick={() => openStatus("active")}>Reopen</Button>}
          {isSuperAdmin && <AlertDialog><AlertDialogTrigger asChild><Button size="icon" variant="destructive" aria-label="Delete PIP"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this PIP?</AlertDialogTitle><AlertDialogDescription>This permanently removes this plan and its goals, check-ins, notes, and employee response. The action is recorded in the audit log.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep PIP</AlertDialogCancel><AlertDialogAction onClick={() => removePip.mutate()}>Delete PIP</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
        </div>
      </div>

      <section className="space-y-4 border-b border-border pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-medium uppercase text-primary">Performance improvement plan</p><h1 className="mt-1 text-2xl font-semibold">{pip.employee_name}</h1><p className="mt-1 text-sm text-muted-foreground">{pip.employee_email}{pip.department ? ` · ${pip.department}` : ""}{pip.designation ? ` · ${pip.designation}` : ""}{isRunning ? ` · ${daysLeft} days left` : ""}</p></div>
          <PipStatusBadge status={formatPipStatus(pip.status)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PipMetric label="Overall progress" value={`${averageProgress}%`} icon={Target} />
          <PipMetric label="Goals met" value={`${goalsMet} of ${goals.length}`} icon={CheckCircle2} />
          <PipMetric label="Avg rating" value={averageRating ? `${averageRating} / 5` : "—"} icon={Star} />
          <PipMetric label="Next review" value={formatPipDate(nextReview)} icon={CalendarClock} caption={isRunning ? `${daysLeft} days left in plan` : undefined} />
        </div>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
          <Info label="HR owner" value={pip.hr_owner_email} />
          <Info label="Duration" value={`${pip.duration_days} days · ${formatPipDate(pip.start_date)} – ${formatPipDate(pip.end_date)}`} />
          <Info label="Review frequency" value={`Every ${pip.review_frequency_days} days`} />
        </div>
        <div><p className="text-xs text-muted-foreground">Focus areas</p><div className="mt-2 flex flex-wrap gap-2">{pip.focus_areas.length ? pip.focus_areas.map((focus) => <span key={focus} className="rounded-sm bg-muted px-2 py-1 text-xs">{focus}</span>) : <span className="text-sm">Not specified</span>}</div></div>
        <div><p className="text-xs text-muted-foreground">Reason</p><p className="mt-1 whitespace-pre-wrap text-sm">{pip.performance_concerns}</p></div>
        {pip.support_provided && <div><p className="text-xs text-muted-foreground">Support provided</p><p className="mt-1 whitespace-pre-wrap text-sm">{pip.support_provided}</p></div>}
        {pip.consequences && <div><p className="text-xs text-muted-foreground">If goals are not met</p><p className="mt-1 whitespace-pre-wrap text-sm">{pip.consequences}</p></div>}
        {pip.extension_reason && <div><p className="text-xs text-muted-foreground">Extension reason</p><p className="mt-1 whitespace-pre-wrap text-sm">{pip.extension_reason}</p></div>}
        {pip.close_reason && <div><p className="text-xs text-muted-foreground">Outcome note</p><p className="mt-1 text-sm">{pip.close_reason}</p></div>}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Target className="h-4 w-4 text-primary" />Goals and success measures</h2><p className="text-sm text-muted-foreground">{goals.length} measurable {goals.length === 1 ? "goal" : "goals"}</p></div>{canManageGoals && <Button variant="outline" onClick={openAddGoal}><Plus className="mr-2 h-4 w-4" />Add goal</Button>}</div>
        {goalsQuery.isLoading ? <p className="py-5 text-sm text-muted-foreground">Loading goals…</p> : goals.length === 0 ? <div className="border-y border-dashed border-border py-8 text-center"><p className="font-medium">No goals added yet</p>{canManageGoals && <p className="mt-1 text-sm text-muted-foreground">Add a measurable KPI and target before publishing.</p>}</div> : <Card><CardContent className="divide-y divide-border p-0">{goals.map((goal) => <div key={goal.id} className="space-y-2 p-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_8rem_auto] sm:items-center sm:gap-4">
            <div className="min-w-0"><p className="text-sm font-medium">{goal.title}</p><p className="text-xs text-muted-foreground">{goal.kpi} · Target {goal.target} · Weight {goal.weight}%{goal.due_date ? ` · Due ${formatPipDate(goal.due_date)}` : ""}</p></div>
            <GoalStatusBadge status={goal.status} />
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Star className="h-3.5 w-3.5 text-warning" />Rating {goal.rating ?? "–"}/5</span>
            <PipProgress value={goal.progress_percent} compact />
            {canManageGoals ? <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => openEditGoal(goal)}>Edit</Button><Button variant="ghost" size="icon" aria-label={`Remove ${goal.title}`} onClick={() => removeGoal.mutate(goal.id)}><Trash2 className="h-4 w-4" /></Button></div> : <span />}
          </div>
          {goal.description && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{goal.description}</p>}
          {goal.shared_feedback && <p className="whitespace-pre-wrap text-xs"><span className="text-muted-foreground">HR feedback: </span>{goal.shared_feedback}</p>}
          {goal.supporting_evidence && <p className="flex items-start gap-1.5 break-words text-xs text-muted-foreground"><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />{goal.supporting_evidence}</p>}
        </div>)}</CardContent></Card>}
      </section>

      <section className="space-y-4 border-t border-border pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><CalendarClock className="h-4 w-4 text-primary" />Check-ins and reviews</h2><p className="text-sm text-muted-foreground">Scheduled dates, progress, and shared feedback.</p></div>{canManageGoals && <Button variant="outline" onClick={openAddReview}><Plus className="mr-2 h-4 w-4" />Schedule review</Button>}</div>
        {reviews.length === 0 ? <p className="border-y border-dashed border-border py-8 text-center text-sm text-muted-foreground">No check-ins scheduled yet.</p> : <ol className="space-y-4 border-l border-border pl-5">{reviews.map((review) => <li key={review.id} className="relative space-y-1">
          <span className={`absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full ${review.completed_at ? "bg-success" : "bg-warning"}`} aria-hidden="true" />
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{formatPipDate(review.scheduled_date)} · {review.completed_at ? "Held" : "Scheduled"}</p><div className="flex items-center gap-3">{review.rating && <span className="inline-flex items-center gap-1 text-xs"><Star className="h-3.5 w-3.5 text-warning" />{review.rating}/5</span>}<span className="text-xs text-muted-foreground">{review.progress_percent}%</span>{canManageGoals && <Button variant="ghost" size="sm" onClick={() => openEditReview(review)}>Update</Button>}</div></div>
          {review.shared_summary ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{review.shared_summary}</p> : !review.completed_at && <p className="text-sm text-muted-foreground">Upcoming review.</p>}
          {review.hr_feedback && <p className="whitespace-pre-wrap text-sm"><span className="text-muted-foreground">HR feedback: </span>{review.hr_feedback}</p>}
        </li>)}</ol>}
      </section>

      {isAdmin && <section className="space-y-4 border-t border-border pt-6">
        <div><h2 className="flex items-center gap-2 text-lg font-semibold"><Shield className="h-4 w-4 text-primary" />Internal HR notes</h2><p className="text-sm text-muted-foreground">Only Super Admin and the assigned HR Admin can view these notes.</p></div>
        <div className="flex flex-col gap-2 sm:flex-row"><Textarea aria-label="Internal HR note" rows={2} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="Add a confidential HR note…" /><Button className="sm:self-end" disabled={!internalNote.trim() || saveNote.isPending} onClick={() => saveNote.mutate(internalNote)}><Plus className="mr-2 h-4 w-4" />Add note</Button></div>
        {notesQuery.data?.map((note) => <div key={note.id} className="border-l-2 border-primary/50 pl-3"><p className="whitespace-pre-wrap text-sm">{note.note}</p><p className="mt-1 text-xs text-muted-foreground">{note.author_email} · {formatPipDate(note.created_at)}</p></div>)}
      </section>}

      {isAdmin && <section className="space-y-3 border-t border-border pt-6"><h2 className="text-lg font-semibold">PIP activity</h2>{activityQuery.data?.length ? activityQuery.data.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 border-b border-border py-2 text-sm"><span>{item.action.replaceAll("_", " ")} · {item.user_name ?? "Portal user"}</span><span className="text-muted-foreground">{formatPipDate(item.created_at)}</span></div>) : <p className="text-sm text-muted-foreground">No activity recorded yet.</p>}</section>}

      {!isAdmin && <EmployeeResponseForm responseText={employeeText} setResponseText={setEmployeeText} acknowledged={employeeAcknowledge} setAcknowledged={setEmployeeAcknowledge} savedAt={response?.acknowledged_at ?? null} saving={saveEmployeeResponse.isPending} onSave={() => saveEmployeeResponse.mutate()} />}

      <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Edit PIP details</DialogTitle><DialogDescription>Update ownership dates, focus areas, and performance concerns.</DialogDescription></DialogHeader><div className="grid gap-4 py-3 sm:grid-cols-2"><div className="grid gap-2"><Label>Start date</Label><Input type="date" value={editStartDate} onChange={(event) => setEditStartDate(event.target.value)} /></div><div className="grid gap-2"><Label>Duration (days)</Label><Input type="number" min={1} value={editDuration} onChange={(event) => setEditDuration(Number(event.target.value))} /></div><div className="grid gap-2"><Label>End date</Label><Input type="date" value={editEndDate} onChange={(event) => setEditEndDate(event.target.value)} /></div><div className="grid gap-2"><Label>Review frequency (days)</Label><Input type="number" min={1} value={editFrequency} onChange={(event) => setEditFrequency(Number(event.target.value))} /></div><div className="grid gap-2 sm:col-span-2"><Label>Focus areas</Label><Input value={editFocus} onChange={(event) => setEditFocus(event.target.value)} /></div><div className="grid gap-2 sm:col-span-2"><Label>Reason</Label><Textarea rows={4} value={editConcerns} onChange={(event) => setEditConcerns(event.target.value)} /></div><div className="grid gap-2 sm:col-span-2"><Label>Support provided</Label><Textarea rows={3} value={editSupport} onChange={(event) => setEditSupport(event.target.value)} /></div><div className="grid gap-2 sm:col-span-2"><Label>If goals are not met</Label><Textarea rows={2} value={editConsequences} onChange={(event) => setEditConsequences(event.target.value)} /></div></div><DialogFooter><Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button><Button onClick={() => updatePlan.mutate({ pipId: id, startDate: editStartDate, durationDays: editDuration, endDate: editEndDate, reviewFrequencyDays: editFrequency, focusAreas: editFocus.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean), performanceConcerns: editConcerns, supportProvided: editSupport, consequences: editConsequences })} disabled={updatePlan.isPending}>Save changes</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={goalOpen} onOpenChange={setGoalOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{goalForm.id ? "Edit goal" : "Add measurable goal"}</DialogTitle><DialogDescription>Set a clear KPI and target. Progress, rating, and shared feedback can be updated during reviews.</DialogDescription></DialogHeader><div className="grid gap-4 py-3 sm:grid-cols-2"><div className="grid gap-2 sm:col-span-2"><Label>Goal</Label><Input value={goalForm.title} onChange={(event) => setGoalForm({ ...goalForm, title: event.target.value })} /></div><div className="grid gap-2"><Label>KPI</Label><Input value={goalForm.kpi} onChange={(event) => setGoalForm({ ...goalForm, kpi: event.target.value })} /></div><div className="grid gap-2"><Label>Target</Label><Input value={goalForm.target} onChange={(event) => setGoalForm({ ...goalForm, target: event.target.value })} /></div><div className="grid gap-2"><Label>Weight (%)</Label><Input type="number" min={0} max={100} value={goalForm.weight} onChange={(event) => setGoalForm({ ...goalForm, weight: Number(event.target.value) })} /></div><div className="grid gap-2"><Label>Due date</Label><Input type="date" value={goalForm.due_date} onChange={(event) => setGoalForm({ ...goalForm, due_date: event.target.value })} /></div><div className="grid gap-2"><Label>Progress (%)</Label><Input type="number" min={0} max={100} value={goalForm.progress_percent} onChange={(event) => setGoalForm({ ...goalForm, progress_percent: Number(event.target.value) })} /></div><div className="grid gap-2"><Label>Rating (1–5)</Label><Input type="number" min={1} max={5} value={goalForm.rating ?? ""} onChange={(event) => setGoalForm({ ...goalForm, rating: event.target.value ? Number(event.target.value) : null })} /></div><div className="grid gap-2 sm:col-span-2"><Label>Description</Label><Textarea rows={2} value={goalForm.description} onChange={(event) => setGoalForm({ ...goalForm, description: event.target.value })} /></div><div className="grid gap-2 sm:col-span-2"><Label>Shared HR feedback</Label><Textarea rows={2} value={goalForm.shared_feedback} onChange={(event) => setGoalForm({ ...goalForm, shared_feedback: event.target.value })} /></div><div className="grid gap-2 sm:col-span-2"><Label>Supporting evidence</Label><Textarea rows={2} value={goalForm.supporting_evidence} onChange={(event) => setGoalForm({ ...goalForm, supporting_evidence: event.target.value })} /></div></div><DialogFooter><Button variant="ghost" onClick={() => setGoalOpen(false)}>Cancel</Button><Button onClick={() => saveGoal.mutate({ ...goalForm, goalId: goalForm.id })} disabled={saveGoal.isPending || !goalForm.title.trim() || !goalForm.kpi.trim() || !goalForm.target.trim()}><Save className="mr-2 h-4 w-4" />Save goal</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={checkinOpen} onOpenChange={setCheckinOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{checkinForm.id ? "Update review" : "Schedule a review"}</DialogTitle><DialogDescription>Record progress, rating, and feedback shared with the employee.</DialogDescription></DialogHeader><div className="grid gap-4 py-3 sm:grid-cols-2"><div className="grid gap-2"><Label>Review date</Label><Input type="date" value={checkinForm.scheduledDate} onChange={(event) => setCheckinForm({ ...checkinForm, scheduledDate: event.target.value })} /></div><div className="grid gap-2"><Label>Progress (%)</Label><Input type="number" min={0} max={100} value={checkinForm.progressPercent} onChange={(event) => setCheckinForm({ ...checkinForm, progressPercent: Number(event.target.value) })} /></div><div className="grid gap-2"><Label>Rating (1–5)</Label><Input type="number" min={1} max={5} value={checkinForm.rating ?? ""} onChange={(event) => setCheckinForm({ ...checkinForm, rating: event.target.value ? Number(event.target.value) : null })} /></div><div className="flex items-center gap-2 self-end pb-2"><Checkbox checked={checkinForm.completed} onCheckedChange={(checked) => setCheckinForm({ ...checkinForm, completed: checked === true })} id="review-completed" /><Label htmlFor="review-completed">Review completed</Label></div><div className="grid gap-2 sm:col-span-2"><Label>Shared summary</Label><Textarea rows={3} value={checkinForm.sharedSummary} onChange={(event) => setCheckinForm({ ...checkinForm, sharedSummary: event.target.value })} /></div><div className="grid gap-2 sm:col-span-2"><Label>HR feedback for employee</Label><Textarea rows={3} value={checkinForm.hrFeedback} onChange={(event) => setCheckinForm({ ...checkinForm, hrFeedback: event.target.value })} /></div></div><DialogFooter><Button variant="ghost" onClick={() => setCheckinOpen(false)}>Cancel</Button><Button onClick={() => saveReview.mutate(checkinForm)} disabled={saveReview.isPending}>Save review</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={statusOpen} onOpenChange={setStatusOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{nextStatus === "extended" ? "Extend PIP" : nextStatus === "active" ? "Reopen PIP" : "Close PIP"}</DialogTitle><DialogDescription>{nextStatus === "extended" ? "Set a new end date and record why the plan is being extended." : nextStatus === "active" ? "Reopen this plan and make it active again." : "Record the outcome of this plan."}</DialogDescription></DialogHeader><div className="space-y-4 py-3">
        {nextStatus === "extended" && <div className="grid gap-2"><Label>New end date</Label><Input type="date" min={pip.end_date} value={revisedEndDate} onChange={(event) => setRevisedEndDate(event.target.value)} /></div>}
        {closeOptions.includes(nextStatus) && <div className="grid gap-2"><Label>Outcome</Label><Select value={nextStatus} onValueChange={(value) => setNextStatus(value as PipStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{closeOptions.map((status) => <SelectItem key={status} value={status}>{closeLabels[status]}</SelectItem>)}</SelectContent></Select></div>}
        {nextStatus !== "active" && <div className="grid gap-2"><Label>{nextStatus === "extended" ? "Extension reason" : "Outcome notes"}</Label><Textarea value={statusReason} onChange={(event) => setStatusReason(event.target.value)} rows={3} /></div>}
      </div><DialogFooter><Button variant="ghost" onClick={() => setStatusOpen(false)}>Cancel</Button><Button onClick={() => changeStatus.mutate()} disabled={changeStatus.isPending || (nextStatus !== "active" && !statusReason.trim())}>{nextStatus === "extended" ? "Extend" : nextStatus === "active" ? "Reopen" : "Close PIP"}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p></div>;
}

function EmployeeResponseForm({ responseText, setResponseText, acknowledged, setAcknowledged, savedAt, saving, onSave }: { responseText: string; setResponseText: (value: string) => void; acknowledged: boolean; setAcknowledged: (value: boolean) => void; savedAt: string | null; saving: boolean; onSave: () => void }) {
  return <section className="space-y-4 border-t border-border pt-6"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><MessageSquareText className="h-4 w-4 text-primary" />Your acknowledgement and response</h2><p className="text-sm text-muted-foreground">Your response is visible to the assigned HR Admin and Super Admin.</p></div><div className="flex items-start gap-3"><Checkbox id="pip-acknowledge" checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked === true)} /><Label htmlFor="pip-acknowledge" className="leading-5">I acknowledge that I have reviewed this performance plan.</Label></div><Textarea aria-label="Your PIP response" rows={4} value={responseText} onChange={(event) => setResponseText(event.target.value)} placeholder="Add a response or share context for your HR review." /><div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{savedAt ? `Acknowledged ${formatPipDate(savedAt)}` : "You can update your response at any time."}</span><Button onClick={onSave} disabled={saving}><CheckCircle2 className="mr-2 h-4 w-4" />Save response</Button></div></section>;
}