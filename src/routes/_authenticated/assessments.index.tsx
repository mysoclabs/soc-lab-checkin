import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus } from "lucide-react";
import { RoleGuard } from "@/components/role-guard";
import { adb, fmtDuration, type Assessment } from "@/lib/assessments-db";
import { effectiveStatus } from "@/lib/assessment-grading";
import { logAudit } from "@/lib/audit";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/assessments/")({
  head: () => ({ meta: [{ title: "Assessments · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin"]} fallbackTo="/me">
      <AssessmentsPage />
    </RoleGuard>
  ),
});

const statusClass: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-success/15 text-success",
  completed: "bg-primary/15 text-primary",
  expired: "bg-destructive/15 text-destructive",
};

function AssessmentsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["assessments-admin"],
    queryFn: async () => {
      const [a, q, asg, at, logs] = await Promise.all([
        adb.from("assessments").select("*").order("created_at", { ascending: false }),
        adb.from("assessment_questions").select("assessment_id"),
        adb.from("assessment_assignments").select("assessment_id"),
        adb.from("assessment_attempts").select("assessment_id,status,percentage,time_taken_seconds"),
        adb.from("audit_logs").select("id,action,user_name,details,created_at").eq("entity", "assessment").order("created_at", { ascending: false }).limit(10),
      ]);
      if (a.error) throw a.error;
      return {
        assessments: (a.data ?? []) as Assessment[],
        questions: q.data ?? [], assignments: asg.data ?? [], attempts: at.data ?? [], logs: logs.data ?? [],
      };
    },
  });

  const rows = useMemo(() => {
    if (!data) return [];
    return data.assessments.map((a) => {
      const qn = data.questions.filter((x: any) => x.assessment_id === a.id).length;
      const assigned = data.assignments.filter((x: any) => x.assessment_id === a.id).length;
      const done = data.attempts.filter((x: any) => x.assessment_id === a.id && x.status === "submitted");
      const avg = done.length ? done.reduce((s: number, x: any) => s + Number(x.percentage ?? 0), 0) / done.length : null;
      return { a, qn, assigned, completed: done.length, avg, status: effectiveStatus(a) };
    });
  }, [data]);

  const stats = useMemo(() => {
    const submitted = (data?.attempts ?? []).filter((x: any) => x.status === "submitted");
    const assigned = data?.assignments.length ?? 0;
    return {
      total: rows.length,
      active: rows.filter((r) => r.status === "published").length,
      draft: rows.filter((r) => r.status === "draft").length,
      assigned, completed: submitted.length, pending: Math.max(0, assigned - submitted.length),
      avgScore: submitted.length ? (submitted.reduce((s: number, x: any) => s + Number(x.percentage ?? 0), 0) / submitted.length).toFixed(1) + "%" : "—",
      avgTime: submitted.length ? fmtDuration(Math.round(submitted.reduce((s: number, x: any) => s + (x.time_taken_seconds ?? 0), 0) / submitted.length)) : "—",
    };
  }, [rows, data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["assessments-admin"] });

  const create = useMutation({
    mutationFn: async () => {
      const { data: u } = await adb.auth.getUser();
      const { data, error } = await adb.from("assessments").insert({ title: "Untitled Assessment", created_by: u.user?.id }).select("id").single();
      if (error) throw error;
      await logAudit({ action: "Assessment Created", entity: "assessment", entity_id: data.id });
      return data.id as string;
    },
    onSuccess: (id) => navigate({ to: "/assessments/$id/edit", params: { id } }),
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicate = useMutation({
    mutationFn: async (a: Assessment) => {
      const { id: _id, created_at: _c, published_at: _p, ...rest } = a as any;
      const { data: n, error } = await adb.from("assessments").insert({ ...rest, title: `${a.title} (Copy)`, status: "draft" }).select("id").single();
      if (error) throw error;
      const { data: qs } = await adb.from("assessment_questions").select("*").eq("assessment_id", a.id);
      if (qs?.length) {
        await adb.from("assessment_questions").insert(qs.map(({ id: _i, created_at: _x, updated_at: _y, ...q }: any) => ({ ...q, assessment_id: n.id })));
      }
    },
    onSuccess: () => { toast.success("Duplicated"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await adb.from("assessments").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "Assessment Deleted", entity: "assessment", entity_id: id });
    },
    onSuccess: () => { toast.success("Deleted"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: any = { status };
      if (status === "published") patch.published_at = new Date().toISOString();
      const { error } = await adb.from("assessments").update(patch).eq("id", id);
      if (error) throw error;
      await logAudit({ action: status === "published" ? "Assessment Published" : "Assessment Closed", entity: "assessment", entity_id: id });
    },
    onSuccess: () => { toast.success("Status updated"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const tiles = [
    ["Total Assessments", stats.total], ["Active", stats.active], ["Drafts", stats.draft], ["Employees Assigned", stats.assigned],
    ["Completed", stats.completed], ["Pending", stats.pending], ["Average Score", stats.avgScore], ["Avg. Completion Time", stats.avgTime],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Assessments</h1>
          <p className="text-sm text-muted-foreground">Create quizzes, assign them to employees and review performance.</p>
        </div>
        <Button onClick={() => create.mutate()} disabled={create.isPending}><Plus className="mr-1 h-4 w-4" />New Assessment</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, val]) => (
          <Card key={label}><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{val}</p>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">All Assessments</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>Department</TableHead><TableHead>Questions</TableHead><TableHead>Duration</TableHead>
              <TableHead>Assigned</TableHead><TableHead>Completed</TableHead><TableHead>Avg. Score</TableHead><TableHead>Status</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No assessments yet. Create your first one.</TableCell></TableRow>}
              {rows.map(({ a, qn, assigned, completed, avg, status }) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.title}</TableCell>
                  <TableCell>{a.department || "All"}</TableCell>
                  <TableCell>{qn}</TableCell>
                  <TableCell>{a.duration_minutes} min</TableCell>
                  <TableCell>{assigned}</TableCell>
                  <TableCell>{completed}</TableCell>
                  <TableCell>{avg == null ? "—" : `${avg.toFixed(1)}%`}</TableCell>
                  <TableCell><Badge variant="secondary" className={statusClass[status]}>{status[0].toUpperCase() + status.slice(1)}</Badge></TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild><Link to="/assessments/$id/edit" params={{ id: a.id }} search={{ step: 5 }}>View</Link></DropdownMenuItem>
                        <DropdownMenuItem asChild><Link to="/assessments/$id/edit" params={{ id: a.id }} search={{ step: 1 }}>Edit</Link></DropdownMenuItem>
                        <DropdownMenuItem onClick={() => duplicate.mutate(a)}>Duplicate</DropdownMenuItem>
                        {a.status === "draft" && <DropdownMenuItem asChild><Link to="/assessments/$id/edit" params={{ id: a.id }} search={{ step: 5 }}>Publish</Link></DropdownMenuItem>}
                        {a.status === "published" && <DropdownMenuItem onClick={() => setStatus.mutate({ id: a.id, status: "completed" })}>Mark Completed</DropdownMenuItem>}
                        <DropdownMenuItem asChild><Link to="/assessments/$id/results" params={{ id: a.id }}>View Results</Link></DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => { if (confirm(`Delete "${a.title}"? All results will be removed.`)) remove.mutate(a.id); }}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
        <CardContent>
          {(data?.logs ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : (
            <ul className="space-y-2 text-sm">
              {data!.logs.map((l: any) => (
                <li key={l.id} className="flex justify-between gap-3">
                  <span><span className="font-medium">{l.action}</span>{l.details?.title ? ` · ${l.details.title}` : ""} <span className="text-muted-foreground">by {l.user_name ?? "system"}</span></span>
                  <span className="shrink-0 text-muted-foreground">{format(new Date(l.created_at), "dd MMM, HH:mm")}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
