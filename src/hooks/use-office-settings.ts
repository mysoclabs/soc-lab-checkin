import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OfficeSettings = {
  id: number;
  office_start_time: string; // HH:MM:SS
  office_end_time: string;
  working_hours: number;
  grace_period_minutes: number;
  late_threshold: string;
  half_day_threshold: string;
};

export const DEFAULT_OFFICE_SETTINGS: OfficeSettings = {
  id: 1,
  office_start_time: "09:30:00",
  office_end_time: "18:30:00",
  working_hours: 8,
  grace_period_minutes: 15,
  late_threshold: "09:45:00",
  half_day_threshold: "11:00:00",
};

export function useOfficeSettings() {
  return useQuery({
    queryKey: ["office-settings"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("office_settings").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return (data as OfficeSettings | null) ?? DEFAULT_OFFICE_SETTINGS;
    },
  });
}

/** Format HH:MM:SS time string as "9:30 AM". */
export function formatTimeStr(t: string) {
  const [hh, mm] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Build a Date for today at the given HH:MM[:SS] time. */
export function timeOnDate(time: string, base: Date = new Date()) {
  const [hh, mm, ss] = time.split(":").map(Number);
  const d = new Date(base);
  d.setHours(hh, mm, ss ?? 0, 0);
  return d;
}
