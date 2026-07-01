# Attendance Scan Cooldown & Shift Time Windows

## Problem

The QR scanner (`src/routes/_authenticated/scanner.tsx`) only debounces the
*same QR code string* for 3 seconds to avoid the camera library firing
`handleDecoded` twice for one physical scan. It has no cooldown between a
check-in and a later re-scan. If an employee scans again shortly after
checking in (glare, curiosity, camera still pointed at the badge), the app
treats it as a check-out and writes `check_out ≈ check_in`, producing a
0.00-hours attendance record.

Separately, check-in has no time-of-day enforcement beyond marking a
"late" status — an employee can check in at any hour, and there's no way
to stop someone checking in long after their shift has ended, or to close
out someone who forgets to check out at all.

## Goals

1. Stop the false-checkout bug with a real cooldown after any successful scan.
2. Enforce shift time windows: on-time / late at check-in, and a hard block
   on check-in once the shift has ended.
3. Auto-close attendance for anyone who never scans out, after a grace period.

## Non-goals

- No change to the `shifts` / `employee_shifts` schema — both already carry
  `start_time`, `end_time`, `late_cutoff_minutes`, and per-employee shift
  overrides via the existing `/shifts` admin page. This work only changes
  the seeded default shift's *values* and the scanner's/cron's *logic*.
- No new table for cooldown tracking — it's derived from the existing
  `attendance.check_in` / `check_out` timestamps for today's row.
- No changes to manual admin check-out (`attendance.tsx`'s existing
  "check out" button) — that remains an unconditional admin override.

## Design

### A) Default shift data

Migration updates the seeded "General" default shift row:

| Field | Old | New |
|---|---|---|
| `start_time` | 09:30 | 08:30 |
| `end_time` | 18:30 | 16:30 |
| `late_cutoff_minutes` | 0 | 10 |

Effect: present through 8:39:59, late from 8:40 onward; check-in blocked
from 16:30:01 onward. Employees with a custom `employee_shifts` row keep
using their assigned shift's own times — untouched by this change, since
the scanner already resolves the employee's assigned shift before falling
back to the default.

### B) Scanner logic (`scanner.tsx`)

In `handleDecoded`, after resolving the employee's effective shift and
before branching on whether an attendance row exists for today:

1. **Shift-over block (check-in only):** if there is no existing row for
   today and `now > shift.end_time` (today's date + shift's `end_time`),
   show the full-screen block "Shift is over — cannot check in" and stop.
   Does not apply to check-out.
2. **Cooldown after check-in:** if today's row exists with a `check_in`
   and no `check_out`, and `now - check_in < 1 hour`, show the full-screen
   block "Checked in {mm}m ago — try again after the cooldown" and stop
   (instead of writing a check-out).
3. **Cooldown after check-out:** if today's row exists with a `check_out`
   and `now - check_out < 1 hour`, show the full-screen block "Attendance
   already completed today" and stop. (Replaces the current inline
   "complete" card with a full-screen version for consistency with the
   other two block cases.)

All three reuse one new component, `ScanBlockedOverlay`: a fixed,
viewport-covering overlay (works whether or not the camera is in its own
fullscreen mode), auto-dismisses after ~4 seconds or on tap, styled
consistently with the existing success/error flash patterns already in
this file.

### C) Auto-checkout (Vercel Cron)

New file `src/routes/api/cron/auto-checkout.ts`, using this TanStack Start
version's file-based server routes (`server.handlers` on `createFileRoute`
— confirmed supported via the framework's bundled
`start-core/server-routes` skill doc):

```ts
export const Route = createFileRoute("/api/cron/auto-checkout")({
  server: {
    handlers: {
      GET: async ({ request }) => { /* ... */ },
    },
  },
});
```

Handler behavior:

1. Reject if the `Authorization` header doesn't match `Bearer ${process.env.CRON_SECRET}`.
2. Using the service-role client, select today's `attendance` rows where
   `check_in IS NOT NULL AND check_out IS NULL`.
3. For each row, resolve the employee's effective shift the same way the
   scanner does (assigned `employee_shifts` row effective as of today, else
   the default shift).
4. If `now > shift.end_time + 2 hours`, set
   `check_out = shift.end_time + 2 hours` (deterministic — not "whenever
   the cron happened to run").
5. Return a small JSON summary (`{ closed: number }`) for observability.

`vercel.json` at the repo root schedules this endpoint every 15 minutes:

```json
{
  "crons": [{ "path": "/api/cron/auto-checkout", "schedule": "*/15 * * * *" }]
}
```

`CRON_SECRET` is a new env var (Vercel project settings + local `.env`,
never committed) used only to authenticate the cron caller.

### D) Testing

- Pure, unit-testable helper functions for: resolving effective shift end
  time, present-vs-late computation, cooldown-remaining computation, and
  auto-checkout eligibility — kept free of Supabase calls so they can be
  tested with fixed clock values instead of waiting on real time.
- Manual verification in the running app: temporarily edit the default
  shift's times via the `/shifts` admin page (or query args) to values near
  the current clock, then walk through each blocked state (early/on-time/
  late check-in, shift-over block, in-cooldown re-scan, post-cooldown
  check-out) in the browser.
- Hit `/api/cron/auto-checkout` directly with `curl` (correct and
  incorrect `Authorization` header) to confirm the auth check and the
  auto-close logic against a manually-seeded stale attendance row.

## Open questions

None — all business-rule ambiguities were resolved during design (early
check-in allowed, check-in cutoff is exactly shift end with no buffer,
auto-checkout at shift end + 2h flat).
