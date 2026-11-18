import { supabase } from "@/integrations/supabase/client";
// Assessment tables are accessed via an untyped handle until generated types catch up.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const adb = supabase as any;

export type Assessment = {
  id: string; title: string; description: string | null; department: string | null; instructions: string | null;
  duration_minutes: number; passing_percentage: number; status: string;
  settings: { randomize_questions: boolean; randomize_options: boolean; allow_previous: boolean; auto_submit: boolean; show_results: boolean };
  available_from: string | null; due_at: string | null; created_at: string; published_at: string | null;
};
export type Question = {
  id: string; assessment_id: string; position: number; type: "mcq" | "multi" | "truefalse" | "short" | "theory";
  prompt: string; options: { id: string; text: string }[]; correct: string[]; marks: number; required: boolean; image_url: string | null;
};

export const TYPE_LABELS: Record<Question["type"], string> = {
  mcq: "Multiple Choice", multi: "Multiple Select", truefalse: "True / False", short: "Short Answer", theory: "Theory",
};

export function fmtDuration(sec: number | null | undefined) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
