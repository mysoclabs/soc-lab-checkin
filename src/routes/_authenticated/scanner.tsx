import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScanLine, CheckCircle2, AlertTriangle, Camera, CameraOff, Loader2, LogOut as LogOutIcon } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/scanner")({
  head: () => ({ meta: [{ title: "QR Scanner · MySOC Labs" }] }),
  component: ScannerPage,
});

type Feedback = {
  kind: "check-in" | "check-out" | "complete" | "error";
  message: string;
  name?: string;
  time?: string;
  hours?: string;
  status?: string;
};

function ScannerPage() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    return () => {
      void stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopScanner = async () => {
    try {
      if (scannerRef.current && scannerRef.current.isScanning) {
        await scannerRef.current.stop();
      }
      await scannerRef.current?.clear();
    } catch {
      /* ignore */
    }
    scannerRef.current = null;
    setScanning(false);
  };

  const startScanner = async () => {
    if (scannerRef.current) return;
    try {
      const elementId = "qr-reader";
      const scanner = new Html5Qrcode(elementId, { verbose: false });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 280, height: 280 }, aspectRatio: 1 },
        (decoded) => void handleDecoded(decoded),
        () => {},
      );
      setScanning(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not access camera";
      toast.error(msg);
      scannerRef.current = null;
    }
  };

  const handleDecoded = async (code: string) => {
    const now = Date.now();
    if (lastScanRef.current && lastScanRef.current.code === code && now - lastScanRef.current.at < 3000) return;
    lastScanRef.current = { code, at: now };

    setProcessing(true);
    try {
      const { data: employee, error: sErr } = await supabase
        .from("students")
        .select("id, name, student_id")
        .eq("student_id", code)
        .maybeSingle();

      if (sErr || !employee) {
        setFeedback({ kind: "error", message: `Unknown QR code: ${code}` });
        toast.error("Unknown employee QR");
        return;
      }

      const today = format(new Date(), "yyyy-MM-dd");
      const { data: existing } = await supabase
        .from("attendance")
        .select("id, check_in, check_out, status")
        .eq("student_id", employee.id)
        .eq("date", today)
        .maybeSingle();

      // Case 1: no record yet → Check-In
      if (!existing) {
        const checkIn = new Date();
        const lateCutoff = "09:30:00";
        const status = checkIn.toTimeString().slice(0, 8) > lateCutoff ? "late" : "present";
        const { error: iErr } = await supabase.from("attendance").insert({
          student_id: employee.id,
          date: today,
          check_in: checkIn.toISOString(),
          status,
        });
        if (iErr) {
          setFeedback({ kind: "error", message: iErr.message });
          toast.error(iErr.message);
          return;
        }
        setFeedback({
          kind: "check-in",
          message: "Check-In Successful",
          name: employee.name,
          time: format(checkIn, "h:mm a"),
          status,
        });
        toast.success(`Welcome, ${employee.name}!${status === "late" ? " (Late)" : ""}`);
        return;
      }

      // Case 2: already checked in and out → blocked
      if (existing.check_out) {
        setFeedback({
          kind: "complete",
          message: "Attendance already completed for today",
          name: employee.name,
          time: format(new Date(existing.check_out), "h:mm a"),
        });
        toast.warning(`${employee.name}: attendance already completed`);
        return;
      }

      // Case 3: checked in but not out → Check-Out
      const checkOut = new Date();
      const checkInDate = existing.check_in ? new Date(existing.check_in) : checkOut;
      const ms = checkOut.getTime() - checkInDate.getTime();
      const hours = Math.floor(ms / 3_600_000);
      const minutes = Math.floor((ms % 3_600_000) / 60_000);
      const hoursLabel = `${hours}h ${minutes}m`;

      const { error: uErr } = await supabase
        .from("attendance")
        .update({ check_out: checkOut.toISOString() })
        .eq("id", existing.id);
      if (uErr) {
        setFeedback({ kind: "error", message: uErr.message });
        toast.error(uErr.message);
        return;
      }
      setFeedback({
        kind: "check-out",
        message: "Check-Out Successful",
        name: employee.name,
        time: format(checkOut, "h:mm a"),
        hours: hoursLabel,
      });
      toast.success(`Goodbye, ${employee.name}! (${hoursLabel})`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">QR Scanner</h1>
        <p className="text-sm text-muted-foreground">Scan employee QR codes to record attendance. Optimized for Android tablets.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5" /> Camera</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative mx-auto aspect-square w-full max-w-[520px] overflow-hidden rounded-lg bg-black">
              <div id="qr-reader" className="h-full w-full" />
              {processing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="text-sm font-medium">Processing scan…</p>
                </div>
              )}
              {!scanning && !processing && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  Camera is off
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-center">
              {scanning ? (
                <Button variant="secondary" onClick={stopScanner} size="lg">
                  <CameraOff className="mr-2 h-4 w-4" /> Stop scanner
                </Button>
              ) : (
                <Button onClick={startScanner} size="lg">
                  <Camera className="mr-2 h-4 w-4" /> Start scanner
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Last scan</CardTitle>
          </CardHeader>
          <CardContent>
            {!feedback ? (
              <p className="text-sm text-muted-foreground">Waiting for a scan…</p>
            ) : feedback.kind === "check-in" ? (
              <div className="space-y-3 rounded-lg border border-success/30 bg-success/10 p-4">
                <div className="flex items-center gap-2 text-success"><CheckCircle2 className="h-5 w-5" /><span className="font-semibold">{feedback.message}</span></div>
                <p className="text-2xl font-semibold">{feedback.name}</p>
                <p className="text-sm text-muted-foreground">Checked in at {feedback.time}</p>
                {feedback.status === "late" && <Badge variant="secondary" className="bg-warning/20 text-warning">Late</Badge>}
              </div>
            ) : feedback.kind === "check-out" ? (
              <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/10 p-4">
                <div className="flex items-center gap-2 text-primary"><LogOutIcon className="h-5 w-5" /><span className="font-semibold">{feedback.message}</span></div>
                <p className="text-2xl font-semibold">{feedback.name}</p>
                <p className="text-sm text-muted-foreground">Checked out at {feedback.time}</p>
                {feedback.hours && <Badge variant="secondary">Working hours: {feedback.hours}</Badge>}
              </div>
            ) : feedback.kind === "complete" ? (
              <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
                <div className="flex items-center gap-2 text-warning"><AlertTriangle className="h-5 w-5" /><span className="font-semibold">{feedback.message}</span></div>
                <p className="text-2xl font-semibold">{feedback.name}</p>
                {feedback.time && <p className="text-sm text-muted-foreground">Checked out at {feedback.time}</p>}
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
                <div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" /><span className="font-semibold">Scan error</span></div>
                <p className="text-sm">{feedback.message}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
