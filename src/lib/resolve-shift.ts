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
