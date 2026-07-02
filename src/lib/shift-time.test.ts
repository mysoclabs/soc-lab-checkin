// Forces the entire test file to run under a host timezone that is NOT
// Asia/Kolkata, so every test below genuinely exercises the Asia/Kolkata-
// explicit conversion logic in `shift-time.ts` instead of accidentally
// passing because the test runner's own host happens to already be
// Asia/Kolkata. Must run before any Date/Intl use in this file (bun and
// node both read TZ lazily on first use, not once at process startup, so
// this takes effect even though the import statements below are hoisted).
process.env.TZ = "UTC";

import { describe, test, expect } from "bun:test";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
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

/**
 * Builds the real UTC instant corresponding to 2026-07-01 h:m:s read as an
 * Asia/Kolkata wall clock, regardless of the host process's own local
 * timezone. Using a bare `new Date(2026, 6, 1, h, m, s)` here would make
 * every assertion below depend on whatever timezone the test runner's host
 * happens to be set to (which is exactly the blind spot that let the
 * original host-local-time bug in `timeOnDate` through review undetected).
 */
function at(h: number, m: number, s = 0) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return fromZonedTime(`2026-07-01T${pad(h)}:${pad(m)}:${pad(s)}`, "Asia/Kolkata");
}

describe("timeOnDate", () => {
  test("combines a reference date with a HH:MM:SS time", () => {
    // Read back via Asia/Kolkata-explicit formatting, not host-local getters:
    // `.getFullYear()`/`.getHours()`/etc. report the *host's* local time-of-day,
    // which is wrong here regardless of which `timeOnDate` implementation is
    // under test (this file now forces TZ=UTC, so host-local getters would
    // read back 03:00, not 08:30).
    const result = timeOnDate(at(0, 0), "08:30:00");
    expect(formatInTimeZone(result, "Asia/Kolkata", "yyyy-MM-dd'T'HH:mm:ss")).toBe(
      "2026-07-01T08:30:00",
    );
  });

  test("accepts HH:MM without seconds", () => {
    const result = timeOnDate(at(0, 0), "16:30");
    expect(formatInTimeZone(result, "Asia/Kolkata", "HH:mm")).toBe("16:30");
  });

  // Regression test for the original bug: `timeOnDate` used to build wall-clock
  // times via `Date.setHours()`, which resolves against the *host process's*
  // local timezone. That's correct when the process happens to run in
  // Asia/Kolkata (e.g. a developer's machine or the browser), but wrong on a
  // host set to any other zone (e.g. Vercel's serverless functions, which
  // default to UTC).
  //
  // This test compares against a manually-computed, absolute UTC instant for
  // a known IST wall-clock time, so it pins the correct answer independent of
  // host TZ. Belt-and-suspenders with the `process.env.TZ = "UTC"` line at the
  // top of this file: that line forces every test in the file (including this
  // one) to run under a non-Kolkata host TZ, which is what actually gives this
  // test teeth — without it, this assertion would pass under the old buggy
  // `setHours`-based implementation too, as long as the runner's host happened
  // to already be Asia/Kolkata.
  test("resolves 08:30 IST to the correct absolute UTC instant, independent of host TZ", () => {
    const referenceDate = new Date("2026-07-01T00:00:00.000Z");
    const result = timeOnDate(referenceDate, "08:30:00");
    // 08:30 IST (UTC+5:30) on 2026-07-01 == 2026-07-01T03:00:00.000Z
    expect(result.toISOString()).toBe("2026-07-01T03:00:00.000Z");
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
    // Read back via Asia/Kolkata-explicit formatting (see comment above), not
    // host-local getters.
    const deadline = autoCheckoutDeadline(GENERAL, at(0, 0));
    expect(formatInTimeZone(deadline, "Asia/Kolkata", "HH:mm")).toBe("18:30");
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
