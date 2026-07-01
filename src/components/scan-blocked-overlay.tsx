import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export type ScanBlock =
  | { kind: "shift-over" }
  | { kind: "cooldown-checkin"; remainingMs: number }
  | { kind: "already-complete" };

const AUTO_DISMISS_MS = 4000;

const TITLES: Record<ScanBlock["kind"], string> = {
  "shift-over": "Shift is over — cannot check in",
  "cooldown-checkin": "Checked in recently",
  "already-complete": "Attendance already completed today",
};

function detailFor(block: ScanBlock): string | undefined {
  if (block.kind !== "cooldown-checkin") return undefined;
  const minutes = Math.max(1, Math.ceil(block.remainingMs / 60_000));
  return `Please wait ${minutes} more minute${minutes === 1 ? "" : "s"} before scanning again.`;
}

export function ScanBlockedOverlay({ block, onDismiss }: { block: ScanBlock; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="alert"
      onClick={onDismiss}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-destructive/95 p-6 text-center text-destructive-foreground"
    >
      <AlertTriangle className="h-16 w-16" />
      <p className="max-w-md text-2xl font-semibold">{TITLES[block.kind]}</p>
      {detailFor(block) && <p className="max-w-sm text-base opacity-90">{detailFor(block)}</p>}
      <p className="text-sm opacity-70">Tap anywhere to dismiss</p>
    </div>
  );
}
