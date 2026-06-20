import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ScanLine,
  CheckCircle2,
  AlertTriangle,
  Camera,
  CameraOff,
  Loader2,
  LogOut as LogOutIcon,
  SwitchCamera,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { RoleGuard } from "@/components/role-guard";

export const Route = createFileRoute("/_authenticated/scanner")({
  head: () => ({ meta: [{ title: "QR Scanner · MySOC Labs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin", "hr_admin"]} fallbackTo="/me">
      <ScannerPage />
    </RoleGuard>
  ),
});

type Feedback = {
  kind: "check-in" | "check-out" | "complete" | "error";
  message: string;
  name?: string;
  time?: string;
  hours?: string;
  status?: string;
};

type CamDevice = { id: string; label: string };

function playBeep() {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.001;
    o.connect(g);
    g.connect(ctx.destination);
    const now = ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    o.start(now);
    o.stop(now + 0.22);
    setTimeout(() => ctx.close(), 400);
  } catch {
    /* ignore */
  }
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

function ScannerPage() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [cameras, setCameras] = useState<CamDevice[]>([]);
  const [activeCamId, setActiveCamId] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [fullscreen, setFullscreen] = useState(false);
  const [flash, setFlash] = useState<"success" | null>(null);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    return () => {
      void stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enumerate cameras once granted
  const loadCameras = useCallback(async () => {
    try {
      const devices = await Html5Qrcode.getCameras();
      const list = devices.map((d) => ({ id: d.id, label: d.label || "Camera" }));
      setCameras(list);
      return list;
    } catch {
      return [];
    }
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

  const startScanner = useCallback(
    async (opts?: { cameraId?: string; facing?: "environment" | "user" }) => {
      if (scannerRef.current) await stopScanner();
      try {
        const elementId = "qr-reader";
        const el = document.getElementById(elementId);
        if (!el) return;
        const scanner = new Html5Qrcode(elementId, { verbose: false });
        scannerRef.current = scanner;

        const useFacing = opts?.facing ?? facing;
        const cameraSource: MediaTrackConstraints | string =
          opts?.cameraId ?? (activeCamId ?? { facingMode: { ideal: useFacing } } as MediaTrackConstraints);

        // Adaptive qrbox sized to viewport
        const qrbox = (vw: number, vh: number) => {
          const minEdge = Math.min(vw, vh);
          const size = Math.floor(minEdge * 0.75);
          return { width: size, height: size };
        };

        await scanner.start(
          cameraSource as never,
          { fps: 15, qrbox, aspectRatio: window.innerWidth < 640 ? 0.75 : 1 },
          (decoded) => void handleDecoded(decoded),
          () => {},
        );
        setScanning(true);

        // After permission grant, enumerate (labels become available)
        const list = await loadCameras();
        if (!activeCamId && opts?.cameraId) setActiveCamId(opts.cameraId);
        else if (!activeCamId && list.length) {
          // best-guess current
          const rear = list.find((c) => /back|rear|environment/i.test(c.label));
          setActiveCamId((rear ?? list[0]).id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not access camera";
        toast.error(msg);
        if (/permission|denied|NotAllowed/i.test(msg)) {
          toast.error("Camera permission denied. Enable it in your browser settings.");
        }
        scannerRef.current = null;
        setScanning(false);
      }
    },
    [activeCamId, facing, loadCameras],
  );

  const switchCamera = async () => {
    if (cameras.length > 1 && activeCamId) {
      const idx = cameras.findIndex((c) => c.id === activeCamId);
      const next = cameras[(idx + 1) % cameras.length];
      setActiveCamId(next.id);
      await startScanner({ cameraId: next.id });
    } else {
      const nextFacing = facing === "environment" ? "user" : "environment";
      setFacing(nextFacing);
      await startScanner({ facing: nextFacing });
    }
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

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const flashSuccess = () => {
    setFlash("success");
    setTimeout(() => setFlash(null), 600);
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
        vibrate([60, 40, 60]);
        setFeedback({ kind: "error", message: `Unknown QR code: ${code}` });
        toast.error("Unknown employee QR");
        return;
      }

      const today = format(new Date(), "yyyy-MM-dd");

      const dow = new Date().getDay();
      if (dow === 0 || dow === 6) {
        setFeedback({ kind: "error", message: "Today is a weekend — attendance not tracked." });
        toast.warning("Weekend: attendance not tracked");
        return;
      }
      const { data: holiday } = await supabase.from("holidays").select("name").eq("date", today).maybeSingle();
      if (holiday) {
        setFeedback({ kind: "error", message: `Today is a holiday: ${holiday.name}` });
        toast.warning(`Holiday: ${holiday.name}`);
        return;
      }

      const { data: existing } = await supabase
        .from("attendance")
        .select("id, check_in, check_out, status")
        .eq("student_id", employee.id)
        .eq("date", today)
        .maybeSingle();

      if (!existing) {
        const checkIn = new Date();
        const { data: assigned } = await supabase
          .from("employee_shifts")
          .select("shifts(start_time, late_cutoff_minutes)")
          .eq("employee_id", employee.id)
          .lte("effective_from", today)
          .order("effective_from", { ascending: false })
          .limit(1)
          .maybeSingle();
        let startTime = "09:30:00";
        let grace = 0;
        const shift = (assigned as { shifts: { start_time: string; late_cutoff_minutes: number } | null } | null)?.shifts;
        if (shift) {
          startTime = shift.start_time;
          grace = shift.late_cutoff_minutes ?? 0;
        } else {
          const { data: def } = await supabase.from("shifts").select("start_time, late_cutoff_minutes").eq("is_default", true).maybeSingle();
          if (def) { startTime = def.start_time; grace = def.late_cutoff_minutes ?? 0; }
        }
        const [h, m] = startTime.split(":").map(Number);
        const cutoff = new Date(checkIn);
        cutoff.setHours(h, m + grace, 0, 0);
        const status = checkIn > cutoff ? "late" : "present";
        const { error: iErr } = await supabase.from("attendance").insert({
          student_id: employee.id,
          date: today,
          check_in: checkIn.toISOString(),
          status,
        });
        if (iErr) {
          vibrate([80, 40, 80]);
          setFeedback({ kind: "error", message: iErr.message });
          toast.error(iErr.message);
          return;
        }
        playBeep();
        vibrate(120);
        flashSuccess();
        setFeedback({
          kind: "check-in",
          message: "Check-In Successful",
          name: employee.name,
          time: format(checkIn, "h:mm a"),
          status,
        });
        toast.success(`Welcome, ${employee.name}!${status === "late" ? " (Late)" : ""}`);
        const { logAudit, notify } = await import("@/lib/audit");
        await logAudit({ action: "attendance_check_in", entity: "attendance", entity_id: employee.id, details: { name: employee.name, status, time: checkIn.toISOString() } });
        if (status === "late") {
          await notify({ audience: "admins", type: "late_check_in", title: "Late check-in", message: `${employee.name} checked in at ${format(checkIn, "h:mm a")}`, link: "/attendance" });
        }
        return;
      }

      if (existing.check_out) {
        vibrate([40, 30, 40]);
        setFeedback({
          kind: "complete",
          message: "Attendance already completed for today",
          name: employee.name,
          time: format(new Date(existing.check_out), "h:mm a"),
        });
        toast.warning(`${employee.name}: attendance already completed`);
        return;
      }

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
        vibrate([80, 40, 80]);
        setFeedback({ kind: "error", message: uErr.message });
        toast.error(uErr.message);
        return;
      }
      playBeep();
      vibrate(120);
      flashSuccess();
      setFeedback({
        kind: "check-out",
        message: "Check-Out Successful",
        name: employee.name,
        time: format(checkOut, "h:mm a"),
        hours: hoursLabel,
      });
      toast.success(`Goodbye, ${employee.name}! (${hoursLabel})`);
      const { logAudit, notify } = await import("@/lib/audit");
      await logAudit({ action: "attendance_check_out", entity: "attendance", entity_id: employee.id, details: { name: employee.name, hours: hoursLabel, time: checkOut.toISOString() } });
      if (checkOut.getHours() < 18) {
        await notify({ audience: "admins", type: "early_check_out", title: "Early check-out", message: `${employee.name} checked out at ${format(checkOut, "h:mm a")} (${hoursLabel})`, link: "/attendance" });
      }
    } finally {
      setProcessing(false);
    }
  };

  const FeedbackPanel = (
    <>
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
    </>
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">QR Scanner</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">Scan employee QR codes to record attendance.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg"><ScanLine className="h-5 w-5" /> Camera</CardTitle>
            {scanning && (
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={switchCamera} title="Switch camera">
                  <SwitchCamera className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={toggleFullscreen} title="Full screen">
                  {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div
              ref={containerRef}
              className={
                fullscreen
                  ? "fixed inset-0 z-50 flex flex-col bg-black"
                  : "relative mx-auto w-full max-w-[560px]"
              }
            >
              <div
                className={
                  fullscreen
                    ? "relative flex-1 overflow-hidden bg-black"
                    : "relative aspect-square w-full overflow-hidden rounded-lg bg-black"
                }
              >
                <div id="qr-reader" className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />

                {/* Scan frame overlay */}
                {scanning && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="relative h-[70%] max-h-[420px] w-[70%] max-w-[420px]">
                      <span className="absolute left-0 top-0 h-8 w-8 border-l-4 border-t-4 border-primary rounded-tl-md" />
                      <span className="absolute right-0 top-0 h-8 w-8 border-r-4 border-t-4 border-primary rounded-tr-md" />
                      <span className="absolute bottom-0 left-0 h-8 w-8 border-b-4 border-l-4 border-primary rounded-bl-md" />
                      <span className="absolute bottom-0 right-0 h-8 w-8 border-b-4 border-r-4 border-primary rounded-br-md" />
                    </div>
                  </div>
                )}

                {/* Success flash */}
                {flash === "success" && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-success/30 animate-fade-in">
                    <CheckCircle2 className="h-24 w-24 text-success animate-scale-in" />
                  </div>
                )}

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

                {fullscreen && (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="absolute right-3 top-3 h-11 w-11 rounded-full"
                    onClick={toggleFullscreen}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                )}
              </div>

              {/* Controls */}
              <div
                className={
                  fullscreen
                    ? "flex items-center justify-center gap-3 bg-black/80 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
                    : "mt-4 flex flex-wrap items-center justify-center gap-2"
                }
              >
                {scanning ? (
                  <>
                    <Button variant="secondary" onClick={stopScanner} size="lg" className="h-12 min-w-[140px]">
                      <CameraOff className="mr-2 h-4 w-4" /> Stop
                    </Button>
                    <Button variant="outline" onClick={switchCamera} size="lg" className="h-12">
                      <SwitchCamera className="mr-2 h-4 w-4" /> Switch
                    </Button>
                    {!fullscreen && (
                      <Button variant="outline" onClick={toggleFullscreen} size="lg" className="h-12">
                        <Maximize2 className="mr-2 h-4 w-4" /> Fullscreen
                      </Button>
                    )}
                  </>
                ) : (
                  <Button onClick={() => startScanner()} size="lg" className="h-12 min-w-[180px]">
                    <Camera className="mr-2 h-4 w-4" /> Start scanner
                  </Button>
                )}
              </div>

              {fullscreen && feedback && (
                <div className="absolute left-3 right-3 top-3 max-w-md rounded-lg bg-background/95 p-3 shadow-lg backdrop-blur">
                  {FeedbackPanel}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Last scan</CardTitle>
          </CardHeader>
          <CardContent>{FeedbackPanel}</CardContent>
        </Card>
      </div>
    </div>
  );
}
