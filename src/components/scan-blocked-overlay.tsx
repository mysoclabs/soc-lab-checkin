import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/** Tracks document.fullscreenElement so the overlay can portal into it — a
 * native Fullscreen API element only paints its own subtree, so a `fixed`
 * overlay rendered outside it would otherwise be invisible while the
 * scanner's camera view is in fullscreen. */
function useFullscreenTarget(): Element {
  const [target, setTarget] = useState<Element>(() => document.fullscreenElement ?? document.body);
  useEffect(() => {
    const onChange = () => setTarget(document.fullscreenElement ?? document.body);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  return target;
}

export function ScanBlockedOverlay({ block, onDismiss }: { block: ScanBlock; onDismiss: () => void }) {
  const target = useFullscreenTarget();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, []);

  const detail = detailFor(block);

  return createPortal(
    <div
      role="alert"
      onClick={onDismiss}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-destructive/95 p-6 text-center text-destructive-foreground"
    >
      <AlertTriangle className="h-16 w-16" />
      <p className="max-w-md text-2xl font-semibold">{TITLES[block.kind]}</p>
      {detail && <p className="max-w-sm text-base opacity-90">{detail}</p>}
      <p className="text-sm opacity-70">Tap anywhere to dismiss</p>
    </div>,
    target,
  );
}
