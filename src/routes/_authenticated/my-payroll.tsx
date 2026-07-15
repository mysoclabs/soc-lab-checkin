import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Wallet, IndianRupee } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/use-role";
import { RoleGuard } from "@/components/role-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/my-payroll")({
  head: () => ({ meta: [{ title: "My Payroll · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["employee", "hr_admin", "super_admin"]} fallbackTo="/">
      <MyPayrollPage />
    </RoleGuard>
  ),
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function statusBadge(status: string) {
  const tone = status === "paid" ? "bg-success/15 text-success" : "bg-warning/15 text-warning";
  return <Badge variant="secondary" className={cn("capitalize", tone)}>{status}</Badge>;
}

function MyPayrollPage() {
  const { email } = useUserRole();

  const { data: employee } = useQuery({
    queryKey: ["my-employee", email],
    enabled: !!email,
    queryFn: async () => {
      const { data } = await supabase.from("students").select("id, name").eq("email", email!).maybeSingle();
      return data;
    },
  });

  const { data: payroll = [], isLoading } = useQuery({
    queryKey: ["my-payroll", employee?.id],
    enabled: !!employee?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll")
        .select("*")
        .eq("employee_id", employee!.id)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const totalPaid = payroll.filter((p: { status: string }) => p.status === "paid").reduce((s: number, p: { amount: number }) => s + p.amount, 0);
  const totalPending = payroll.filter((p: { status: string }) => p.status !== "paid").reduce((s: number, p: { amount: number }) => s + p.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Wallet className="h-6 w-6 text-primary" /> My Payroll
        </h1>
        <p className="text-sm text-muted-foreground">View your salary and payment history.</p>
      </div>

      {!employee ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Your email isn't linked to an employee record yet. Ask an admin to add you.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Total Paid</p>
                <p className="mt-2 flex items-center gap-1 text-3xl font-semibold text-success">
                  <IndianRupee className="h-6 w-6" />{totalPaid.toLocaleString("en-IN")}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="mt-2 flex items-center gap-1 text-3xl font-semibold text-warning">
                  <IndianRupee className="h-6 w-6" />{totalPending.toLocaleString("en-IN")}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Payment History</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Paid On</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : !payroll.length ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No payroll records yet.</TableCell></TableRow>
                  ) : payroll.map((p: { id: string; period_month: number; period_year: number; employee_type: string; amount: number; status: string; paid_at: string | null; notes: string | null }) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{MONTHS[p.period_month - 1]} {p.period_year}</TableCell>
                      <TableCell className="capitalize">{p.employee_type}</TableCell>
                      <TableCell className="flex items-center gap-0.5">
                        <IndianRupee className="h-3.5 w-3.5 text-muted-foreground" />
                        {p.amount.toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell>{statusBadge(p.status)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {p.paid_at ? format(new Date(p.paid_at), "PP") : "—"}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{p.notes ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
