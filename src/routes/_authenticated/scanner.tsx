import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "@/integrations/supabase/client";
import { resolveStudentByCode } from "@/lib/attendance.functions";
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
import { resolveEffectiveShift } from "@/lib/resolve-shift";
import { computeCheckInStatus, isPastShiftEnd, cooldownRemainingMs } from "@/lib/shift-time";
import { ScanBlockedOverlay, type ScanBlock } from "@/components/scan-blocked-overlay";

export const Route = createFileRoute("/_authenticated/scanner")({
  head: () => ({ meta: [{ title: "QR Scanner · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin", "hr_admin", "founder", "employee"]} fallbackTo="/me">
      <ScannerPage />
    </RoleGuard>
  ),
});

type Feedback = {
  kind: "check-in" | "check-out" | "error";
  message: string;
  name?: string;
  time?: string;
  hours?: string;
  status?: string;
};

type CamDevice = { id: string; label: string };

function isEmbeddedPreview() {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function cameraFeatureBlocked() {
  const documentWithPolicy = document as Document & {
    permissionsPolicy?: { allowsFeature: (feature: string) => boolean };
    featurePolicy?: { allowsFeature: (feature: string) => boolean };
  };
  const policy = documentWithPolicy.permissionsPolicy ?? documentWithPolicy.featurePolicy;
  try {
    return policy ? !policy.allowsFeature("camera") : false;
  } catch {
    return false;
  }
}

function getCameraErrorMessage(err: unknown) {
  const e = err as DOMException;
  if (cameraFeatureBlocked()) return "Camera is blocked in this embedded preview. Open the scanner in a new tab or install/open the app directly.";
  if (e.name === "NotAllowedError" || e.name === "SecurityError") return "Camera permission denied. Tap the browser camera icon, allow camera access, then try again.";
  if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") return "No camera found on this device.";
  if (e.name === "NotReadableError" || e.name === "TrackStartError") return "Camera is already in use by another app. Close other camera apps and try again.";
  if (e.name === "OverconstrainedError" || e.name === "ConstraintNotSatisfiedError") return "This camera mode is not available. Try switching cameras.";
  return e.message ? `Could not access camera: ${e.message}` : "Could not access camera.";
}

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
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ScanBlock | null>(null);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const resolveStudent = useServerFn(resolveStudentByCode);

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

  const startScanner = useCallback(
    async (opts?: { cameraId?: string; facing?: "environment" | "user" }) => {
      setCameraError(null);
      if (scannerRef.current) await stopScanner();

      // Pre-flight checks
      if (typeof window !== "undefined" && !window.isSecureContext) {
        const message = "Camera requires HTTPS. Open this page over a secure connection.";
        setCameraError(message);
        toast.error(message);
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        const message = "This browser does not support camera access.";
        setCameraError(message);
        toast.error(message);
        return;
      }
      if (cameraFeatureBlocked()) {
        const message = "Camera is blocked in this embedded preview. Open the scanner in a new tab or install/open the app directly.";
        setCameraError(message);
        toast.error(message);
        return;
      }

      const useFacing = opts?.facing ?? facing;

      try {
        const elementId = "qr-reader";
        const el = document.getElementById(elementId);
        if (!el) return;
        const scanner = new Html5Qrcode(elementId, { verbose: false });
        scannerRef.current = scanner;

        const chosenId = opts?.cameraId ?? null;
        const cameraSource = chosenId || ({ facingMode: { ideal: useFacing } } as MediaTrackConstraints);

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
        if (chosenId) setActiveCamId(chosenId);
        const rawDevices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        const list = rawDevices
          .filter((device) => device.kind === "videoinput" && device.deviceId)
          .map((device, index) => ({ id: device.deviceId, label: device.label || `Camera ${index + 1}` }));
        if (list.length) {
          setCameras(list);
          if (!chosenId) setActiveCamId(list.find((c) => /back|rear|environment/i.test(c.label))?.id ?? list[0].id);
        }
      } catch {
        try {
          await scannerRef.current?.clear();
          const scanner = new Html5Qrcode("qr-reader", { verbose: false });
          scannerRef.current = scanner;
          await scanner.start(
            { facingMode: useFacing } as MediaTrackConstraints,
            { fps: 10, qrbox: (vw, vh) => {
              const size = Math.floor(Math.min(vw, vh) * 0.75);
              return { width: size, height: size };
            } },
            (decoded) => void handleDecoded(decoded),
            () => {},
          );
          setScanning(true);
        } catch (fallbackErr) {
          const msg = getCameraErrorMessage(fallbackErr);
          setCameraError(msg);
          toast.error(msg);
          scannerRef.current = null;
          setScanning(false);
        }
      }
    },
    [facing],
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
      let employee: { id: string; name: string; student_id: string } | null = null;
      let sErr = false;
      try {
        employee = await resolveStudent({ data: { code } });
      } catch {
        sErr = true;
      }

      if (sErr || !employee) {
        vibrate([60, 40, 60]);
        setFeedback({ kind: "error", message: `Unknown QR code: ${code}` });
        toast.error("Unknown employee QR");
        return;
      }

      const today = format(new Date(), "yyyy-MM-dd");

      // weekend check disabled for testing
      // const dow = new Date().getDay();
      // if (dow === 0 || dow === 6) { ... }
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
        const shift = await resolveEffectiveShift(supabase, employee.id, today);
        if (isPastShiftEnd(checkIn, shift)) {
          vibrate([80, 40, 80]);
          setFeedback(null);
          setBlocked({ kind: "shift-over" });
          return;
        }
        const status = computeCheckInStatus(checkIn, shift);
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
        setFeedback(null);
        setBlocked({ kind: "already-complete" });
        return;
      }

      const checkOut = new Date();
      if (existing.check_in) {
        const remaining = cooldownRemainingMs(checkOut, new Date(existing.check_in));
        if (remaining > 0) {
          vibrate([40, 30, 40]);
          setFeedback(null);
          setBlocked({ kind: "cooldown-checkin", remainingMs: remaining });
          return;
        }
      }
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
      ) : (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
          <div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" /><span className="font-semibold">Scan error</span></div>
          <p className="text-sm">{feedback.message}</p>
        </div>
      )}
    </>
  );

  return (
    <>
      {blocked && <ScanBlockedOverlay block={blocked} onDismiss={() => setBlocked(null)} />}
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
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
                    {cameraError ? (
                      <>
                        <AlertTriangle className="h-9 w-9 text-warning" />
                        <p className="max-w-sm font-medium text-foreground">{cameraError}</p>
                        {isEmbeddedPreview() && (
                          <Button
                            variant="secondary"
                            onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}
                          >
                            Open scanner in new tab
                          </Button>
                        )}
                      </>
                    ) : (
                      "Camera is off"
                    )}
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
    </>
  );
}
