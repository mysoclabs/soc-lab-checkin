import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, CalendarClock } from "lucide-react";
import { RoleGuard } from "@/components/role-guard";
import { useUserRole, ROLE_LABELS } from "@/hooks/use-role";

export const Route = createFileRoute("/_authenticated/me")({
  head: () => ({ meta: [{ title: "My Profile · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["employee", "hr_admin", "super_admin"]} fallbackTo="/">
      <MyProfilePage />
    </RoleGuard>
  ),
});

function MyProfilePage() {
  const { email, role } = useUserRole();
  const [qrUrl, setQrUrl] = useState<string>("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const { data: employee, isLoading } = useQuery({
    queryKey: ["my-employee", email],
    enabled: !!email,
    queryFn: async () => {
      const { data } = await supabase.from("students").select("*").eq("email", email!).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (!employee) return;
    QRCode.toDataURL(employee.student_id, { width: 320, margin: 2, color: { dark: "#0b1220", light: "#ffffff" } })
      .then(setQrUrl).catch(console.error);
    if (employee.photo_url) {
      supabase.storage.from("employee-photos").createSignedUrl(employee.photo_url, 3600)
        .then(({ data }) => setPhotoUrl(data?.signedUrl ?? null));
    }
  }, [employee]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <User className="h-6 w-6 text-primary" /> My Profile
        </h1>
        <p className="text-sm text-muted-foreground">Your account details and QR code.</p>
      </div>

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : !employee ? (
            <div className="space-y-3">
              <p className="text-sm">
                Your sign-in email <span className="font-mono">{email}</span> isn't linked to an employee record yet.
              </p>
              <p className="text-sm text-muted-foreground">
                Ask an admin to add you as an employee using this email address.
              </p>
              {role && (
                <Badge variant="secondary" className="bg-primary/15 text-primary">{ROLE_LABELS[role]}</Badge>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-6 xl:grid xl:grid-cols-[180px_1fr_220px] xl:items-start">
              <div className="flex justify-center">
                {photoUrl ? (
                  <img src={photoUrl} alt={employee.name} className="h-40 w-40 rounded-xl object-cover border border-border" />
                ) : (
                  <div className="h-40 w-40 rounded-xl bg-muted flex items-center justify-center text-3xl font-semibold text-muted-foreground">
                    {employee.name?.charAt(0) ?? "?"}
                  </div>
                )}
              </div>
              <div className="w-full space-y-2 text-center xl:text-left">
                <h2 className="text-xl font-semibold">{employee.name}</h2>
                <p className="font-mono text-xs text-muted-foreground">{employee.student_id}</p>
                <div className="flex flex-wrap justify-center gap-2 pt-1 xl:justify-start">
                  {role && <Badge variant="secondary" className="bg-primary/15 text-primary">{ROLE_LABELS[role]}</Badge>}
                  {employee.department && <Badge variant="secondary">{employee.department}</Badge>}
                  {employee.designation && <Badge variant="outline">{employee.designation}</Badge>}
                </div>
                <dl className="mt-4 grid grid-cols-1 gap-y-2 gap-x-4 text-sm sm:grid-cols-2">
                  <div className="min-w-0"><dt className="text-muted-foreground">Email</dt><dd className="truncate">{employee.email}</dd></div>
                  <div className="min-w-0"><dt className="text-muted-foreground">Phone</dt><dd className="truncate">{employee.phone ?? "—"}</dd></div>
                  <div className="min-w-0"><dt className="text-muted-foreground">Joining Date</dt><dd>{employee.joining_date ?? "—"}</dd></div>
                </dl>
                <Link to="/my-attendance" className="inline-flex items-center gap-1 pt-3 text-sm text-primary hover:underline">
                  <CalendarClock className="h-4 w-4" /> View my attendance history
                </Link>
              </div>
              <div className="flex flex-col items-center gap-2">
                {qrUrl && <img src={qrUrl} alt="Employee QR" className="h-44 w-44 rounded-lg border border-border bg-white p-2" />}
                <p className="text-xs text-muted-foreground">Show this QR to check in</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
