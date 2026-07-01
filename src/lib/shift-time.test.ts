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
