# Attendance Scan Cooldown & Shift Time Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the false-checkout bug (rapid re-scan writes `check_out ≈ check_in`, showing 0.00 worked hours) by adding a real 1-hour scan cooldown, enforce shift-based check-in windows (present/late/blocked), and auto-close attendance for anyone who never scans out.

**Architecture:** Pure, clock-injected helper functions in `src/lib/shift-time.ts` (unit tested with `bun:test`, zero I/O) decide status/cooldown/block outcomes. A small I/O helper (`src/lib/resolve-shift.ts`) resolves an employee's effective shift row and is reused by both the client-side scanner and the server-side cron job. The scanner (`scanner.tsx`) gets a new full-screen `ScanBlockedOverlay` for the three block cases. A new TanStack Start server route (`src/routes/api/cron/auto-checkout.ts`) is invoked every 15 minutes by Vercel Cron (`vercel.json`) to close out stale check-ins.

**Tech Stack:** TypeScript, React, TanStack Start (file-based server routes via `server.handlers`), Supabase (Postgres + supabase-js), `bun:test` (built-in test runner, already verified working — no new dependency needed), date-fns (already a dependency, used only for display formatting elsewhere).

## Global Constraints

- Default shift ("General"): `start_time=08:30`, `end_time=16:30`, `late_cutoff_minutes=10` (present through 8:39:59, late from 8:40, check-in blocked from 16:30:01).
- Cooldown after check-in (no check-out yet): 1 hour (3,600,000 ms), full-screen block if re-scanned within it.
- Once `check_out` is set for the day, always block re-scan (no time limit) — matches existing app semantics, just upgraded to full-screen.
- Check-in blocked strictly after the employee's effective shift `end_time`, no buffer. Does not apply to check-out.
- Auto-checkout deadline: shift `end_time` + 2 hours (flat), deterministic value written to `check_out`, not "whenever the cron ran."
- Employees with a custom `employee_shifts` assignment always use their assigned shift's times, never the default — this already works via existing lookup and must not be broken by these changes.
- No new database tables. No changes to `shifts`/`employee_shifts` schema, RLS, or the existing admin "force check-out" button in `attendance.tsx`.
- Never commit secrets (`.env` is gitignored — confirmed). `CRON_SECRET` goes in `.env` locally and must also be added to the Vercel project's env vars by the user (no CLI/API access available to do this remotely).
- DB migrations in this project require the user to run the SQL manually in the Supabase SQL Editor (no DB connection string or Supabase access token is available in this environment) — same pattern as every prior fix in this project.

---

### Task 1: Pure shift-time helper functions

**Files:**
- Create: `src/lib/shift-time.ts`
- Test: `src/lib/shift-time.test.ts`

**Interfaces:**
- Produces: `ShiftTimes` type (`{ start_time: string; end_time: string; late_cutoff_minutes: number }`), `COOLDOWN_MS`, `AUTO_CHECKOUT_GRACE_MS` constants, `timeOnDate(referenceDate: Date, time: string): Date`, `computeCheckInStatus(now: Date, shift: ShiftTimes): "present" | "late"`, `isPastShiftEnd(now: Date, shift: ShiftTimes): boolean`, `cooldownRemainingMs(now: Date, lastEventAt: Date): number`, `autoCheckoutDeadline(shift: ShiftTimes, referenceDate: Date): Date`, `isAutoCheckoutDue(now: Date, shift: ShiftTimes, referenceDate: Date): boolean`. Task 2 and Task 5/6 consume all of these by exact name.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/shift-time.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import {
  COOLDOWN_MS,
  AUTO_CHECKOUT_GRACE_MS,
  timeOnDate,
  computeCheckInStatus,
  isPastShiftEnd,
  cooldownRemainingMs,
  autoCheckoutDeadline,
  isAutoCheckoutDue,
  type ShiftTimes,
} from "./shift-time";

const GENERAL: ShiftTimes = { start_time: "08:30:00", end_time: "16:30:00", late_cutoff_minutes: 10 };

function at(h: number, m: number, s = 0) {
  return new Date(2026, 6, 1, h, m, s);
}

describe("timeOnDate", () => {
  test("combines a reference date with a HH:MM:SS time", () => {
    const result = timeOnDate(at(0, 0), "08:30:00");
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(6);
    expect(result.getDate()).toBe(1);
    expect(result.getHours()).toBe(8);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(0);
  });

  test("accepts HH:MM without seconds", () => {
    const result = timeOnDate(at(0, 0), "16:30");
    expect(result.getHours()).toBe(16);
    expect(result.getMinutes()).toBe(30);
  });
});

describe("computeCheckInStatus", () => {
  test("early arrival is present", () => {
    expect(computeCheckInStatus(at(8, 0), GENERAL)).toBe("present");
  });

  test("exactly on shift start is present", () => {
    expect(computeCheckInStatus(at(8, 30), GENERAL)).toBe("present");
  });

  test("within grace window (8:39:59) is present", () => {
    expect(computeCheckInStatus(at(8, 39, 59), GENERAL)).toBe("present");
  });

  test("exactly at the cutoff (8:40:00) is present (cutoff is inclusive)", () => {
    expect(computeCheckInStatus(at(8, 40, 0), GENERAL)).toBe("present");
  });

  test("one second past the cutoff (8:40:01) is late", () => {
    expect(computeCheckInStatus(at(8, 40, 1), GENERAL)).toBe("late");
  });

  test("well past the cutoff is late", () => {
    expect(computeCheckInStatus(at(12, 0), GENERAL)).toBe("late");
  });
});

describe("isPastShiftEnd", () => {
  test("before shift end is false", () => {
    expect(isPastShiftEnd(at(16, 29, 59), GENERAL)).toBe(false);
  });

  test("exactly at shift end is false (not yet past)", () => {
    expect(isPastShiftEnd(at(16, 30, 0), GENERAL)).toBe(false);
  });

  test("one second past shift end is true", () => {
    expect(isPastShiftEnd(at(16, 30, 1), GENERAL)).toBe(true);
  });
});

describe("cooldownRemainingMs", () => {
  test("returns full cooldown right after the event", () => {
    const lastEvent = at(9, 0, 0);
    const now = at(9, 0, 0);
    expect(cooldownRemainingMs(now, lastEvent)).toBe(COOLDOWN_MS);
  });

  test("returns partial remaining time mid-cooldown", () => {
    const lastEvent = at(9, 0, 0);
    const now = at(9, 30, 0); // 30 min later
    expect(cooldownRemainingMs(now, lastEvent)).toBe(COOLDOWN_MS - 30 * 60 * 1000);
  });

  test("returns 0 once the cooldown has fully elapsed", () => {
    const lastEvent = at(9, 0, 0);
    const now = at(10, 0, 0); // exactly 1 hour later
    expect(cooldownRemainingMs(now, lastEvent)).toBe(0);
  });

  test("returns 0 (not negative) well past the cooldown", () => {
    const lastEvent = at(9, 0, 0);
    const now = at(14, 0, 0);
    expect(cooldownRemainingMs(now, lastEvent)).toBe(0);
  });
});

describe("autoCheckoutDeadline", () => {
  test("is shift end + 2 hours on the reference date", () => {
    const deadline = autoCheckoutDeadline(GENERAL, at(0, 0));
    expect(deadline.getHours()).toBe(18);
    expect(deadline.getMinutes()).toBe(30);
  });
});

describe("isAutoCheckoutDue", () => {
  test("false before the deadline", () => {
    expect(isAutoCheckoutDue(at(18, 29, 59), GENERAL, at(0, 0))).toBe(false);
  });

  test("false exactly at the deadline", () => {
    expect(isAutoCheckoutDue(at(18, 30, 0), GENERAL, at(0, 0))).toBe(false);
  });

  test("true one second past the deadline", () => {
    expect(isAutoCheckoutDue(at(18, 30, 1), GENERAL, at(0, 0))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/shift-time.test.ts`
Expected: FAIL — `error: Cannot find module './shift-time'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/shift-time.ts`:

```ts
export type ShiftTimes = {
  start_time: string;
  end_time: string;
  late_cutoff_minutes: number;
};

export const COOLDOWN_MS = 60 * 60 * 1000;
export const AUTO_CHECKOUT_GRACE_MS = 2 * 60 * 60 * 1000;

/** Combines a reference Date's calendar day with a "HH:MM" or "HH:MM:SS" time-of-day string. */
export function timeOnDate(referenceDate: Date, time: string): Date {
  const [h, m, s] = time.split(":").map(Number);
  const result = new Date(referenceDate);
  result.setHours(h, m, s ?? 0, 0);
  return result;
}

/** Present if at or before start_time + late_cutoff_minutes, otherwise late. Cutoff is inclusive. */
export function computeCheckInStatus(now: Date, shift: ShiftTimes): "present" | "late" {
  const cutoff = timeOnDate(now, shift.start_time);
  cutoff.setMinutes(cutoff.getMinutes() + shift.late_cutoff_minutes);
  return now > cutoff ? "late" : "present";
}

/** True once the current time is strictly after the shift's end_time (end_time itself is not past). */
export function isPastShiftEnd(now: Date, shift: ShiftTimes): boolean {
  return now > timeOnDate(now, shift.end_time);
}

/** Milliseconds left in the 1-hour cooldown since lastEventAt, floored at 0 (never negative). */
export function cooldownRemainingMs(now: Date, lastEventAt: Date): number {
  const elapsed = now.getTime() - lastEventAt.getTime();
  return Math.max(0, COOLDOWN_MS - elapsed);
}

/** The deterministic auto-checkout timestamp: shift end + 2 hours, on referenceDate's calendar day. */
export function autoCheckoutDeadline(shift: ShiftTimes, referenceDate: Date): Date {
  const deadline = timeOnDate(referenceDate, shift.end_time);
  deadline.setTime(deadline.getTime() + AUTO_CHECKOUT_GRACE_MS);
  return deadline;
}

/** True once now is strictly past the auto-checkout deadline. */
export function isAutoCheckoutDue(now: Date, shift: ShiftTimes, referenceDate: Date): boolean {
  return now > autoCheckoutDeadline(shift, referenceDate);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/shift-time.test.ts`
Expected: `19 pass, 0 fail` (all describe blocks above).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shift-time.ts src/lib/shift-time.test.ts
git commit -m "Add pure shift-time helpers for check-in status, cooldown, and auto-checkout"
```

---

### Task 2: Shared shift-resolution query helper

**Files:**
- Create: `src/lib/resolve-shift.ts`

**Interfaces:**
- Consumes: `ShiftTimes` from `src/lib/shift-time.ts` (Task 1).
- Produces: `resolveEffectiveShift(client: SupabaseClient<Database>, employeeId: string, today: string): Promise<ShiftTimes>`. Task 5 (scanner) and Task 6 (cron route) both call this by exact name, passing either the client-side `supabase` instance or the server-side `supabaseAdmin` instance — both are `SupabaseClient<Database>`.

- [ ] **Step 1: Write the implementation**

There's no meaningful pure-function test here (it's a thin Supabase query wrapper) — the existing manual query in `scanner.tsx` already covers this shape today, and Task 8 verifies it end-to-end in the browser. Create `src/lib/resolve-shift.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ShiftTimes } from "@/lib/shift-time";

const FALLBACK_SHIFT: ShiftTimes = { start_time: "09:30:00", end_time: "18:30:00", late_cutoff_minutes: 0 };

/**
 * Resolves the shift that applies to an employee on a given date: their
 * assigned `employee_shifts` row effective as of that date if one exists,
 * otherwise the table's default shift, otherwise a hardcoded fallback.
 */
export async function resolveEffectiveShift(
  client: SupabaseClient<Database>,
  employeeId: string,
  today: string,
): Promise<ShiftTimes> {
  const { data: assigned } = await client
    .from("employee_shifts")
    .select("shifts(start_time, end_time, late_cutoff_minutes)")
    .eq("employee_id", employeeId)
    .lte("effective_from", today)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  const assignedShift = (assigned as unknown as { shifts: ShiftTimes | null } | null)?.shifts;
  if (assignedShift) return assignedShift;

  const { data: def } = await client
    .from("shifts")
    .select("start_time, end_time, late_cutoff_minutes")
    .eq("is_default", true)
    .maybeSingle();
  return (def as ShiftTimes | null) ?? FALLBACK_SHIFT;
}
```

- [ ] **Step 2: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p .`
Expected: no new errors from `src/lib/resolve-shift.ts` (the pre-existing unrelated `users.functions.ts` errors are fine — confirm they're the same two errors seen before this change).

- [ ] **Step 3: Commit**

```bash
git add src/lib/resolve-shift.ts
git commit -m "Add shared shift-resolution helper for scanner and cron job"
```

---

### Task 3: Migration — update default shift to 08:30–16:30 with 10 min grace

**Files:**
- Create: `supabase/migrations/20260701135326_e7a2c9d4-3f6b-4a81-9c2e-7b1d4a8f6c3e.sql`

**Interfaces:**
- Produces: no code interface — this is a data-only migration. Task 5/6/8 rely on the "General" shift row having `start_time=08:30:00`, `end_time=16:30:00`, `late_cutoff_minutes=10` once applied.

- [ ] **Step 1: Write the migration file**

```sql
-- Update the default "General" shift to the target check-in window:
-- present through 8:39:59, late from 8:40, check-in blocked after 16:30.
-- Employees with a custom employee_shifts assignment are unaffected —
-- resolveEffectiveShift() always prefers their assigned shift over this
-- default.
UPDATE public.shifts
SET start_time = '08:30:00',
    end_time = '16:30:00',
    late_cutoff_minutes = 10,
    updated_at = now()
WHERE is_default = true;

-- ============ verify ============
-- SELECT name, start_time, end_time, late_cutoff_minutes, is_default
-- FROM public.shifts WHERE is_default = true;
```

- [ ] **Step 2: Commit the migration file**

```bash
git add supabase/migrations/20260701135326_e7a2c9d4-3f6b-4a81-9c2e-7b1d4a8f6c3e.sql
git commit -m "Update default shift to 08:30-16:30 with 10 min late grace"
```

- [ ] **Step 3: Apply to the live database (user action required)**

There is no DB connection string or Supabase access token available in this environment, so this step must be run manually in the Supabase SQL Editor for project `hjcwqokeafaynotfjvmy`, same as every prior migration in this project. Copy the SQL from the committed file directly (not from chat prose) into a blank SQL Editor tab and run it, then run the commented verify query separately to confirm `start_time=08:30:00`, `end_time=16:30:00`, `late_cutoff_minutes=10`.

---

### Task 4: Full-screen `ScanBlockedOverlay` component

**Files:**
- Create: `src/components/scan-blocked-overlay.tsx`

**Interfaces:**
- Produces: `ScanBlock` type (`{ kind: "shift-over" } | { kind: "cooldown-checkin"; remainingMs: number } | { kind: "already-complete" }`) and `ScanBlockedOverlay({ block, onDismiss }: { block: ScanBlock; onDismiss: () => void })` component. Task 5 imports both by exact name.

- [ ] **Step 1: Write the component**

```tsx
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
```

- [ ] **Step 2: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/scan-blocked-overlay.tsx
git commit -m "Add full-screen ScanBlockedOverlay component"
```

---

### Task 5: Wire cooldown, shift-over block, and status computation into the scanner

**Files:**
- Modify: `src/routes/_authenticated/scanner.tsx`

**Interfaces:**
- Consumes: `resolveEffectiveShift` (Task 2), `computeCheckInStatus`, `isPastShiftEnd`, `cooldownRemainingMs` (Task 1), `ScanBlock`, `ScanBlockedOverlay` (Task 4).

- [ ] **Step 1: Add the new imports**

In `src/routes/_authenticated/scanner.tsx`, add these imports alongside the existing ones (after the `RoleGuard` import at line 25):

```ts
import { resolveEffectiveShift } from "@/lib/resolve-shift";
import { computeCheckInStatus, isPastShiftEnd, cooldownRemainingMs } from "@/lib/shift-time";
import { ScanBlockedOverlay, type ScanBlock } from "@/components/scan-blocked-overlay";
```

- [ ] **Step 2: Add blocked-overlay state**

Find this line (currently at line 120):

```ts
  const [cameraError, setCameraError] = useState<string | null>(null);
```

Add right after it:

```ts
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ScanBlock | null>(null);
```

- [ ] **Step 3: Replace the shift-lookup and check-in block in `handleDecoded`**

Find this block (currently lines 309–332):

```ts
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
```

Replace it with:

```ts
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
```

- [ ] **Step 4: Replace the "already completed" and add the cooldown check**

Find this block (currently lines 364–374):

```ts
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
```

Replace it with:

```ts
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
```

- [ ] **Step 5: Render the overlay**

Find the closing of the component's returned JSX — the outermost `return (` at line 447, specifically the first line of the returned tree:

```tsx
  return (
    <div className="space-y-4 sm:space-y-6">
```

Replace it with:

```tsx
  return (
    <>
      {blocked && <ScanBlockedOverlay block={blocked} onDismiss={() => setBlocked(null)} />}
      <div className="space-y-4 sm:space-y-6">
```

And find the final closing of that same returned tree (the last two lines of the file, currently):

```tsx
    </div>
  );
}
```

Replace it with:

```tsx
      </div>
    </>
  );
}
```

- [ ] **Step 6: Remove the now-dead "complete" feedback case**

After Step 4, nothing sets `feedback.kind === "complete"` anymore (that path now uses `setBlocked` instead). Find the `Feedback` type near the top of the file (currently lines 36–43):

```ts
type Feedback = {
  kind: "check-in" | "check-out" | "complete" | "error";
  message: string;
  name?: string;
  time?: string;
  hours?: string;
  status?: string;
};
```

Replace it with:

```ts
type Feedback = {
  kind: "check-in" | "check-out" | "error";
  message: string;
  name?: string;
  time?: string;
  hours?: string;
  status?: string;
};
```

Then find the now-unreachable branch in `FeedbackPanel` (currently):

```tsx
      ) : feedback.kind === "complete" ? (
        <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
          <div className="flex items-center gap-2 text-warning"><AlertTriangle className="h-5 w-5" /><span className="font-semibold">{feedback.message}</span></div>
          <p className="text-2xl font-semibold">{feedback.name}</p>
          {feedback.time && <p className="text-sm text-muted-foreground">Checked out at {feedback.time}</p>}
        </div>
      ) : (
```

Replace it with:

```tsx
      ) : (
```

- [ ] **Step 7: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p .`
Expected: no new errors introduced by this file (the two pre-existing `users.functions.ts` errors from before this plan are unrelated and unaffected).

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authenticated/scanner.tsx
git commit -m "Add 1-hour scan cooldown and shift-over check-in block to scanner"
```

---

### Task 6: Auto-checkout cron server route

**Files:**
- Create: `src/routes/api/cron/auto-checkout.ts`
- Modify: `.env` (add `CRON_SECRET`)

**Interfaces:**
- Consumes: `resolveEffectiveShift` (Task 2), `isAutoCheckoutDue`, `autoCheckoutDeadline` (Task 1).
- Produces: `GET /api/cron/auto-checkout` HTTP endpoint returning `{ closed: number }` JSON. Task 7's `vercel.json` schedules calls to this exact path.

- [ ] **Step 1: Generate and add the cron secret**

Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Add the printed value to `.env` (create the line if missing) as:

```
CRON_SECRET="<paste generated value here>"
```

- [ ] **Step 2: Write the server route**

Create `src/routes/api/cron/auto-checkout.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { resolveEffectiveShift } from "@/lib/resolve-shift";
import { isAutoCheckoutDue, autoCheckoutDeadline } from "@/lib/shift-time";

export const Route = createFileRoute("/api/cron/auto-checkout")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const today = format(new Date(), "yyyy-MM-dd");
        const now = new Date();

        const { data: openRows, error } = await supabaseAdmin
          .from("attendance")
          .select("id, student_id")
          .eq("date", today)
          .not("check_in", "is", null)
          .is("check_out", null);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        let closed = 0;
        for (const row of openRows ?? []) {
          const shift = await resolveEffectiveShift(supabaseAdmin, row.student_id, today);
          if (!isAutoCheckoutDue(now, shift, now)) continue;
          const checkOut = autoCheckoutDeadline(shift, now);
          const { error: updateErr } = await supabaseAdmin
            .from("attendance")
            .update({ check_out: checkOut.toISOString() })
            .eq("id", row.id);
          if (!updateErr) closed += 1;
        }

        return Response.json({ closed });
      },
    },
  },
});
```

- [ ] **Step 3: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p .`
Expected: no new errors from this file.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/cron/auto-checkout.ts
git commit -m "Add auto-checkout cron endpoint for stale attendance rows"
```

(`.env` is gitignored and is not part of this commit — confirm with `git status --short` that it doesn't appear.)

---

### Task 7: Vercel Cron schedule

**Files:**
- Create: `vercel.json`

**Interfaces:**
- Consumes: the `/api/cron/auto-checkout` path from Task 6.

- [ ] **Step 1: Write the cron config**

```json
{
  "crons": [
    {
      "path": "/api/cron/auto-checkout",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "Schedule auto-checkout cron every 15 minutes on Vercel"
```

- [ ] **Step 3: Add CRON_SECRET to Vercel (user action required)**

In the Vercel dashboard, Project → Settings → Environment Variables, add `CRON_SECRET` with the same value generated in Task 6 Step 1. Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when it invokes a scheduled Cron Job if this env var is set, which is exactly what the route in Task 6 checks against.

---

### Task 8: End-to-end verification and push

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: all `shift-time.test.ts` cases pass, no other test files exist yet to fail.

- [ ] **Step 2: Full project typecheck**

Run: `node_modules/.bin/tsc --noEmit -p .`
Expected: only the same two pre-existing `users.functions.ts` errors seen before this plan (confirm by comparing output to a `git stash` baseline if unsure) — zero errors from any file touched in this plan.

- [ ] **Step 3: Manual browser verification of the scanner**

Start the dev server (`npm run dev` or `bun run dev`), open `/scanner`, and using a real employee QR code, verify each state by temporarily editing that employee's assigned shift via the `/shifts` admin page to a start/end time bracketing the current clock time (or wait for real time to cross a boundary):
- Scan before the late cutoff → check-in recorded, feedback shows "Check-In Successful" with no "Late" badge.
- Scan after the late cutoff but before shift end → check-in recorded with "Late" badge.
- Immediately re-scan the same employee (within 1 hour of check-in) → full-screen "Checked in recently" overlay appears, no `check_out` written (verify in the `/attendance` admin page that `check_out` is still null).
- Adjust the employee's shift `end_time` to a few minutes in the past, then scan → full-screen "Shift is over — cannot check in" overlay, no attendance row created.
- After a genuine check-out, re-scan the same employee → full-screen "Attendance already completed today" overlay.

- [ ] **Step 4: Manual verification of the cron endpoint**

With the dev server running and `CRON_SECRET` set in `.env`:

```bash
curl -i http://localhost:8080/api/cron/auto-checkout
```

Expected: `401 Unauthorized` (no auth header sent).

```bash
curl -i http://localhost:8080/api/cron/auto-checkout -H "Authorization: Bearer $(grep CRON_SECRET .env | cut -d'"' -f2)"
```

Expected: `200 OK` with JSON body `{"closed":N}`. To verify it actually closes a stale row: manually insert (or edit via `/attendance`) a today's attendance row with a `check_in` and no `check_out` for an employee whose effective shift's `end_time + 2h` is already in the past, run the curl command again, and confirm in `/attendance` that `check_out` is now set to exactly `end_time + 2h` for that shift.

- [ ] **Step 5: Push to origin**

```bash
git push origin main
```
