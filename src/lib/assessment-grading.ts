export type QuestionType = "mcq" | "multi" | "truefalse" | "short" | "theory";
export type Option = { id: string; text: string };
export type GradableQuestion = {
  id: string;
  type: QuestionType;
  marks: number;
  correct: string[]; // option ids, "true"/"false", or accepted short answers
};
export type AnswerValue = string | string[] | null | undefined;

export type QuestionOutcome = "correct" | "wrong" | "skipped" | "pending";

export function normalizeText(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isAnswered(a: AnswerValue): boolean {
  if (a == null) return false;
  if (Array.isArray(a)) return a.length > 0;
  return a.trim().length > 0;
}

export function evaluateQuestion(q: GradableQuestion, a: AnswerValue): QuestionOutcome {
  if (!isAnswered(a)) return "skipped";
  switch (q.type) {
    case "theory":
      return "pending";
    case "mcq":
    case "truefalse":
      return typeof a === "string" && q.correct.includes(a) ? "correct" : "wrong";
    case "multi": {
      const picked = new Set(Array.isArray(a) ? a : [a as string]);
      const want = new Set(q.correct);
      if (picked.size !== want.size) return "wrong";
      for (const p of picked) if (!want.has(p)) return "wrong";
      return "correct";
    }
    case "short": {
      const v = normalizeText(String(a));
      return q.correct.some((c) => normalizeText(c) === v) ? "correct" : "wrong";
    }
  }
}

export type GradeResult = {
  score: number;
  max_score: number;
  percentage: number;
  correct_count: number;
  wrong_count: number;
  skipped_count: number;
  pending_review_count: number;
  outcomes: Record<string, QuestionOutcome>;
};

/** manualMarks: marks awarded by admin to theory questions, keyed by question id. */
export function gradeAttempt(
  questions: GradableQuestion[],
  answers: Record<string, AnswerValue>,
  manualMarks: Record<string, number> = {},
): GradeResult {
  let score = 0, max = 0, c = 0, w = 0, s = 0, p = 0;
  const outcomes: Record<string, QuestionOutcome> = {};
  for (const q of questions) {
    const m = Number(q.marks) || 0;
    max += m;
    const o = evaluateQuestion(q, answers[q.id]);
    outcomes[q.id] = o;
    if (o === "correct") { c++; score += m; }
    else if (o === "wrong") w++;
    else if (o === "skipped") s++;
    else {
      if (manualMarks[q.id] != null) {
        const awarded = Math.max(0, Math.min(m, Number(manualMarks[q.id])));
        score += awarded;
        if (awarded > 0) c++; else w++;
      } else p++;
    }
  }
  const percentage = max > 0 ? Math.round((score / max) * 10000) / 100 : 0;
  return { score, max_score: max, percentage, correct_count: c, wrong_count: w, skipped_count: s, pending_review_count: p, outcomes };
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type AssessmentStatus = "draft" | "published" | "completed" | "expired";
export function effectiveStatus(a: { status: string; due_at: string | null }, now = new Date()): AssessmentStatus {
  if (a.status === "draft") return "draft";
  if (a.status === "completed") return "completed";
  if (a.due_at && new Date(a.due_at) < now) return "expired";
  return "published";
}

export const EVENT_LABELS: Record<string, string> = {
  started: "Assessment Started",
  focus_lost: "Focus Lost",
  focus_returned: "Focus Returned",
  copy: "Copy Attempt",
  paste: "Paste Attempt",
  right_click: "Right Click Attempt",
  refresh: "Refresh Attempt",
  submitted: "Assessment Submitted",
  auto_submitted: "Auto Submitted (Timer)",
};
