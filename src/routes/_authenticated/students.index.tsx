import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Pencil, Trash2, Eye, Upload, User, QrCode } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { RoleGuard } from "@/components/role-guard";

export const Route = createFileRoute("/_authenticated/students/")({
  head: () => ({ meta: [{ title: "Employees · MySOC Labs Attendance" }] }),
  component: () => (
    <RoleGuard allow={["super_admin", "hr_admin"]} fallbackTo="/me">
      <EmployeesPage />
    </RoleGuard>
  ),
});

type Employee = {
  id: string;
  student_id: string;
  name: string;
  email: string;
  phone: string | null;
  department: string | null;
  designation: string | null;
  joining_date: string | null;
  photo_url: string | null;
  created_at: string;
};

const employeeSchema = z.object({
  name: z.string().trim().min(1, "Name required").max(120),
  email: z.string().trim().email("Valid email required").max(255),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  department: z.string().trim().max(80).optional().or(z.literal("")),
  designation: z.string().trim().max(80).optional().or(z.literal("")),
  joining_date: z.string().trim().optional().or(z.literal("")),
});

async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from("students")
    .select("id, student_id, name, email, phone, department, designation, joining_date, photo_url, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Employee[];
}

async function signedPhotoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from("employee-photos").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

function EmployeesPage() {
  const qc = useQueryClient();
  const { data: employees = [], isLoading } = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState({
    name: "", email: "", phone: "", department: "", designation: "", joining_date: "",
  });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((s) =>
      [s.name, s.student_id, s.email, s.phone ?? "", s.department ?? "", s.designation ?? ""]
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [employees, query]);

  const upsert = useMutation({
    mutationFn: async () => {
      const parsed = employeeSchema.parse(form);
      const payload = {
        name: parsed.name,
        email: parsed.email,
        phone: parsed.phone || null,
        department: parsed.department || null,
        designation: parsed.designation || null,
        joining_date: parsed.joining_date || null,
      };

      let targetId = editing?.id;
      if (editing) {
        const { error } = await supabase.from("students").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("students").insert(payload).select("id").single();
        if (error) throw error;
        targetId = data.id;
      }

      if (photoFile && targetId) {
        const ext = photoFile.name.split(".").pop() || "jpg";
        const path = `${targetId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("employee-photos")
          .upload(path, photoFile, { upsert: true, contentType: photoFile.type });
        if (upErr) throw upErr;
        const { error: updErr } = await supabase.from("students").update({ photo_url: path }).eq("id", targetId);
        if (updErr) throw updErr;
      }

      const { logAudit, notify } = await import("@/lib/audit");
      await logAudit({
        action: editing ? "employee_updated" : "employee_created",
        entity: "employee",
        entity_id: targetId,
        details: { name: payload.name, email: payload.email },
      });
      if (!editing) {
        await notify({ audience: "admins", type: "employee_created", title: "New employee added", message: `${payload.name} (${payload.email})`, link: "/students" });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Employee updated" : "Employee added");
      setOpen(false);
      resetForm();
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (err) => {
      console.error("Add employee failed:", err);
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      toast.error(msg || "Failed");
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("students").delete().eq("id", id);
      if (error) throw error;
      const { logAudit } = await import("@/lib/audit");
      await logAudit({ action: "employee_deleted", entity: "employee", entity_id: id });
    },
    onSuccess: () => {
      toast.success("Employee deleted");
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const resetForm = () => {
    setEditing(null);
    setForm({ name: "", email: "", phone: "", department: "", designation: "", joining_date: "" });
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const openAdd = () => {
    resetForm();
    setOpen(true);
  };
  const openEdit = async (s: Employee) => {
    setEditing(s);
    setForm({
      name: s.name,
      email: s.email,
      phone: s.phone ?? "",
      department: s.department ?? "",
      designation: s.designation ?? "",
      joining_date: s.joining_date ?? "",
    });
    setPhotoFile(null);
    setPhotoPreview(await signedPhotoUrl(s.photo_url));
    setOpen(true);
  };

  const onPickPhoto = (file: File | null) => {
    setPhotoFile(file);
    if (!file) return setPhotoPreview(null);
    const reader = new FileReader();
    reader.onload = (e) => setPhotoPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
          <p className="text-sm text-muted-foreground">Manage employees and their profiles.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/students/bulk-qr"><QrCode className="mr-1 h-4 w-4" /> Bulk QR</Link>
          </Button>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild>
              <Button onClick={openAdd}><Plus className="mr-1 h-4 w-4" /> Add Employee</Button>
            </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle>
              <DialogDescription>
                {editing ? "Update the employee's details." : "A unique Employee ID and QR code are generated automatically."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
                  {photoPreview ? (
                    <img src={photoPreview} alt="Preview" className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)}
                  />
                  <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload className="mr-1 h-4 w-4" /> {photoPreview ? "Change photo" : "Upload photo"}
                  </Button>
                  <p className="mt-1 text-xs text-muted-foreground">PNG or JPG, square works best.</p>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="joining_date">Joining Date</Label>
                  <Input id="joining_date" type="date" value={form.joining_date} onChange={(e) => setForm({ ...form, joining_date: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="department">Department</Label>
                  <Input id="department" placeholder="e.g. Engineering" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="designation">Designation</Label>
                  <Input id="designation" placeholder="e.g. Security Analyst" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => upsert.mutate()} disabled={upsert.isPending}>
                {editing ? "Save changes" : "Add Employee"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, ID, email, phone, department, or designation…"
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No employees found.</TableCell></TableRow>
                ) : (
                  filtered.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="font-mono text-xs">{s.student_id}</TableCell>
                      <TableCell>{s.email}</TableCell>
                      <TableCell>{s.department ?? "—"}</TableCell>
                      <TableCell>{s.designation ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button asChild size="icon" variant="ghost">
                            <Link to="/students/$id" params={{ id: s.id }}><Eye className="h-4 w-4" /></Link>
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => openEdit(s)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete employee?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This permanently removes {s.name} and their attendance records.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => remove.mutate(s.id)}>Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
