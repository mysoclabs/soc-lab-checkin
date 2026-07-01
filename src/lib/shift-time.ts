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
