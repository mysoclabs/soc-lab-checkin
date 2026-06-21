import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format, eachDayOfInterval, parseISO, isWeekend } from "date-fns";
import { CalendarDays, Check, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { RoleGuard } from "@/components/role-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { logAudit, notify } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/leaves")({
  head: () => ({ meta: [{ title: "Leave Management · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin", "hr_admin"]} fallbackTo="/me">
      <LeavesAdminPage />
    </RoleGuard>
  ),
});

type LeaveRow = {
  id: string;
  employee_id: string;
  leave_type: "casual" | "sick" | "emergency" | "wfh";
  start_date: string;
  end_date: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  admin_comment: string | null;
  reviewed_at: string | null;
  created_at: string;
  students: { name: string; student_id: string; department: string | null } | null;
};

const TYPE_LABEL: Record<string, string> = {
  casual: "Casual Leave",
  sick: "Sick Leave",
  emergency: "Emergency Leave",
  wfh: "Work From Home",
};

function statusBadge(status: string) {
  const tone =
    status === "approved" ? "bg-success/15 text-success" :
    status === "rejected" ? "bg-destructive/15 text-destructive" :
    "bg-warning/15 text-warning";
  return <Badge variant="secondary" className={cn("capitalize", tone)}>{status}</Badge>;
}

function LeavesAdminPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [reviewTarget, setReviewTarget] = useState<{ row: LeaveRow; action: "approved" | "rejected" } | null>(null);
  const [comment, setComment] = useState("");

  const { data: leaves, isLoading } = useQuery({
    queryKey: ["all-leaves"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*, students:employee_id(name, student_id, department)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LeaveRow[];
    },
    refetchInterval: 20000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (leaves ?? []).filter((l) => {
      if (filterStatus !== "all" && l.status !== filterStatus) return false;
      if (!q) return true;
      return (
        l.students?.name?.toLowerCase().includes(q) ||
        l.students?.student_id?.toLowerCase().includes(q) ||
        false
      );
    });
  }, [leaves, search, filterStatus]);

  const counts = {
    total: leaves?.length ?? 0,
    pending: leaves?.filter((l) => l.status === "pending").length ?? 0,
    approved: leaves?.filter((l) => l.status === "approved").length ?? 0,
    rejected: leaves?.filter((l) => l.status === "rejected").length ?? 0,
  };

  // Calendar: dates with approved leaves
  const approvedDates = useMemo(() => {
    const set = new Set<string>();
    (leaves ?? []).filter((l) => l.status === "approved").forEach((l) => {
      eachDayOfInterval({ start: parseISO(l.start_date), end: parseISO(l.end_date) })
        .forEach((d) => set.add(format(d, "yyyy-MM-dd")));
    });
    return Array.from(set).map((s) => parseISO(s));
  }, [leaves]);

  const pendingDates = useMemo(() => {
    const set = new Set<string>();
    (leaves ?? []).filter((l) => l.status === "pending").forEach((l) => {
      eachDayOfInterval({ start: parseISO(l.start_date), end: parseISO(l.end_date) })
        .forEach((d) => set.add(format(d, "yyyy-MM-dd")));
    });
    return Array.from(set).map((s) => parseISO(s));
  }, [leaves]);

  const reviewMutation = useMutation({
    mutationFn: async () => {
      if (!reviewTarget) return;
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("leave_requests")
        .update({
          status: reviewTarget.action,
          admin_comment: comment.trim() || null,
          reviewed_by: u.user?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", reviewTarget.row.id);
      if (error) throw error;

      const row = reviewTarget.row;
      await logAudit({
        action: `leave_${reviewTarget.action}`,
        entity: "leave_request",
        entity_id: row.id,
        details: { employee: row.students?.name, type: row.leave_type, dates: `${row.start_date} → ${row.end_date}`, comment: comment.trim() || null },
      });
      // Look up employee's user_id for notification
      const { data: lr } = await supabase.from("leave_requests").select("user_id").eq("id", row.id).maybeSingle();
      if (lr?.user_id) {
        await notify({
          audience: "user",
          user_id: lr.user_id,
          type: `leave_${reviewTarget.action}`,
          title: `Leave ${reviewTarget.action}`,
          message: `${TYPE_LABEL[row.leave_type]} (${row.start_date} → ${row.end_date})${comment.trim() ? ` — ${comment.trim()}` : ""}`,
          link: "/my-leaves",
        });
      }
    },
    onSuccess: () => {
      toast.success(`Leave ${reviewTarget?.action}`);
      setReviewTarget(null);
      setComment("");
      qc.invalidateQueries({ queryKey: ["all-leaves"] });
      qc.invalidateQueries({ queryKey: ["leave-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CalendarDays className="h-6 w-6 text-primary" /> Leave Management
        </h1>
        <p className="text-sm text-muted-foreground">Review and approve employee leave requests.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card><CardContent className="p-6"><p className="text-sm text-muted-foreground">Total Requests</p><p className="mt-2 text-3xl font-semibold">{counts.total}</p></CardContent></Card>
        <Card><CardContent className="p-6"><p className="text-sm text-muted-foreground">Pending</p><p className="mt-2 text-3xl font-semibold text-warning">{counts.pending}</p></CardContent></Card>
        <Card><CardContent className="p-6"><p className="text-sm text-muted-foreground">Approved</p><p className="mt-2 text-3xl font-semibold text-success">{counts.approved}</p></CardContent></Card>
        <Card><CardContent className="p-6"><p className="text-sm text-muted-foreground">Rejected</p><p className="mt-2 text-3xl font-semibold text-destructive">{counts.rejected}</p></CardContent></Card>
      </div>

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <Input placeholder="Search by employee name or ID…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : !filtered.length ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No requests match.</TableCell></TableRow>
                  ) : filtered.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <div className="font-medium">{l.students?.name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground font-mono">{l.students?.student_id}</div>
                      </TableCell>
                      <TableCell>{TYPE_LABEL[l.leave_type]}</TableCell>
                      <TableCell>{format(new Date(l.start_date), "PP")}</TableCell>
                      <TableCell>{format(new Date(l.end_date), "PP")}</TableCell>
                      <TableCell className="max-w-xs truncate" title={l.reason}>{l.reason}</TableCell>
                      <TableCell>{statusBadge(l.status)}</TableCell>
                      <TableCell className="text-right">
                        {l.status === "pending" ? (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" className="text-success hover:text-success" onClick={() => { setReviewTarget({ row: l, action: "approved" }); setComment(""); }}>
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => { setReviewTarget({ row: l, action: "rejected" }); setComment(""); }}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{l.admin_comment ?? "—"}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Leave Calendar</CardTitle>
              <div className="flex flex-wrap gap-3 pt-2 text-xs">
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-success/30 border border-success" /> Approved leave</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-warning/30 border border-warning" /> Pending leave</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-muted border border-border" /> Weekend</span>
              </div>
            </CardHeader>
            <CardContent>
              <Calendar
                mode="multiple"
                selected={approvedDates}
                onSelect={() => { /* read-only */ }}
                modifiers={{ approved: approvedDates, pending: pendingDates, weekend: (d) => isWeekend(d) }}
                modifiersClassNames={{
                  approved: "bg-success/25 text-success-foreground rounded",
                  pending: "bg-warning/25 rounded",
                  weekend: "text-muted-foreground",
                }}
                className="pointer-events-auto"
                numberOfMonths={2}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!reviewTarget} onOpenChange={(o) => !o && setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewTarget?.action === "approved" ? "Approve" : "Reject"} leave request
            </DialogTitle>
          </DialogHeader>
          {reviewTarget && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-border p-3">
                <p><span className="text-muted-foreground">Employee:</span> {reviewTarget.row.students?.name}</p>
                <p><span className="text-muted-foreground">Type:</span> {TYPE_LABEL[reviewTarget.row.leave_type]}</p>
                <p><span className="text-muted-foreground">Dates:</span> {format(new Date(reviewTarget.row.start_date), "PP")} → {format(new Date(reviewTarget.row.end_date), "PP")}</p>
                <p className="mt-1"><span className="text-muted-foreground">Reason:</span> {reviewTarget.row.reason}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Comment (optional)</label>
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={500} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewTarget(null)}>Cancel</Button>
            <Button onClick={() => reviewMutation.mutate()} disabled={reviewMutation.isPending}>
              {reviewMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm {reviewTarget?.action === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
