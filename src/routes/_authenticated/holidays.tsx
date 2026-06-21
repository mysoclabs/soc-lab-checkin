import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { RoleGuard } from "@/components/role-guard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/holidays")({
  head: () => ({ meta: [{ title: "Holidays · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin", "hr_admin"]} fallbackTo="/me">
      <HolidaysPage />
    </RoleGuard>
  ),
});

type Holiday = { id: string; name: string; date: string; type: "public" | "company"; description: string | null };

function HolidaysPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [form, setForm] = useState({ name: "", date: format(new Date(), "yyyy-MM-dd"), type: "public" as "public" | "company", description: "" });

  const { data: holidays = [] } = useQuery({
    queryKey: ["holidays"],
    queryFn: async () => {
      const { data, error } = await supabase.from("holidays").select("*").order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Holiday[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        const { error } = await supabase.from("holidays").update(form).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("holidays").insert(form);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Holiday updated" : "Holiday added");
      qc.invalidateQueries({ queryKey: ["holidays"] });
      setOpen(false);
      setEditing(null);
      setForm({ name: "", date: format(new Date(), "yyyy-MM-dd"), type: "public", description: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("holidays").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Holiday deleted");
      qc.invalidateQueries({ queryKey: ["holidays"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const holidayDates = useMemo(() => holidays.map((h) => parseISO(h.date)), [holidays]);
  const companyDates = useMemo(() => holidays.filter((h) => h.type === "company").map((h) => parseISO(h.date)), [holidays]);

  const openEdit = (h: Holiday) => {
    setEditing(h);
    setForm({ name: h.name, date: h.date, type: h.type, description: h.description ?? "" });
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Holidays</h1>
          <p className="text-sm text-muted-foreground">Manage public and company holidays.</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditing(null); setForm({ name: "", date: format(new Date(), "yyyy-MM-dd"), type: "public", description: "" }); }}>
              <Plus className="mr-2 h-4 w-4" /> Add Holiday
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Holiday" : "Add Holiday"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="New Year's Day" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v: "public" | "company") => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public</SelectItem>
                      <SelectItem value="company">Company</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.name || !form.date || saveMutation.isPending}>
                {editing ? "Save changes" : "Add holiday"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">Holiday list</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No holidays yet.</TableCell></TableRow>
                ) : holidays.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>
                      <div className="font-medium">{h.name}</div>
                      {h.description && <div className="text-xs text-muted-foreground">{h.description}</div>}
                    </TableCell>
                    <TableCell>{format(parseISO(h.date), "MMM d, yyyy")}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={h.type === "public" ? "bg-primary/15 text-primary" : "bg-warning/15 text-warning"}>
                        {h.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(h)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete holiday?")) deleteMutation.mutate(h.id); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4" /> Calendar</CardTitle>
          </CardHeader>
          <CardContent>
            <Calendar
              mode="single"
              modifiers={{ public: holidayDates, company: companyDates }}
              modifiersClassNames={{
                public: "bg-primary/20 text-primary font-semibold",
                company: "bg-warning/20 text-warning font-semibold",
              }}
              className={cn("p-3 pointer-events-auto")}
            />
            <div className="mt-4 flex gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-primary/30" /> Public</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-warning/30" /> Company</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
