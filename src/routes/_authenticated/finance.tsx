import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RoleGuard } from "@/components/role-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Wallet, Plus, TrendingUp, TrendingDown, DollarSign, FileText, Receipt, Users as UsersIcon, Download,
} from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({ meta: [{ title: "Finance · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin", "founder", "finance"]}>
      <FinancePage />
    </RoleGuard>
  ),
});

// ---- shared helpers ----
const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

const EXPENSE_CATEGORIES = [
  { value: "office_rent", label: "Office Rent" },
  { value: "electricity", label: "Electricity" },
  { value: "internet", label: "Internet" },
  { value: "software", label: "Software Licenses" },
  { value: "misc", label: "Miscellaneous" },
];
const REVENUE_SOURCES = [
  { value: "client", label: "Client Payment" },
  { value: "blueteamers", label: "Blueteamers Revenue" },
  { value: "mysoc_labs", label: "MySocLabs Revenue" },
];

const db = supabase as any;

function exportCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return toast.info("No rows to export");
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}-${format(new Date(), "yyyyMMdd")}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function FinancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Wallet className="h-6 w-6 text-primary" /> Finance Panel
        </h1>
        <p className="text-sm text-muted-foreground">Payroll, expenses, revenue, invoices, and reports.</p>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="grid grid-cols-3 sm:grid-cols-6">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard"><DashboardTab /></TabsContent>
        <TabsContent value="payroll"><PayrollTab /></TabsContent>
        <TabsContent value="expenses"><ExpensesTab /></TabsContent>
        <TabsContent value="revenue"><RevenueTab /></TabsContent>
        <TabsContent value="invoices"><InvoicesTab /></TabsContent>
        <TabsContent value="reports"><ReportsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============ DASHBOARD ============
function DashboardTab() {
  const { data: revenues = [] } = useQuery({
    queryKey: ["fin-revenues"],
    queryFn: async () => (await db.from("revenues").select("*")).data ?? [],
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ["fin-expenses"],
    queryFn: async () => (await db.from("expenses").select("*")).data ?? [],
  });
  const { data: payroll = [] } = useQuery({
    queryKey: ["fin-payroll"],
    queryFn: async () => (await db.from("payroll").select("*")).data ?? [],
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ["fin-invoices"],
    queryFn: async () => (await db.from("invoices").select("*")).data ?? [],
  });

  const totalRevenue = revenues.reduce((s: number, r: any) => s + Number(r.amount), 0);
  const totalExpenses = expenses.reduce((s: number, r: any) => s + Number(r.amount), 0)
    + payroll.filter((p: any) => p.status === "paid").reduce((s: number, r: any) => s + Number(r.amount), 0);
  const profit = totalRevenue - totalExpenses;
  const pendingInvoices = invoices.filter((i: any) => i.status === "unpaid").reduce((s: number, r: any) => s + Number(r.amount), 0);
  const pendingPayroll = payroll.filter((p: any) => p.status === "pending");

  const stats = [
    { label: "Total Revenue", value: fmt(totalRevenue), icon: TrendingUp, color: "text-success" },
    { label: "Total Expenses", value: fmt(totalExpenses), icon: TrendingDown, color: "text-destructive" },
    { label: profit >= 0 ? "Profit" : "Loss", value: fmt(Math.abs(profit)), icon: DollarSign, color: profit >= 0 ? "text-success" : "text-destructive" },
    { label: "Pending Payments", value: fmt(pendingInvoices), icon: Receipt, color: "text-warning" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-semibold mt-1">{s.value}</p>
              </div>
              <s.icon className={`h-8 w-8 ${s.color}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><UsersIcon className="h-4 w-4" /> Upcoming Salary Payments</CardTitle></CardHeader>
        <CardContent>
          {pendingPayroll.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending salaries.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Period</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {pendingPayroll.slice(0, 10).map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.employee_name}</TableCell>
                    <TableCell>{format(new Date(p.period_year, p.period_month - 1), "MMM yyyy")}</TableCell>
                    <TableCell className="text-right">{fmt(Number(p.amount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============ PAYROLL ============
function PayrollTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const now = new Date();
  const [form, setForm] = useState({
    employee_name: "", employee_type: "employee", amount: "",
    period_month: now.getMonth() + 1, period_year: now.getFullYear(), notes: "",
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["fin-payroll"],
    queryFn: async () => (await db.from("payroll").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const addM = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("payroll").insert({
        employee_name: form.employee_name,
        employee_type: form.employee_type,
        amount: Number(form.amount),
        period_month: Number(form.period_month),
        period_year: Number(form.period_year),
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Salary record added");
      setOpen(false);
      setForm({ ...form, employee_name: "", amount: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["fin-payroll"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markPaid = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("payroll").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked as paid");
      qc.invalidateQueries({ queryKey: ["fin-payroll"] });
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Payroll Records</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" /> Add Salary</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Salary / Stipend</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>Employee Name</Label>
                <Input value={form.employee_name} onChange={(e) => setForm({ ...form, employee_name: e.target.value })} /></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label>Type</Label>
                  <Select value={form.employee_type} onValueChange={(v) => setForm({ ...form, employee_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee Salary</SelectItem>
                      <SelectItem value="intern">Intern Stipend</SelectItem>
                    </SelectContent>
                  </Select></div>
                <div className="space-y-1"><Label>Amount</Label>
                  <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
                <div className="space-y-1"><Label>Month</Label>
                  <Input type="number" min={1} max={12} value={form.period_month}
                    onChange={(e) => setForm({ ...form, period_month: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label>Year</Label>
                  <Input type="number" value={form.period_year}
                    onChange={(e) => setForm({ ...form, period_year: Number(e.target.value) })} /></div>
              </div>
              <div className="space-y-1"><Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => addM.mutate()} disabled={addM.isPending}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Period</TableHead>
            <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              : rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No records.</TableCell></TableRow>
              : rows.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.employee_name}</TableCell>
                  <TableCell className="capitalize">{p.employee_type}</TableCell>
                  <TableCell>{format(new Date(p.period_year, p.period_month - 1), "MMM yyyy")}</TableCell>
                  <TableCell className="text-right">{fmt(Number(p.amount))}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={p.status === "paid" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}>
                      {p.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {p.status === "pending" && <Button size="sm" variant="outline" onClick={() => markPaid.mutate(p.id)}>Mark Paid</Button>}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ============ EXPENSES ============
function ExpensesTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    category: "office_rent", amount: "", expense_date: format(new Date(), "yyyy-MM-dd"), notes: "",
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["fin-expenses"],
    queryFn: async () => (await db.from("expenses").select("*").order("expense_date", { ascending: false })).data ?? [],
  });

  const addM = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("expenses").insert({
        category: form.category, amount: Number(form.amount),
        expense_date: form.expense_date, notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Expense added");
      setOpen(false);
      setForm({ ...form, amount: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["fin-expenses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const labelOf = (v: string) => EXPENSE_CATEGORIES.find((c) => c.value === v)?.label ?? v;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Expenses</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" /> Add Expense</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Expense</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Amount</Label>
                  <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
                <div className="space-y-1"><Label>Date</Label>
                  <Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => addM.mutate()} disabled={addM.isPending}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Notes</TableHead><TableHead className="text-right">Amount</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No expenses.</TableCell></TableRow>
              : rows.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell>{format(new Date(e.expense_date), "MMM d, yyyy")}</TableCell>
                  <TableCell>{labelOf(e.category)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{e.notes ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmt(Number(e.amount))}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ============ REVENUE ============
function RevenueTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    source: "client", client_name: "", description: "", amount: "",
    revenue_date: format(new Date(), "yyyy-MM-dd"), status: "pending",
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["fin-revenues"],
    queryFn: async () => (await db.from("revenues").select("*").order("revenue_date", { ascending: false })).data ?? [],
  });

  const addM = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("revenues").insert({
        source: form.source, client_name: form.client_name || null, description: form.description || null,
        amount: Number(form.amount), revenue_date: form.revenue_date, status: form.status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Revenue recorded");
      setOpen(false);
      setForm({ ...form, client_name: "", description: "", amount: "" });
      qc.invalidateQueries({ queryKey: ["fin-revenues"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleStatus = useMutation({
    mutationFn: async (r: any) => {
      const { error } = await db.from("revenues").update({ status: r.status === "received" ? "pending" : "received" }).eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fin-revenues"] }),
  });

  const sourceLabel = (v: string) => REVENUE_SOURCES.find((s) => s.value === v)?.label ?? v;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Revenue</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" /> Add Revenue</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Revenue</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>Source</Label>
                <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REVENUE_SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select></div>
              <div className="space-y-1"><Label>Client / Description</Label>
                <Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Amount</Label>
                  <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
                <div className="space-y-1"><Label>Date</Label>
                  <Input type="date" value={form.revenue_date} onChange={(e) => setForm({ ...form, revenue_date: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="received">Received</SelectItem>
                  </SelectContent>
                </Select></div>
            </div>
            <DialogFooter><Button onClick={() => addM.mutate()} disabled={addM.isPending}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Source</TableHead><TableHead>Client</TableHead>
            <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No revenue records.</TableCell></TableRow>
              : rows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>{format(new Date(r.revenue_date), "MMM d, yyyy")}</TableCell>
                  <TableCell>{sourceLabel(r.source)}</TableCell>
                  <TableCell>{r.client_name ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmt(Number(r.amount))}</TableCell>
                  <TableCell>
                    <Badge variant="secondary"
                      className={`cursor-pointer ${r.status === "received" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
                      onClick={() => toggleStatus.mutate(r)}>
                      {r.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ============ INVOICES ============
function InvoicesTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const today = format(new Date(), "yyyy-MM-dd");
  const [form, setForm] = useState({
    invoice_number: `INV-${Date.now()}`, client_name: "", amount: "",
    issue_date: today, due_date: today, notes: "",
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["fin-invoices"],
    queryFn: async () => (await db.from("invoices").select("*").order("issue_date", { ascending: false })).data ?? [],
  });

  const addM = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("invoices").insert({
        invoice_number: form.invoice_number, client_name: form.client_name,
        amount: Number(form.amount), issue_date: form.issue_date, due_date: form.due_date,
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invoice created");
      setOpen(false);
      setForm({ ...form, invoice_number: `INV-${Date.now()}`, client_name: "", amount: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["fin-invoices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async (inv: any) => {
      const { error } = await db.from("invoices").update({ status: inv.status === "paid" ? "unpaid" : "paid" }).eq("id", inv.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fin-invoices"] }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Invoices</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" /> Create Invoice</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Invoice</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Invoice #</Label>
                  <Input value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} /></div>
                <div className="space-y-1"><Label>Amount</Label>
                  <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label>Client Name</Label>
                <Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Issue Date</Label>
                  <Input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></div>
                <div className="space-y-1"><Label>Due Date</Label>
                  <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => addM.mutate()} disabled={addM.isPending}>Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Invoice #</TableHead><TableHead>Client</TableHead><TableHead>Issued</TableHead>
            <TableHead>Due</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No invoices.</TableCell></TableRow>
              : rows.map((i: any) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-sm">{i.invoice_number}</TableCell>
                  <TableCell>{i.client_name}</TableCell>
                  <TableCell>{format(new Date(i.issue_date), "MMM d, yyyy")}</TableCell>
                  <TableCell>{format(new Date(i.due_date), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">{fmt(Number(i.amount))}</TableCell>
                  <TableCell>
                    <Badge variant="secondary"
                      className={`cursor-pointer ${i.status === "paid" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
                      onClick={() => toggle.mutate(i)}>
                      {i.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ============ REPORTS ============
function ReportsTab() {
  const { data: revenues = [] } = useQuery({
    queryKey: ["fin-revenues"], queryFn: async () => (await db.from("revenues").select("*")).data ?? [],
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ["fin-expenses"], queryFn: async () => (await db.from("expenses").select("*")).data ?? [],
  });
  const { data: payroll = [] } = useQuery({
    queryKey: ["fin-payroll"], queryFn: async () => (await db.from("payroll").select("*")).data ?? [],
  });

  const monthly = useMemo(() => {
    const map = new Map<string, { revenue: number; expense: number }>();
    for (const r of revenues as any[]) {
      const k = format(new Date(r.revenue_date), "yyyy-MM");
      const cur = map.get(k) ?? { revenue: 0, expense: 0 };
      cur.revenue += Number(r.amount);
      map.set(k, cur);
    }
    for (const e of expenses as any[]) {
      const k = format(new Date(e.expense_date), "yyyy-MM");
      const cur = map.get(k) ?? { revenue: 0, expense: 0 };
      cur.expense += Number(e.amount);
      map.set(k, cur);
    }
    for (const p of payroll as any[]) {
      if (p.status !== "paid") continue;
      const k = `${p.period_year}-${String(p.period_month).padStart(2, "0")}`;
      const cur = map.get(k) ?? { revenue: 0, expense: 0 };
      cur.expense += Number(p.amount);
      map.set(k, cur);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a))
      .map(([month, v]) => ({ month, ...v, profit: v.revenue - v.expense }));
  }, [revenues, expenses, payroll]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => exportCsv("revenue", revenues as any[])}>
          <Download className="mr-1 h-4 w-4" /> Revenue CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => exportCsv("expenses", expenses as any[])}>
          <Download className="mr-1 h-4 w-4" /> Expenses CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => exportCsv("payroll", payroll as any[])}>
          <Download className="mr-1 h-4 w-4" /> Payroll CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => exportCsv("profit-loss", monthly)}>
          <Download className="mr-1 h-4 w-4" /> P&amp;L CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <FileText className="mr-1 h-4 w-4" /> Print / PDF
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Monthly Profit &amp; Loss</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Expenses</TableHead>
              <TableHead className="text-right">Profit / Loss</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {monthly.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No data yet.</TableCell></TableRow>
                : monthly.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell>{format(new Date(`${m.month}-01`), "MMM yyyy")}</TableCell>
                    <TableCell className="text-right text-success">{fmt(m.revenue)}</TableCell>
                    <TableCell className="text-right text-destructive">{fmt(m.expense)}</TableCell>
                    <TableCell className={`text-right font-medium ${m.profit >= 0 ? "text-success" : "text-destructive"}`}>
                      {fmt(m.profit)}
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
