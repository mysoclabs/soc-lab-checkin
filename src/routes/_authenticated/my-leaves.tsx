import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Loader2, Plus, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/use-role";
import { RoleGuard } from "@/components/role-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/my-leaves")({
  head: () => ({ meta: [{ title: "My Leaves · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["employee", "hr_admin", "super_admin"]} fallbackTo="/">
      <MyLeavesPage />
    </RoleGuard>
  ),
});

const LEAVE_TYPES = [
  { value: "casual", label: "Casual Leave" },
  { value: "sick", label: "Sick Leave" },
  { value: "emergency", label: "Emergency Leave" },
  { value: "wfh", label: "Work From Home" },
] as const;

const TYPE_LABEL: Record<string, string> = Object.fromEntries(LEAVE_TYPES.map((t) => [t.value, t.label]));

function statusBadge(status: string) {
  const tone =
    status === "approved" ? "bg-success/15 text-success" :
    status === "rejected" ? "bg-destructive/15 text-destructive" :
    "bg-warning/15 text-warning";
  return <Badge variant="secondary" className={cn("capitalize", tone)}>{status}</Badge>;
}

function MyLeavesPage() {
  const { email, userId } = useUserRole();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<string>("casual");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [reason, setReason] = useState("");

  const { data: employee } = useQuery({
    queryKey: ["my-employee", email],
    enabled: !!email,
    queryFn: async () => {
      const { data } = await supabase.from("students").select("id, name, email").eq("email", email!).maybeSingle();
      return data;
    },
  });

  const { data: leaves, isLoading } = useQuery({
    queryKey: ["my-leaves", employee?.id],
    enabled: !!employee?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*")
        .eq("employee_id", employee!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!employee?.id || !userId) throw new Error("Employee record not linked to your account.");
      if (!startDate || !endDate) throw new Error("Pick start and end dates.");
      if (endDate < startDate) throw new Error("End date must be on or after start date.");
      if (reason.trim().length < 3) throw new Error("Please provide a reason.");
      const { data: inserted, error } = await supabase.from("leave_requests").insert({
        employee_id: employee.id,
        user_id: userId,
        leave_type: leaveType as "casual" | "sick" | "emergency" | "wfh",
        start_date: format(startDate, "yyyy-MM-dd"),
        end_date: format(endDate, "yyyy-MM-dd"),
        reason: reason.trim(),
      }).select("id").single();
      if (error) throw error;
      const { logAudit, notify } = await import("@/lib/audit");
      await logAudit({ action: "leave_submitted", entity: "leave_request", entity_id: inserted?.id, details: { type: leaveType, start: format(startDate, "yyyy-MM-dd"), end: format(endDate, "yyyy-MM-dd") } });
      await notify({ audience: "admins", type: "leave_submitted", title: "New leave request", message: `${employee.name} requested ${leaveType} leave`, link: "/leaves" });
    },
    onSuccess: () => {
      toast.success("Leave request submitted");
      setOpen(false);
      setStartDate(undefined); setEndDate(undefined); setReason(""); setLeaveType("casual");
      qc.invalidateQueries({ queryKey: ["my-leaves"] });
      qc.invalidateQueries({ queryKey: ["leave-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const counts = {
    pending: leaves?.filter((l) => l.status === "pending").length ?? 0,
    approved: leaves?.filter((l) => l.status === "approved").length ?? 0,
    rejected: leaves?.filter((l) => l.status === "rejected").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <CalendarDays className="h-6 w-6 text-primary" /> My Leaves
          </h1>
          <p className="text-sm text-muted-foreground">Request leave and track approval status.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={!employee}><Plus className="mr-2 h-4 w-4" /> Request Leave</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Leave Request</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Leave Type</label>
                <Select value={leaveType} onValueChange={setLeaveType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEAVE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Start Date</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {startDate ? format(startDate, "PP") : "Pick"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus className="pointer-events-auto p-3" />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">End Date</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !endDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {endDate ? format(endDate, "PP") : "Pick"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus className="pointer-events-auto p-3" />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason</label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="Brief explanation…" maxLength={500} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
                {submitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!employee && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          Your email isn't linked to an employee record yet. Ask an admin to add you.
        </CardContent></Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-6"><p className="text-sm text-muted-foreground">Pending</p><p className="mt-2 text-3xl font-semibold text-warning">{counts.pending}</p></CardContent></Card>
        <Card><CardContent className="p-6"><p className="text-sm text-muted-foreground">Approved</p><p className="mt-2 text-3xl font-semibold text-success">{counts.approved}</p></CardContent></Card>
        <Card><CardContent className="p-6"><p className="text-sm text-muted-foreground">Rejected</p><p className="mt-2 text-3xl font-semibold text-destructive">{counts.rejected}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">My Leave History</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Admin Comment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !leaves?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No leave requests yet.</TableCell></TableRow>
              ) : leaves.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{TYPE_LABEL[l.leave_type]}</TableCell>
                  <TableCell>{format(new Date(l.start_date), "PP")}</TableCell>
                  <TableCell>{format(new Date(l.end_date), "PP")}</TableCell>
                  <TableCell className="max-w-xs truncate">{l.reason}</TableCell>
                  <TableCell>{statusBadge(l.status)}</TableCell>
                  <TableCell className="max-w-xs text-sm text-muted-foreground">{l.admin_comment ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
