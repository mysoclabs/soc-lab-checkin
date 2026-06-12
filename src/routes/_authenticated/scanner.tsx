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

    const { data: student, error: sErr } = await supabase
      .from("students")
      .select("id, name, student_id")
      .eq("student_id", code)
      .maybeSingle();

    if (sErr || !student) {
      setFeedback({ kind: "error", message: `Unknown QR code: ${code}` });
      toast.error("Unknown employee QR");
      return;
    }

    const today = format(new Date(), "yyyy-MM-dd");
    const { data: existing } = await supabase
      .from("attendance")
      .select("id, check_in")
      .eq("student_id", student.id)
      .eq("date", today)
      .maybeSingle();

    if (existing) {
      setFeedback({
        kind: "duplicate",
        message: "Attendance already recorded",
        name: student.name,
        time: existing.check_in ? format(new Date(existing.check_in), "h:mm a") : undefined,
      });
      toast.warning(`${student.name}: already checked in today`);
      return;
    }

    const checkIn = new Date().toISOString();
    const lateCutoff = "09:30:00";
    const status = new Date(checkIn).toTimeString().slice(0, 8) > lateCutoff ? "late" : "present";

    const { error: iErr } = await supabase.from("attendance").insert({
      student_id: student.id,
      date: today,
      check_in: checkIn,
      status,
    });
    if (iErr) {
      setFeedback({ kind: "error", message: iErr.message });
      toast.error(iErr.message);
      return;
    }
    setFeedback({
      kind: "success",
      message: "Attendance recorded",
      name: student.name,
      time: format(new Date(checkIn), "h:mm a"),
    });
    toast.success(`Welcome, ${student.name}!`);
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
            <div id="qr-reader" className="mx-auto aspect-square w-full max-w-[520px] overflow-hidden rounded-lg bg-black" />
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
            ) : feedback.kind === "success" ? (
              <div className="space-y-3 rounded-lg border border-success/30 bg-success/10 p-4">
                <div className="flex items-center gap-2 text-success"><CheckCircle2 className="h-5 w-5" /><span className="font-semibold">{feedback.message}</span></div>
                <p className="text-2xl font-semibold">{feedback.name}</p>
                <p className="text-sm text-muted-foreground">Checked in at {feedback.time}</p>
              </div>
            ) : feedback.kind === "duplicate" ? (
              <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
                <div className="flex items-center gap-2 text-warning"><AlertTriangle className="h-5 w-5" /><span className="font-semibold">{feedback.message}</span></div>
                <p className="text-2xl font-semibold">{feedback.name}</p>
                {feedback.time && <p className="text-sm text-muted-foreground">Earlier check-in at {feedback.time}</p>}
                <Badge variant="secondary">Duplicate</Badge>
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
