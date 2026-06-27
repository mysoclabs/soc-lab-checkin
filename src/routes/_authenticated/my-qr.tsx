import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QrCode, ScanLine, Download, Maximize2, Minimize2, X } from "lucide-react";
import { RoleGuard } from "@/components/role-guard";
import { useUserRole } from "@/hooks/use-role";

export const Route = createFileRoute("/_authenticated/my-qr")({
  head: () => ({ meta: [{ title: "My QR · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["employee", "finance", "hr_admin", "super_admin"]} fallbackTo="/">
      <MyQrPage />
    </RoleGuard>
  ),
});

function MyQrPage() {
  const { email } = useUserRole();
  const [qrUrl, setQrUrl] = useState<string>("");
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { data: employee, isLoading } = useQuery({
    queryKey: ["my-employee-qr", email],
    enabled: !!email,
    queryFn: async () => {
      const { data } = await supabase
        .from("students")
        .select("id, student_id, name, email, department, designation")
        .eq("email", email!)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (!employee) return;
    QRCode.toDataURL(employee.student_id, {
      width: 1024,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#0b1220", light: "#ffffff" },
    })
      .then(setQrUrl)
      .catch(console.error);
  }, [employee]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const handleDownload = () => {
    if (!qrUrl || !employee) return;
    const a = document.createElement("a");
    a.href = qrUrl;
    a.download = `${employee.student_id}-qr.png`;
    a.click();
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await containerRef.current?.requestFullscreen?.();
        setFullscreen(true);
      } else {
        await document.exitFullscreen?.();
        setFullscreen(false);
      }
    } catch {
      setFullscreen((f) => !f);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <QrCode className="h-6 w-6 text-primary" /> My QR
          </h1>
          <p className="text-sm text-muted-foreground">
            Show this code to the attendance scanner to check in or out.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link to="/scanner"><ScanLine className="mr-2 h-4 w-4" /> Scan Attendance</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">QR Code</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !employee ? (
            <p className="text-sm text-muted-foreground">
              Your sign-in email <span className="font-mono">{email}</span> isn't linked to an employee record yet.
              Ask an admin to add you.
            </p>
          ) : (
            <div
              ref={containerRef}
              className={
                fullscreen
                  ? "fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background p-6"
                  : "flex flex-col items-center gap-4"
              }
            >
              {fullscreen && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-4 top-4"
                  onClick={toggleFullscreen}
                  aria-label="Exit fullscreen"
                >
                  <X className="h-5 w-5" />
                </Button>
              )}
              <div className={fullscreen ? "rounded-2xl bg-white p-6 shadow-xl" : "rounded-xl bg-white p-4"}>
                {qrUrl ? (
                  <img
                    src={qrUrl}
                    alt={`QR for ${employee.name}`}
                    className={fullscreen ? "h-[min(70vh,70vw)] w-[min(70vh,70vw)]" : "h-64 w-64 sm:h-72 sm:w-72"}
                  />
                ) : (
                  <div className="h-64 w-64 animate-pulse rounded bg-muted" />
                )}
              </div>
              <div className="text-center">
                <p className={fullscreen ? "text-2xl font-semibold" : "text-lg font-semibold"}>{employee.name}</p>
                <p className="font-mono text-sm text-muted-foreground">{employee.student_id}</p>
                <div className="mt-2 flex flex-wrap justify-center gap-1">
                  {employee.department && <Badge variant="secondary">{employee.department}</Badge>}
                  {employee.designation && <Badge variant="outline">{employee.designation}</Badge>}
                </div>
              </div>
              {!fullscreen && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={handleDownload} variant="secondary">
                    <Download className="mr-2 h-4 w-4" /> Download PNG
                  </Button>
                  <Button onClick={toggleFullscreen}>
                    <Maximize2 className="mr-2 h-4 w-4" /> Fullscreen
                  </Button>
                </div>
              )}
              {fullscreen && (
                <Button onClick={toggleFullscreen} size="lg" variant="secondary">
                  <Minimize2 className="mr-2 h-4 w-4" /> Exit fullscreen
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {employee && (
        <p className="text-center text-xs text-muted-foreground">
          Tip: tap <strong>Fullscreen</strong> on your phone, then present it to the scanner for the cleanest read.
        </p>
      )}
    </div>
  );
}
