import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canDeletePip,
  canEditPipBasics,
  canChangePipStatus,
  canManagePipGoals,
  canPublishPip,
  PIP_STATUSES,
  type PipAccessRecord,
  type PipRole,
  type PipStatus,
} from "@/lib/pip-permissions";

type PIPDb = SupabaseClient<Database>;
type AuthContext = { supabase: PIPDb; userId: string; claims: unknown };

const idSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const focusSchema = z.array(z.string().trim().min(1).max(80)).max(10);
const goalSchema = z.object({
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(1200).nullable().optional(),
  kpi: z.string().trim().min(1).max(180),
  target: z.string().trim().min(1).max(180),
  weight: z.number().min(0).max(100),
  due_date: dateSchema.nullable().optional(),
  supporting_evidence: z.string().trim().max(2000).nullable().optional(),
});

const createPipSchema = z.object({
  employeeId: idSchema,
  startDate: dateSchema,
  durationDays: z.number().int().min(1).max(365),
  endDate: dateSchema,
  reviewFrequencyDays: z.number().int().min(1).max(365),
  focusAreas: focusSchema,
  performanceConcerns: z.string().trim().min(1).max(5000),
  goals: z.array(goalSchema).max(30),
});

const updatePipSchema = z.object({
  pipId: idSchema,
  startDate: dateSchema,
  durationDays: z.number().int().min(1).max(365),
  endDate: dateSchema,
  reviewFrequencyDays: z.number().int().min(1).max(365),
  focusAreas: focusSchema,
  performanceConcerns: z.string().trim().min(1).max(5000),
});

const goalMutationSchema = goalSchema.extend({
  pipId: idSchema,
  goalId: idSchema.optional(),
  description: z.string().trim().max(1200).nullable().optional(),
  due_date: dateSchema.nullable().optional(),
  supporting_evidence: z.string().trim().max(2000).nullable().optional(),
  progress_percent: z.number().int().min(0).max(100).optional(),
  status: z.enum(["not_started", "in_progress", "complete"]).optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  shared_feedback: z.string().trim().max(2000).nullable().optional(),
});

const checkinSchema = z.object({
  pipId: idSchema,
  checkinId: idSchema.optional(),
  scheduledDate: dateSchema,
  completed: z.boolean(),
  progressPercent: z.number().int().min(0).max(100),
  rating: z.number().int().min(1).max(5).nullable(),
  sharedSummary: z.string().trim().max(2000).nullable(),
  hrFeedback: z.string().trim().max(2000).nullable(),
});

const noteSchema = z.object({
  pipId: idSchema,
  checkinId: idSchema.optional(),
  note: z.string().trim().min(1).max(3000),
});

const statusSchema = z.object({
  pipId: idSchema,
  status: z.enum(PIP_STATUSES),
  reason: z.string().trim().max(1000).nullable().optional(),
  endDate: dateSchema.optional(),
});

async function requirePipAdmin(context: AuthContext): Promise<PipRole> {
  const [{ data: isSuperAdmin, error: superError }, { data: isHrAdmin, error: hrError }] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "super_admin" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "hr_admin" }),
  ]);
  if (superError || hrError) throw new Error("Unable to verify PIP access");
  if (isSuperAdmin) return "super_admin";
  if (isHrAdmin) return "hr_admin";
  throw new Error("Only Super Admin and HR Admin can manage PIPs");
}

async function loadManageablePip(
  db: PIPDb,
  role: PipRole,
  userId: string,
  pipId: string,
): Promise<PipAccessRecord> {
  let query = db.from("pip_records").select("status, hr_owner_user_id, employee_email").eq("id", pipId);
  if (role === "hr_admin") query = query.eq("hr_owner_user_id", userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("PIP not found or you do not have access");
  return data as PipAccessRecord;
}

async function writePipAudit(
  db: PIPDb,
  context: AuthContext,
  action: string,
  pipId: string,
  details: Record<string, unknown>,
) {
  const claims = context.claims as { email?: string } | undefined;
  const { getClientIp } = await import("@/lib/request.server");
  const { error } = await db.from("audit_logs").insert({
    user_id: context.userId,
    user_name: claims?.email ?? null,
    action,
    entity: "pip",
    entity_id: pipId,
    details,
    ip_address: getClientIp(),
  });
  if (error) console.error("PIP audit entry failed", error.message);
}

export const createPip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createPipSchema.parse(data))
  .handler(async ({ data, context }) => {
    const role = await requirePipAdmin(context);
    const { data: employee, error: employeeError } = await context.supabase
      .from("students")
      .select("id, name, email, department, designation")
      .eq("id", data.employeeId)
      .single();
    if (employeeError || !employee) throw new Error("Choose an existing employee");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const claims = context.claims as { email?: string } | undefined;
    const ownerEmail = claims?.email ?? "";
    const { data: pip, error } = await supabaseAdmin.from("pip_records").insert({
      employee_id: employee.id,
      employee_name: employee.name,
      employee_email: employee.email,
      department: employee.department,
      designation: employee.designation,
      hr_owner_user_id: context.userId,
      hr_owner_email: ownerEmail,
      created_by: context.userId,
      start_date: data.startDate,
      duration_days: data.durationDays,
      end_date: data.endDate,
      review_frequency_days: data.reviewFrequencyDays,
      focus_areas: data.focusAreas,
      performance_concerns: data.performanceConcerns,
      status: "draft",
    }).select("id").single();
    if (error || !pip) throw new Error(error?.message ?? "Unable to create PIP");
    if (data.goals.length > 0) {
      const { error: goalsError } = await supabaseAdmin.from("pip_goals").insert(
        data.goals.map((goal, position) => ({
          ...goal,
          pip_id: pip.id,
          created_by: context.userId,
          position,
          description: goal.description ?? null,
          due_date: goal.due_date ?? null,
          supporting_evidence: goal.supporting_evidence ?? null,
        })),
      );
      if (goalsError) throw new Error(goalsError.message);
    }
    await writePipAudit(supabaseAdmin, context, "pip_created", pip.id, {
      employee_name: employee.name,
      employee_email: employee.email,
      created_by_role: role,
    });
    return { id: pip.id };
  });

export const updatePip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updatePipSchema.parse(data))
  .handler(async ({ data, context }) => {
    const role = await requirePipAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadManageablePip(supabaseAdmin, role, context.userId, data.pipId);
    if (!canEditPipBasics(role, context.userId, pip)) throw new Error("Only the assigned HR Admin can edit a draft; Super Admin can edit any PIP");
    const { error } = await supabaseAdmin.from("pip_records").update({
      start_date: data.startDate,
      duration_days: data.durationDays,
      end_date: data.endDate,
      review_frequency_days: data.reviewFrequencyDays,
      focus_areas: data.focusAreas,
      performance_concerns: data.performanceConcerns,
    }).eq("id", data.pipId);
    if (error) throw new Error(error.message);
    await writePipAudit(supabaseAdmin, context, "pip_updated", data.pipId, { status: pip.status });
    return { ok: true };
  });

export const publishPip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ pipId: idSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const role = await requirePipAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadManageablePip(supabaseAdmin, role, context.userId, data.pipId);
    if (!canPublishPip(role, context.userId, pip)) throw new Error("Only the assigned HR Admin or Super Admin can publish a draft PIP");
    const { count, error: countError } = await supabaseAdmin
      .from("pip_goals")
      .select("id", { count: "exact", head: true })
      .eq("pip_id", data.pipId);
    if (countError) throw new Error(countError.message);
    if (!count) throw new Error("Add at least one measurable goal before publishing");
    const { error } = await supabaseAdmin.from("pip_records")
      .update({ status: "active", published_at: new Date().toISOString() })
      .eq("id", data.pipId);
    if (error) throw new Error(error.message);
    await writePipAudit(supabaseAdmin, context, "pip_published", data.pipId, {});
    return { ok: true };
  });

export const upsertPipGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => goalMutationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const role = await requirePipAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadManageablePip(supabaseAdmin, role, context.userId, data.pipId);
    if (!canManagePipGoals(role, context.userId, pip)) throw new Error("You cannot edit goals on this PIP");
    const payload = {
      title: data.title,
      description: data.description ?? null,
      kpi: data.kpi,
      target: data.target,
      weight: data.weight,
      due_date: data.due_date ?? null,
      supporting_evidence: data.supporting_evidence ?? null,
      progress_percent: data.progress_percent ?? 0,
      status: data.status ?? "not_started",
      rating: data.rating ?? null,
      shared_feedback: data.shared_feedback ?? null,
    };
    let goalId = data.goalId;
    if (goalId) {
      const { data: existing, error: lookupError } = await supabaseAdmin.from("pip_goals")
        .select("id").eq("id", goalId).eq("pip_id", data.pipId).maybeSingle();
      if (lookupError || !existing) throw new Error("Goal not found");
      const { error } = await supabaseAdmin.from("pip_goals").update(payload).eq("id", goalId);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await supabaseAdmin.from("pip_goals").insert({
        ...payload,
        pip_id: data.pipId,
        created_by: context.userId,
      }).select("id").single();
      if (error || !created) throw new Error(error?.message ?? "Unable to add goal");
      goalId = created.id;
    }
    const { data: goals, error: goalsError } = await supabaseAdmin.from("pip_goals")
      .select("progress_percent").eq("pip_id", data.pipId);
    if (goalsError) throw new Error(goalsError.message);
    const progress = goals?.length
      ? Math.round(goals.reduce((sum, goal) => sum + goal.progress_percent, 0) / goals.length)
      : 0;
    await supabaseAdmin.from("pip_records").update({ progress_percent: progress }).eq("id", data.pipId);
    await writePipAudit(supabaseAdmin, context, data.goalId ? "pip_goal_updated" : "pip_goal_added", data.pipId, {
      goal_id: goalId,
      title: data.title,
    });
    return { ok: true, id: goalId };
  });

export const deletePipGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ pipId: idSchema, goalId: idSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const role = await requirePipAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadManageablePip(supabaseAdmin, role, context.userId, data.pipId);
    if (!canManagePipGoals(role, context.userId, pip)) throw new Error("You cannot remove goals from this PIP");
    const { error } = await supabaseAdmin.from("pip_goals").delete().eq("id", data.goalId).eq("pip_id", data.pipId);
    if (error) throw new Error(error.message);
    const { data: goals } = await supabaseAdmin.from("pip_goals").select("progress_percent").eq("pip_id", data.pipId);
    const progress = goals?.length ? Math.round(goals.reduce((sum, goal) => sum + goal.progress_percent, 0) / goals.length) : 0;
    await supabaseAdmin.from("pip_records").update({ progress_percent: progress }).eq("id", data.pipId);
    await writePipAudit(supabaseAdmin, context, "pip_goal_removed", data.pipId, { goal_id: data.goalId });
    return { ok: true };
  });

export const upsertPipCheckin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => checkinSchema.parse(data))
  .handler(async ({ data, context }) => {
    const role = await requirePipAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadManageablePip(supabaseAdmin, role, context.userId, data.pipId);
    if (!canManagePipGoals(role, context.userId, pip)) throw new Error("You cannot manage reviews for this PIP");
    const payload = {
      scheduled_date: data.scheduledDate,
      completed_at: data.completed ? new Date().toISOString() : null,
      progress_percent: data.progressPercent,
      rating: data.rating,
      shared_summary: data.sharedSummary,
      hr_feedback: data.hrFeedback,
    };
    if (data.checkinId) {
      const { data: existing, error: lookupError } = await supabaseAdmin.from("pip_checkins")
        .select("id").eq("id", data.checkinId).eq("pip_id", data.pipId).maybeSingle();
      if (lookupError || !existing) throw new Error("Review not found");
      const { error } = await supabaseAdmin.from("pip_checkins").update(payload).eq("id", data.checkinId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("pip_checkins").insert({
        ...payload,
        pip_id: data.pipId,
        created_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    await writePipAudit(supabaseAdmin, context, "pip_review_saved", data.pipId, {
      scheduled_date: data.scheduledDate,
      completed: data.completed,
    });
    return { ok: true };
  });

export const addPipInternalNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => noteSchema.parse(data))
  .handler(async ({ data, context }) => {
    const role = await requirePipAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await loadManageablePip(supabaseAdmin, role, context.userId, data.pipId);
    if (data.checkinId) {
      const { data: checkin, error } = await supabaseAdmin.from("pip_checkins")
        .select("id").eq("id", data.checkinId).eq("pip_id", data.pipId).maybeSingle();
      if (error || !checkin) throw new Error("Review not found");
    }
    const claims = context.claims as { email?: string } | undefined;
    const { error } = await supabaseAdmin.from("pip_internal_notes").insert({
      pip_id: data.pipId,
      checkin_id: data.checkinId ?? null,
      note: data.note,
      created_by: context.userId,
      author_email: claims?.email ?? "",
    });
    if (error) throw new Error(error.message);
    await writePipAudit(supabaseAdmin, context, "pip_internal_note_added", data.pipId, {});
    return { ok: true };
  });

export const setPipStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => statusSchema.parse(data))
  .handler(async ({ data, context }) => {
    const role = await requirePipAdmin(context);
    if (!canChangePipStatus(role)) throw new Error("Only Super Admin can change PIP outcomes or duration");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await loadManageablePip(supabaseAdmin, role, context.userId, data.pipId);
    if (["completed", "unsuccessful", "cancelled"].includes(data.status) && !data.reason?.trim()) {
      throw new Error("Add a reason for closing or cancelling this PIP");
    }
    if (data.status === "extended" && !data.endDate) throw new Error("Choose the revised end date");
    const isClosed = ["completed", "unsuccessful", "cancelled"].includes(data.status);
    const update: Database["public"]["Tables"]["pip_records"]["Update"] = {
      status: data.status,
      close_reason: isClosed ? data.reason ?? null : null,
      closed_at: isClosed ? new Date().toISOString() : null,
    };
    if (data.status === "extended" && data.endDate) update.end_date = data.endDate;
    if (data.status === "active") update.published_at = new Date().toISOString();
    const { error } = await supabaseAdmin.from("pip_records").update(update).eq("id", data.pipId);
    if (error) throw new Error(error.message);
    await writePipAudit(supabaseAdmin, context, `pip_status_${data.status}`, data.pipId, {
      reason: data.reason ?? null,
      end_date: data.endDate ?? null,
    });
    return { ok: true };
  });

export const deletePip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ pipId: idSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const role = await requirePipAdmin(context);
    if (!canDeletePip(role)) throw new Error("Only Super Admin can permanently delete PIP records");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pip, error: lookupError } = await supabaseAdmin.from("pip_records")
      .select("employee_name, status").eq("id", data.pipId).maybeSingle();
    if (lookupError || !pip) throw new Error("PIP not found");
    await writePipAudit(supabaseAdmin, context, "pip_deleted", data.pipId, {
      employee_name: pip.employee_name,
      status: pip.status,
    });
    const { error } = await supabaseAdmin.from("pip_records").delete().eq("id", data.pipId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });