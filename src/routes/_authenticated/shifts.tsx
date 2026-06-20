import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock, Pencil, Plus, Trash2, UserCog } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { RoleGuard } from "@/components/role-guard";

export const Route = createFileRoute("/_authenticated/shifts")({
  head: () => ({ meta: [{ title: "Shifts · MySOC Labs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin", "hr_admin"]} fallbackTo="/me">
      <ShiftsPage />
    </RoleGuard>
  ),
});

type Shift = { id: string; name: string; start_time: string; end_time: string; late_cutoff_minutes: number; is_default: boolean };
type Employee = { id: string; name: string; student_id: string };
type EmployeeShift = { id: string; employee_id: string; shift_id: string; effective_from: string; shifts: Shift | null; students: Employee | null };

function ShiftsPage() {
  const qc = useQueryClient();
  const [shiftOpen, setShiftOpen] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [shiftForm, setShiftForm] = useState({ name: "", start_time: "09:30", end_time: "18:30", late_cutoff_minutes: 0 });

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({ employee_id: "", shift_id: "", effective_from: format(new Date(), "yyyy-MM-dd") });

  const { data: shifts = [] } = useQuery({
    queryKey: ["shifts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("shifts").select("*").order("start_time");
      if (error) throw error;
      return (data ?? []) as Shift[];
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["students-list"],
    queryFn: async () => {
      const { data } = await supabase.from("students").select("id, name, student_id").order("name");
      return (data ?? []) as Employee[];
    },
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ["employee-shifts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_shifts")
        .select("id, employee_id, shift_id, effective_from, shifts(*), students:employee_id(id, name, student_id)")
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as EmployeeShift[];
    },
  });

  const saveShift = useMutation({
    mutationFn: async () => {
      if (editing) {
        const { error } = await supabase.from("shifts").update(shiftForm).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shifts").insert(shiftForm);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Shift updated" : "Shift created");
      qc.invalidateQueries({ queryKey: ["shifts"] });
      setShiftOpen(false);
      setEditing(null);
      setShiftForm({ name: "", start_time: "09:30", end_time: "18:30", late_cutoff_minutes: 0 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteShift = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shifts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Shift deleted"); qc.invalidateQueries({ queryKey: ["shifts"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignShift = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("employee_shifts").insert(assignForm);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Shift assigned");
      qc.invalidateQueries({ queryKey: ["employee-shifts"] });
      setAssignOpen(false);
      setAssignForm({ employee_id: "", shift_id: "", effective_from: format(new Date(), "yyyy-MM-dd") });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeAssignment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_shifts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Assignment removed"); qc.invalidateQueries({ queryKey: ["employee-shifts"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = (s: Shift) => {
    setEditing(s);
    setShiftForm({ name: s.name, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5), late_cutoff_minutes: s.late_cutoff_minutes });
    setShiftOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shift Management</h1>
        <p className="text-sm text-muted-foreground">Define shifts and assign them to employees. Late entries use the assigned shift's start time.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" /> Shifts</CardTitle>
          <Dialog open={shiftOpen} onOpenChange={(v) => { setShiftOpen(v); if (!v) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => { setEditing(null); setShiftForm({ name: "", start_time: "09:30", end_time: "18:30", late_cutoff_minutes: 0 }); }}>
                <Plus className="mr-2 h-4 w-4" /> New Shift
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "Edit shift" : "New shift"}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={shiftForm.name} onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })} placeholder="Night shift" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Start time</Label><Input type="time" value={shiftForm.start_time} onChange={(e) => setShiftForm({ ...shiftForm, start_time: e.target.value })} /></div>
                  <div className="space-y-2"><Label>End time</Label><Input type="time" value={shiftForm.end_time} onChange={(e) => setShiftForm({ ...shiftForm, end_time: e.target.value })} /></div>
                </div>
                <div className="space-y-2">
                  <Label>Late grace (minutes)</Label>
                  <Input type="number" min={0} value={shiftForm.late_cutoff_minutes} onChange={(e) => setShiftForm({ ...shiftForm, late_cutoff_minutes: Number(e.target.value) })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setShiftOpen(false)}>Cancel</Button>
                <Button onClick={() => saveShift.mutate()} disabled={!shiftForm.name || saveShift.isPending}>{editing ? "Save" : "Create"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Timing</TableHead>
                <TableHead>Grace (min)</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {s.name}
                      {s.is_default && <Badge variant="secondary" className="bg-primary/15 text-primary">Default</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>{s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}</TableCell>
                  <TableCell>{s.late_cutoff_minutes}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button>
                    {!s.is_default && (
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete shift?")) deleteShift.mutate(s.id); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><UserCog className="h-4 w-4" /> Employee Shift Assignments</CardTitle>
          <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="secondary"><Plus className="mr-2 h-4 w-4" /> Assign Shift</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Assign shift</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <Select value={assignForm.employee_id} onValueChange={(v) => setAssignForm({ ...assignForm, employee_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                    <SelectContent>
                      {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} ({e.student_id})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Shift</Label>
                  <Select value={assignForm.shift_id} onValueChange={(v) => setAssignForm({ ...assignForm, shift_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                    <SelectContent>
                      {shifts.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.start_time.slice(0,5)}–{s.end_time.slice(0,5)})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Effective from</Label>
                  <Input type="date" value={assignForm.effective_from} onChange={(e) => setAssignForm({ ...assignForm, effective_from: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAssignOpen(false)}>Cancel</Button>
                <Button onClick={() => assignShift.mutate()} disabled={!assignForm.employee_id || !assignForm.shift_id || assignShift.isPending}>Assign</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Effective From</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No assignments yet.</TableCell></TableRow>
              ) : assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.students?.name}</div>
                    <div className="text-xs text-muted-foreground">{a.students?.student_id}</div>
                  </TableCell>
                  <TableCell>
                    {a.shifts?.name}{" "}
                    <span className="text-xs text-muted-foreground">({a.shifts?.start_time.slice(0,5)}–{a.shifts?.end_time.slice(0,5)})</span>
                  </TableCell>
                  <TableCell>{format(new Date(a.effective_from), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("Remove assignment?")) removeAssignment.mutate(a.id); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
