import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const answerVal = z.union([z.string().max(10000), z.array(z.string().max(200)).max(50), z.null()]);

export const listMyAssessments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const m = await import("@/lib/assessments.server");
    const email = (context.claims as { email?: string }).email ?? "";
    return m.listMine({ userId: context.userId, email });
  });

export const startAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ assessmentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/assessments.server");
    const email = (context.claims as { email?: string }).email ?? "";
    return m.start({ userId: context.userId, email }, data.assessmentId);
  });

export const saveAssessmentProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      attemptId: z.string().uuid(),
      answers: z.record(z.string(), answerVal),
      marked: z.array(z.string()).max(500),
      current_index: z.number().int().min(0),
      question_times: z.record(z.string(), z.number().min(0)),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/assessments.server");
    const email = (context.claims as { email?: string }).email ?? "";
    return m.save({ userId: context.userId, email }, data);
  });

export const logAssessmentEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      attemptId: z.string().uuid(),
      type: z.enum(["focus_lost", "focus_returned", "copy", "paste", "right_click", "refresh"]),
      question_index: z.number().int().nullable(),
      duration_seconds: z.number().int().min(0).nullable(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/assessments.server");
    const email = (context.claims as { email?: string }).email ?? "";
    await m.logEvent({ userId: context.userId, email }, data);
    return { ok: true };
  });

export const submitAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ attemptId: z.string().uuid(), auto: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/assessments.server");
    const email = (context.claims as { email?: string }).email ?? "";
    return m.submit({ userId: context.userId, email }, data.attemptId, !!data.auto);
  });

export const getMyAssessmentResult = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ attemptId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/assessments.server");
    const email = (context.claims as { email?: string }).email ?? "";
    return m.result({ userId: context.userId, email }, data.attemptId);
  });

/** Admin: save theory marks and recompute the attempt's score. */
export const gradeTheoryAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ attemptId: z.string().uuid(), manual_marks: z.record(z.string(), z.number().min(0)) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "super_admin" } as never);
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const m = await import("@/lib/assessments.server");
    const db = supabaseAdmin as any;
    const { data: at } = await db.from("assessment_attempts").select("*").eq("id", data.attemptId).single();
    if (!at) throw new Error("Attempt not found");
    const fields = await m.recompute({ ...at, manual_marks: data.manual_marks });
    await db.from("assessment_attempts").update({ ...fields, manual_marks: data.manual_marks }).eq("id", at.id);
    return { ok: true };
  });
