import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, ClipboardList, Download, Plus, Search, Star, Target } from "lucide-react";
import { toast } from "sonner";
import { RoleGuard } from "@/components/role-guard";
import { PipMetric, PipProgress, PipStatusBadge, formatPipDate, formatPipStatus } from "@/components/pip/pip-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/hooks/use-role";
import { supabase } from "@/integrations/supabase/client";
import { createPip, publishPip } from "@/lib/pip.functions";
import { goalWeightsAddUp, PIP_STATUSES, type PipStatus } from "@/lib/pip-permissions";

export const Route = createFileRoute("/_authenticated/pip/")({
  head: () => ({
    meta: [
      { title: "PIP Management · MySocLabs" },
      { name: "description", content: "Manage employee performance improvement plans, goals, and reviews at MySocLabs." },
      { property: "og:title", content: "PIP Management · MySocLabs" },
      { property: "og:description", content: "Manage employee performance improvement plans, goals, and reviews at MySocLabs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <RoleGuard allow={["super_admin", "hr_admin"]}><PipDashboard /></RoleGuard>,
});

type GoalDraft = { title: string; description: string; kpi: string; target: string; weight: number; dueDate: string; evidence: string };
type EmployeeOption = { id: string; name: string; email: string; department: string | null; designation: string | null };
const blankGoal = (): GoalDraft => ({ title: "", description: "", kpi: "", target: "", weight: 25, dueDate: "", evidence: "" });

function PipDashboard() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [focusFilter, setFocusFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [durationDays, setDurationDays] = useState(30);
  const [reviewFrequencyDays, setReviewFrequencyDays] = useState(14);
  const [focusText, setFocusText] = useState("");
  const [concerns, setConcerns] = useState("");
  const [supportProvided, setSupportProvided] = useState("");
  const [consequences, setConsequences] = useState("");
  const [goals, setGoals] = useState<GoalDraft[]>([blankGoal()]);
  const { email } = useCurrentUser();
  const navigate = useNavigate();
  const createFn = useServerFn(createPip);
  const publishFn = useServerFn(publishPip);

  const plansQuery = useQuery({
    queryKey: ["pip-records"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_records").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const goalsQuery = useQuery({
    queryKey: ["pip-goals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_goals").select("pip_id, rating");
      if (error) throw error;
      return data ?? [];
    },
  });
  const checkinsQuery = useQuery({
    queryKey: ["pip-checkins"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_checkins").select("pip_id, scheduled_date, completed_at, rating");
      if (error) throw error;
      return data ?? [];
    },
  });
  const employeesQuery = useQuery({
    queryKey: ["pip-employee-options"],
    enabled: createOpen,
    queryFn: async () => {
      const { data, error } = await supabase.from("students")
        .select("id, name, email, department, designation").order("name");
      if (error) throw error;
      return (data ?? []) as EmployeeOption[];
    },
  });

  const plans = plansQuery.data ?? [];
  const pipGoals = goalsQuery.data ?? [];
  const checkins = checkinsQuery.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndString = weekEnd.toISOString().slice(0, 10);
  const ratings = [
    ...pipGoals.map((goal) => goal.rating),
    ...checkins.map((checkin) => checkin.rating),
  ].filter((rating): rating is number => rating !== null);
  const averageRating = ratings.length ? (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1) : "—";
  const reviewDueThisWeek = checkins.filter((checkin) => !checkin.completed_at && checkin.scheduled_date >= today && checkin.scheduled_date <= weekEndString).length;
  const nextReviewByPip = useMemo(() => {
    const next = new Map<string, string>();
    for (const item of checkins) {
      if (item.completed_at || item.scheduled_date < today) continue;
      const current = next.get(item.pip_id);
      if (!current || item.scheduled_date < current) next.set(item.pip_id, item.scheduled_date);
    }
    return next;
  }, [checkins, today]);
  const focusOptions = [...new Set(plans.flatMap((pip) => pip.focus_areas))].sort((a, b) => a.localeCompare(b));
  const ownerOptions = [...new Set(plans.map((pip) => pip.hr_owner_email))].sort((a, b) => a.localeCompare(b));
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter((pip) => {
      const matchesSearch = !q || [pip.employee_name, pip.employee_email, pip.hr_owner_email, ...pip.focus_areas]
        .some((value) => value.toLowerCase().includes(q));
      return matchesSearch
        && (statusFilter === "all" || pip.status === statusFilter)
        && (focusFilter === "all" || pip.focus_areas.includes(focusFilter))
        && (ownerFilter === "all" || pip.hr_owner_email === ownerFilter);
    });
  }, [plans, search, statusFilter, focusFilter, ownerFilter]);

  const createMutation = useMutation({
    mutationFn: async ({ publish, ...input }: Parameters<typeof createFn>[0]["data"] & { publish: boolean }) => {
      const { id } = await createFn({ data: input });
      if (!publish) return { id, published: false };
      try {
        await publishFn({ data: { pipId: id } });
        return { id, published: true };
      } catch (error) {
        toast.error(`Saved as draft, but not published: ${error instanceof Error ? error.message : "unknown error"}`);
        return { id, published: false };
      }
    },
    onSuccess: async ({ id, published }) => {
      await queryClient.invalidateQueries({ queryKey: ["pip-records"] });
      toast.success(published ? "PIP published" : "PIP draft created");
      setCreateOpen(false);
      resetForm();
      navigate({ to: "/pip/$id", params: { id } });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to create PIP"),
  });

  function resetForm() {
    setEmployeeId("");
    setStartDate(new Date().toISOString().slice(0, 10));
    setDurationDays(30);
    setReviewFrequencyDays(14);
    setFocusText("");
    setConcerns("");
    setSupportProvided("");
    setConsequences("");
    setGoals([blankGoal()]);
  }

  function submitCreate(publish: boolean) {
    const endDate = calculateEndDate(startDate, durationDays);
    createMutation.mutate({
      publish,
      employeeId,
      startDate,
      durationDays,
      endDate,
      reviewFrequencyDays,
      focusAreas: focusText.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean),
      performanceConcerns: concerns,
      supportProvided: supportProvided || null,
      consequences: consequences || null,
      goals: filledGoals.map((goal) => ({
        title: goal.title,
        description: goal.description || null,
        kpi: goal.kpi,
        target: goal.target,
        weight: goal.weight,
        due_date: goal.dueDate || null,
        supporting_evidence: goal.evidence || null,
      })),
    });
  }

  function exportCsv() {
    if (!filtered.length) return toast.info("No PIP records to export");
    const rows = filtered.map((pip) => ({
      employee: pip.employee_name,
      email: pip.employee_email,
      department: pip.department ?? "",
      focus_areas: pip.focus_areas.join("; "),
      hr_owner: pip.hr_owner_email,
      start_date: pip.start_date,
      end_date: pip.end_date,
      progress_percent: pip.progress_percent,
      status: pip.status,
      next_review: nextReviewByPip.get(pip.id) ?? "",
    }));
    const columns = Object.keys(rows[0] ?? {});
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => escape(row[column as keyof typeof row])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mysoclabs-pip-${today}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const filledGoals = goals.filter((goal) => goal.title.trim());
  const weightTotal = filledGoals.reduce((sum, goal) => sum + goal.weight, 0);
  const weightsOk = goalWeightsAddUp(filledGoals.map((goal) => goal.weight));
  const activeCount = plans.filter((pip) => pip.status === "active" || pip.status === "extended").length;
  const completedCount = plans.filter((pip) => pip.status === "completed").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-primary">People operations</p>
          <h1 className="mt-1 text-2xl font-semibold">PIP Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">Performance plans, milestones, and review dates.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
          <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Create PIP</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PipMetric label="Active PIPs" value={activeCount} icon={Target} caption={`${plans.filter((pip) => pip.status === "draft").length} drafts in progress`} />
        <PipMetric label="Reviews due this week" value={reviewDueThisWeek} icon={CalendarClock} caption="Scheduled check-ins" />
        <PipMetric label="Completed successfully" value={completedCount} icon={CheckCircle2} caption="Closed as completed" />
        <PipMetric label="Average rating" value={averageRating} icon={Star} caption={ratings.length ? "Across goal and review ratings" : "Ratings appear after reviews"} />
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold">PIP records</h2>
            <p className="text-sm text-muted-foreground">{filtered.length} of {plans.length} plans</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:flex xl:flex-wrap">
            <div className="relative sm:col-span-2 xl:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search PIP records" className="pl-9" placeholder="Search employee or focus area" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="Filter by status" className="sm:w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All statuses</SelectItem>{PIP_STATUSES.map((status) => <SelectItem key={status} value={status}>{statusLabel(status)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={focusFilter} onValueChange={setFocusFilter}>
              <SelectTrigger aria-label="Filter by focus area" className="sm:w-44"><SelectValue placeholder="All focus areas" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All focus areas</SelectItem>{focusOptions.map((focus) => <SelectItem key={focus} value={focus}>{focus}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger aria-label="Filter by HR owner" className="sm:w-48"><SelectValue placeholder="All HR owners" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All HR owners</SelectItem>{ownerOptions.map((owner) => <SelectItem key={owner} value={owner}>{owner}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Employee</TableHead><TableHead>Focus areas</TableHead><TableHead>HR owner</TableHead>
                  <TableHead>Start</TableHead><TableHead>End</TableHead><TableHead>Progress</TableHead><TableHead>Status</TableHead><TableHead>Next review</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {plansQuery.isLoading ? <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">Loading PIP records…</TableCell></TableRow>
                    : plansQuery.error ? <TableRow><TableCell colSpan={8} className="h-28 text-center text-destructive">{plansQuery.error instanceof Error ? plansQuery.error.message : "Unable to load PIP records"}</TableCell></TableRow>
                    : filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="h-36 text-center"><ClipboardList className="mx-auto mb-2 h-6 w-6 text-muted-foreground" /><p className="font-medium">No PIP records found</p><p className="mt-1 text-sm text-muted-foreground">Create a plan or adjust your filters.</p></TableCell></TableRow>
                    : filtered.map((pip) => (
                      <TableRow key={pip.id} tabIndex={0} className="cursor-pointer" onClick={() => navigate({ to: "/pip/$id", params: { id: pip.id } })} onKeyDown={(event) => { if (event.key === "Enter") navigate({ to: "/pip/$id", params: { id: pip.id } }); }}>
                        <TableCell><Link className="font-medium hover:text-primary" to="/pip/$id" params={{ id: pip.id }} onClick={(event) => event.stopPropagation()}>{pip.employee_name}</Link><p className="text-xs text-muted-foreground">{pip.department ?? pip.employee_email}</p></TableCell>
                        <TableCell><div className="flex max-w-48 flex-wrap gap-1">{pip.focus_areas.length ? pip.focus_areas.slice(0, 2).map((focus) => <span key={focus} className="rounded-sm bg-muted px-2 py-1 text-xs">{focus}</span>) : <span className="text-xs text-muted-foreground">Not set</span>}{pip.focus_areas.length > 2 && <span className="text-xs text-muted-foreground">+{pip.focus_areas.length - 2}</span>}</div></TableCell>
                        <TableCell className="max-w-40 truncate">{pip.hr_owner_email}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{formatPipDate(pip.start_date)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{formatPipDate(pip.end_date)}</TableCell>
                        <TableCell><PipProgress value={pip.progress_percent} compact /></TableCell>
                        <TableCell><PipStatusBadge status={formatPipStatus(pip.status)} /></TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{formatPipDate(nextReviewByPip.get(pip.id))}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create a performance plan</DialogTitle>
            <DialogDescription>Save as a draft, add measurable goals, then publish when ready.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Employee ownership</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2 sm:col-span-2"><Label>Employee</Label>
                  <Select value={employeeId} onValueChange={setEmployeeId}><SelectTrigger><SelectValue placeholder="Select an employee" /></SelectTrigger><SelectContent>{(employeesQuery.data ?? []).map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name} · {employee.email}</SelectItem>)}</SelectContent></Select>
                  {employeesQuery.isError && <p className="text-xs text-destructive">Unable to load employees.</p>}
                </div>
                <div className="grid gap-2"><Label>HR owner</Label><Input value={email ?? "Signed-in HR Admin"} readOnly /></div>
                <div className="grid gap-2"><Label htmlFor="pip-start">Start date</Label><Input id="pip-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
                <div className="grid gap-2"><Label htmlFor="pip-duration">Duration (days)</Label><div className="flex gap-2"><Input id="pip-duration" type="number" min={1} max={365} value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))} />{[30, 60, 90].map((days) => <Button key={days} type="button" size="sm" variant={durationDays === days ? "default" : "outline"} onClick={() => setDurationDays(days)}>{days}</Button>)}</div></div>
                <div className="grid gap-2"><Label htmlFor="pip-end">End date</Label><Input id="pip-end" type="date" value={calculateEndDate(startDate, durationDays)} readOnly /></div>
                <div className="grid gap-2"><Label htmlFor="pip-frequency">Review frequency (days)</Label><Input id="pip-frequency" type="number" min={1} max={365} value={reviewFrequencyDays} onChange={(event) => setReviewFrequencyDays(Number(event.target.value))} /></div>
              </div>
            </section>
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Focus and concerns</h3>
              <div className="grid gap-4">
                <div className="grid gap-2"><Label htmlFor="pip-focus">Focus areas</Label><Input id="pip-focus" placeholder="Communication, documentation, delivery" value={focusText} onChange={(event) => setFocusText(event.target.value)} /></div>
                <div className="grid gap-2"><Label htmlFor="pip-concerns">Reason</Label><Textarea id="pip-concerns" rows={3} value={concerns} onChange={(event) => setConcerns(event.target.value)} placeholder="Describe the performance areas to improve." /></div>
                <div className="grid gap-2"><Label htmlFor="pip-support">Support provided</Label><Textarea id="pip-support" rows={2} value={supportProvided} onChange={(event) => setSupportProvided(event.target.value)} placeholder="Weekly 1:1 with manager, review checklist training…" /></div>
                <div className="grid gap-2"><Label htmlFor="pip-consequences">If goals are not met</Label><Textarea id="pip-consequences" rows={2} value={consequences} onChange={(event) => setConsequences(event.target.value)} placeholder="Review for further action as per company policy." /></div>
              </div>
            </section>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Goals and success measures</h3><p className="text-xs text-muted-foreground">At least one complete goal is required before publishing.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setGoals((current) => [...current, blankGoal()])}><Plus className="mr-1 h-4 w-4" />Add goal</Button></div>
              {goals.map((goal, index) => <div key={index} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
                <div className="grid gap-2"><Label>Goal {index + 1}</Label><Input aria-label={`Goal ${index + 1} title`} value={goal.title} onChange={(event) => patchGoal(setGoals, index, "title", event.target.value)} placeholder="Improve report quality" /></div>
                <div className="grid gap-2"><Label>KPI</Label><Input value={goal.kpi} onChange={(event) => patchGoal(setGoals, index, "kpi", event.target.value)} placeholder="Weekly reviews completed" /></div>
                <div className="grid gap-2"><Label>Target</Label><Input value={goal.target} onChange={(event) => patchGoal(setGoals, index, "target", event.target.value)} placeholder="Complete 4 of 4 each week" /></div>
                <div className="grid gap-2"><Label>Weight (%)</Label><Input type="number" min={0} max={100} value={goal.weight} onChange={(event) => patchGoal(setGoals, index, "weight", Number(event.target.value))} /></div>
                <div className="grid gap-2"><Label>Due date</Label><Input type="date" value={goal.dueDate} onChange={(event) => patchGoal(setGoals, index, "dueDate", event.target.value)} /></div>
                <div className="grid gap-2"><Label>Supporting evidence</Label><Input value={goal.evidence} onChange={(event) => patchGoal(setGoals, index, "evidence", event.target.value)} placeholder="Notes or reference link" /></div>
                <div className="grid gap-2 sm:col-span-2"><Label>Description</Label><Textarea rows={2} value={goal.description} onChange={(event) => patchGoal(setGoals, index, "description", event.target.value)} /></div>
                {goals.length > 1 && <div className="sm:col-span-2"><Button type="button" variant="ghost" size="sm" onClick={() => setGoals((current) => current.filter((_, goalIndex) => goalIndex !== index))}>Remove goal</Button></div>}
              </div>)}
            </section>
          </div>
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <p className={`text-xs ${weightsOk ? "text-success" : "text-destructive"}`}>{filledGoals.length ? `Weights total ${weightTotal}%${weightsOk ? "" : " (must be 100%)"}` : "Add a goal to publish"}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button variant="outline" onClick={() => submitCreate(false)} disabled={createMutation.isPending || !employeeId || !concerns.trim() || !weightsOk}>{createMutation.isPending ? "Saving…" : "Save as draft"}</Button>
              <Button onClick={() => submitCreate(true)} disabled={createMutation.isPending || !employeeId || !concerns.trim() || !weightsOk || filledGoals.length === 0}>Publish PIP</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function patchGoal<T extends GoalDraft, K extends keyof GoalDraft>(setGoals: React.Dispatch<React.SetStateAction<T[]>>, index: number, key: K, value: GoalDraft[K]) {
  setGoals((current) => current.map((goal, goalIndex) => goalIndex === index ? { ...goal, [key]: value } : goal));
}

function calculateEndDate(start: string, duration: number) {
  if (!start || !Number.isFinite(duration) || duration < 1) return "";
  const date = new Date(`${start}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + duration - 1);
  return date.toISOString().slice(0, 10);
}

function statusLabel(status: PipStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}