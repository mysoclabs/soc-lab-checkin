import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { gradeAttempt, shuffle, type AnswerValue, type GradableQuestion } from "@/lib/assessment-grading";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabaseAdmin as any;

type Ctx = { userId: string; email: string };

export async function listMine(ctx: Ctx) {
  const { data: asg, error } = await db()
    .from("assessment_assignments")
    .select("assessment_id, assessments!inner(id,title,description,department,duration_minutes,status,due_at,available_from,passing_percentage,settings)")
    .ilike("email", ctx.email);
  if (error) throw new Error(error.message);
  const list = (asg ?? []).map((r: any) => r.assessments).filter((a: any) => a.status !== "draft");
  const ids = list.map((a: any) => a.id);
  const counts: Record<string, number> = {};
  const attempts: Record<string, any> = {};
  if (ids.length) {
    const { data: qs } = await db().from("assessment_questions").select("assessment_id").in("assessment_id", ids);
    for (const q of qs ?? []) counts[q.assessment_id] = (counts[q.assessment_id] ?? 0) + 1;
    const { data: at } = await db()
      .from("assessment_attempts")
      .select("id,assessment_id,status,started_at,submitted_at,score,max_score,percentage,passed,time_taken_seconds,pending_review_count")
      .eq("user_id", ctx.userId)
      .in("assessment_id", ids);
    for (const a of at ?? []) attempts[a.assessment_id] = a;
  }
  return list.map((a: any) => ({ ...a, question_count: counts[a.id] ?? 0, attempt: attempts[a.id] ?? null }));
}

async function loadAssigned(ctx: Ctx, assessmentId: string) {
  const { data: asg } = await db()
    .from("assessment_assignments").select("id").eq("assessment_id", assessmentId).ilike("email", ctx.email).maybeSingle();
  if (!asg) throw new Error("This assessment is not assigned to you");
  const { data: a, error } = await db().from("assessments").select("*").eq("id", assessmentId).single();
  if (error || !a) throw new Error("Assessment not found");
  if (a.status === "draft") throw new Error("Assessment is not published");
  return a;
}

async function loadQuestions(assessmentId: string) {
  const { data, error } = await db().from("assessment_questions").select("*").eq("assessment_id", assessmentId).order("position");
  if (error) throw new Error(error.message);
  return data ?? [];
}

function publicView(a: any, attempt: any, questions: any[]) {
  const byId = new Map(questions.map((q: any) => [q.id, q]));
  const ordered = (attempt.question_order as string[]).map((id) => byId.get(id)).filter(Boolean);
  return {
    assessment: { id: a.id, title: a.title, instructions: a.instructions, duration_minutes: a.duration_minutes, settings: a.settings },
    attempt: {
      id: attempt.id, status: attempt.status, started_at: attempt.started_at, answers: attempt.answers,
      marked: attempt.marked, current_index: attempt.current_index, question_times: attempt.question_times,
    },
    questions: ordered.map((q: any) => {
      const order: string[] | undefined = attempt.option_order?.[q.id];
      const opts = q.options as { id: string; text: string }[];
      const sorted = order ? order.map((id) => opts.find((o) => o.id === id)).filter(Boolean) : opts;
      return { id: q.id, type: q.type, prompt: q.prompt, options: sorted, marks: q.marks, required: q.required, image_url: q.image_url };
    }),
    deadline: new Date(new Date(attempt.started_at).getTime() + a.duration_minutes * 60000).toISOString(),
  };
}

export async function start(ctx: Ctx, assessmentId: string) {
  const a = await loadAssigned(ctx, assessmentId);
  const now = new Date();
  if (a.available_from && new Date(a.available_from) > now) throw new Error("Assessment is not available yet");
  const questions = await loadQuestions(assessmentId);
  let { data: attempt } = await db().from("assessment_attempts").select("*").eq("assessment_id", assessmentId).eq("user_id", ctx.userId).maybeSingle();
  if (!attempt) {
    if (a.due_at && new Date(a.due_at) < now) throw new Error("Assessment has expired");
    if (a.status === "completed") throw new Error("Assessment is closed");
    const s = a.settings ?? {};
    const ids = questions.map((q: any) => q.id);
    const optionOrder: Record<string, string[]> = {};
    if (s.randomize_options) for (const q of questions) if (["mcq", "multi"].includes(q.type)) optionOrder[q.id] = shuffle((q.options ?? []).map((o: any) => o.id));
    const ins = await db().from("assessment_attempts").insert({
      assessment_id: assessmentId, user_id: ctx.userId, email: ctx.email,
      question_order: s.randomize_questions ? shuffle(ids) : ids, option_order: optionOrder,
    }).select("*").single();
    if (ins.error) throw new Error(ins.error.message);
    attempt = ins.data;
    await db().from("assessment_events").insert({ attempt_id: attempt.id, assessment_id: assessmentId, user_id: ctx.userId, type: "started", question_index: 0 });
    await db().from("audit_logs").insert({ user_id: ctx.userId, user_name: ctx.email, action: "Assessment Started", entity: "assessment", entity_id: assessmentId, details: { title: a.title } });
  } else if (attempt.status === "in_progress") {
    await db().from("assessment_events").insert({ attempt_id: attempt.id, assessment_id: assessmentId, user_id: ctx.userId, type: "refresh", question_index: attempt.current_index });
  }
  if (attempt.status === "in_progress") {
    const deadline = new Date(attempt.started_at).getTime() + a.duration_minutes * 60000;
    if (Date.now() > deadline + 15000) {
      await submit(ctx, attempt.id, true);
      return { submitted: true as const, attemptId: attempt.id };
    }
  } else {
    return { submitted: true as const, attemptId: attempt.id };
  }
  return { submitted: false as const, view: publicView(a, attempt, questions) };
}

async function ownAttempt(ctx: Ctx, attemptId: string) {
  const { data } = await db().from("assessment_attempts").select("*").eq("id", attemptId).eq("user_id", ctx.userId).maybeSingle();
  if (!data) throw new Error("Attempt not found");
  return data;
}

export async function save(ctx: Ctx, input: { attemptId: string; answers: Record<string, AnswerValue>; marked: string[]; current_index: number; question_times: Record<string, number> }) {
  const at = await ownAttempt(ctx, input.attemptId);
  if (at.status !== "in_progress") return { ok: false };
  const { error } = await db().from("assessment_attempts").update({
    answers: input.answers, marked: input.marked, current_index: input.current_index, question_times: input.question_times,
  }).eq("id", at.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function logEvent(ctx: Ctx, input: { attemptId: string; type: string; question_index: number | null; duration_seconds: number | null }) {
  const at = await ownAttempt(ctx, input.attemptId);
  if (at.status !== "in_progress") return;
  await db().from("assessment_events").insert({
    attempt_id: at.id, assessment_id: at.assessment_id, user_id: ctx.userId, type: input.type,
    question_index: input.question_index, duration_seconds: input.duration_seconds,
  });
}

export async function recompute(attempt: any) {
  const questions = await loadQuestions(attempt.assessment_id);
  const { data: a } = await db().from("assessments").select("passing_percentage").eq("id", attempt.assessment_id).single();
  const g = gradeAttempt(
    questions.map((q: any) => ({ id: q.id, type: q.type, marks: Number(q.marks), correct: q.correct ?? [] })) as GradableQuestion[],
    attempt.answers ?? {}, attempt.manual_marks ?? {},
  );
  const { outcomes: _o, ...fields } = g;
  return { ...fields, passed: g.pending_review_count === 0 ? g.percentage >= Number(a?.passing_percentage ?? 0) : null };
}

export async function submit(ctx: Ctx, attemptId: string, auto = false) {
  const at = await ownAttempt(ctx, attemptId);
  if (at.status !== "in_progress") return { attemptId };
  const fields = await recompute(at);
  const now = new Date();
  const { data: a } = await db().from("assessments").select("duration_minutes,title").eq("id", at.assessment_id).single();
  const taken = Math.min(Math.round((now.getTime() - new Date(at.started_at).getTime()) / 1000), (a?.duration_minutes ?? 0) * 60);
  await db().from("assessment_attempts").update({ ...fields, status: "submitted", submitted_at: now.toISOString(), time_taken_seconds: taken }).eq("id", at.id);
  await db().from("assessment_events").insert({ attempt_id: at.id, assessment_id: at.assessment_id, user_id: ctx.userId, type: auto ? "auto_submitted" : "submitted", question_index: at.current_index });
  await db().from("audit_logs").insert({ user_id: ctx.userId, user_name: ctx.email, action: "Assessment Submitted", entity: "assessment", entity_id: at.assessment_id, details: { title: a?.title, percentage: fields.percentage } });
  return { attemptId };
}

export async function result(ctx: Ctx, attemptId: string) {
  const at = await ownAttempt(ctx, attemptId);
  if (at.status !== "submitted") throw new Error("Assessment not yet submitted");
  const { data: a } = await db().from("assessments").select("id,title,settings,passing_percentage").eq("id", at.assessment_id).single();
  const questions = await loadQuestions(at.assessment_id);
  const g = gradeAttempt(questions.map((q: any) => ({ id: q.id, type: q.type, marks: Number(q.marks), correct: q.correct ?? [] })), at.answers ?? {}, at.manual_marks ?? {});
  const showCorrect = !!a?.settings?.show_results;
  return {
    assessment: { title: a?.title, passing_percentage: a?.passing_percentage, show_correct: showCorrect },
    attempt: {
      score: at.score, max_score: at.max_score, percentage: at.percentage, correct_count: at.correct_count, wrong_count: at.wrong_count,
      skipped_count: at.skipped_count, pending_review_count: at.pending_review_count, time_taken_seconds: at.time_taken_seconds, passed: at.passed, submitted_at: at.submitted_at,
    },
    review: questions.map((q: any, i: number) => ({
      index: i + 1, prompt: q.prompt, type: q.type, options: q.options, marks: q.marks,
      answer: at.answers?.[q.id] ?? null, outcome: g.outcomes[q.id], awarded: at.manual_marks?.[q.id] ?? null,
      correct: showCorrect ? q.correct : null,
    })),
  };
}
