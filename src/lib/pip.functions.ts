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
  canReviewPip,
  canViewPip,
  goalWeightsAddUp,
  isPipOwner,
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
  supportProvided: z.string().trim().max(5000).nullable().optional(),
  consequences: z.string().trim().max(5000).nullable().optional(),
  managerUserId: idSchema.nullable().optional(),
  goals: z.array(goalSchema).max(30),
}).refine((data) => goalWeightsAddUp(data.goals.map((goal) => goal.weight)), { message: "Goal weights must total 100%", path: ["goals"] });

const updatePipSchema = z.object({
  pipId: idSchema,
  startDate: dateSchema,
  durationDays: z.number().int().min(1).max(365),
  endDate: dateSchema,
  reviewFrequencyDays: z.number().int().min(1).max(365),
  focusAreas: focusSchema,
  performanceConcerns: z.string().trim().min(1).max(5000),
  supportProvided: z.string().trim().max(5000).nullable().optional(),
  consequences: z.string().trim().max(5000).nullable().optional(),
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

async function getPipRole(context: AuthContext): Promise<PipRole> {
  const [{ data: isSuperAdmin, error: superError }, { data: isHrAdmin, error: hrError }] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "super_admin" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "hr_admin" }),
  ]);
  if (superError || hrError) throw new Error("Unable to verify PIP access");
  return isSuperAdmin ? "super_admin" : isHrAdmin ? "hr_admin" : "employee";
}

async function requirePipAdmin(context: AuthContext): Promise<PipRole> {
  const role = await getPipRole(context);
  if (role === "employee") throw new Error("Only Super Admin and HR Admin can manage PIPs");
  return role;
}

function contextEmail(context: AuthContext) {
  return (context.claims as { email?: string } | undefined)?.email ?? "";
}

// Unfiltered lookup: every caller must check a permission on the returned record.
async function loadPip(db: PIPDb, pipId: string) {
  const { data, error } = await db.from("pip_records")
    .select("id, status, hr_owner_user_id, employee_id, employee_email, employee_name, manager_user_id, start_date, end_date")
    .eq("id", pipId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("PIP not found or you do not have access");
  return { ...data, status: data.status as PipStatus };
}

async function findUserIdByEmail(db: PIPDb, email: string) {
  // shortcut: scans the first 1000 auth users; add a students.user_id column if the company grows past that.
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return null;
  return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

async function resolveManager(db: PIPDb, managerUserId: string | null | undefined, employeeEmail: string) {
  if (!managerUserId) return { manager_user_id: null, manager_email: null };
  const { data, error } = await db.auth.admin.getUserById(managerUserId);
  if (error || !data.user?.email) throw new Error("Choose an existing user as the reporting manager");
  if (data.user.email.toLowerCase() === employeeEmail.toLowerCase()) throw new Error("The employee cannot be their own manager");
  return { manager_user_id: data.user.id, manager_email: data.user.email };
}

// Notifications are best effort: a failed insert must not undo the PIP action that triggered it.
async function notifyUsers(
  db: PIPDb,
  userIds: (string | null | undefined)[],
  note: { type: string; title: string; message?: string; link: string },
) {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (!ids.length) return;
  const { error } = await db.from("notifications").insert(ids.map((user_id) => ({
    audience: "user", user_id, type: note.type, title: note.title, message: note.message ?? null, link: note.link,
  })));
  if (error) console.error("PIP notification failed", error.message);
}

async function loadManageablePip(
  db: PIPDb,
  role: PipRole,
  userId: string,
  pipId: string,
): Promise<PipAccessRecord> {
  let query = db.from("pip_records").select("status, hr_owner_user_id, employee_email, manager_user_id").eq("id", pipId);
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
    const ownerEmail = contextEmail(context);
    const manager = await resolveManager(supabaseAdmin, data.managerUserId, employee.email);
    const { data: pip, error } = await supabaseAdmin.from("pip_records").insert({
      ...manager,
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
      support_provided: data.supportProvided || null,
      consequences: data.consequences || null,
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
      support_provided: data.supportProvided || null,
      consequences: data.consequences || null,
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
    await notifyUsers(supabaseAdmin, [await findUserIdByEmail(supabaseAdmin, pip.employee_email)], {
      type: "pip_published", title: "A Performance Improvement Plan was shared with you", link: "/my-pip",
    });
    await notifyUsers(supabaseAdmin, [pip.manager_user_id], {
      type: "pip_published", title: "You were assigned as manager on a PIP", link: `/pip/${data.pipId}`,
    });
    return { ok: true };
  });

export const upsertPipGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => goalMutationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const role = await getPipRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadPip(supabaseAdmin, data.pipId);
    // The HR owner edits the whole goal; the manager may only update progress on an existing goal.
    const canEditStructure = canManagePipGoals(role, context.userId, pip);
    if (!canEditStructure && !(canReviewPip(role, context.userId, pip) && data.goalId)) throw new Error("You cannot edit goals on this PIP");
    const progressOnly = {
      progress_percent: data.progress_percent ?? 0,
      status: data.status ?? "not_started",
      rating: data.rating ?? null,
      shared_feedback: data.shared_feedback ?? null,
    };
    const payload = canEditStructure ? {
      title: data.title,
      description: data.description ?? null,
      kpi: data.kpi,
      target: data.target,
      weight: data.weight,
      due_date: data.due_date ?? null,
      supporting_evidence: data.supporting_evidence ?? null,
      ...progressOnly,
    } : progressOnly;
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
        title: data.title,
        kpi: data.kpi,
        target: data.target,
        weight: data.weight,
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
    const role = await getPipRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadPip(supabaseAdmin, data.pipId);
    if (!canReviewPip(role, context.userId, pip)) throw new Error("You cannot manage reviews for this PIP");
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
    const { error } = await supabaseAdmin.from("pip_internal_notes").insert({
      pip_id: data.pipId,
      checkin_id: data.checkinId ?? null,
      note: data.note,
      created_by: context.userId,
      author_email: contextEmail(context),
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadPip(supabaseAdmin, data.pipId);
    if (!canChangePipStatus(role, context.userId, pip, data.status)) {
      throw new Error("Only Super Admin can cancel or reopen a PIP");
    }
    if (["completed", "unsuccessful", "cancelled"].includes(data.status) && !data.reason?.trim()) {
      throw new Error("Add a reason for closing or cancelling this PIP");
    }
    if (data.status === "extended" && !data.endDate) throw new Error("Choose the revised end date");
    if (data.status === "extended" && !data.reason?.trim()) throw new Error("Add a reason for extending this PIP");
    const isClosed = ["completed", "unsuccessful", "cancelled"].includes(data.status);
    const update: Database["public"]["Tables"]["pip_records"]["Update"] = {
      status: data.status,
      close_reason: isClosed ? data.reason ?? null : null,
      closed_at: isClosed ? new Date().toISOString() : null,
    };
    if (data.status === "extended" && data.endDate) {
      update.end_date = data.endDate;
      update.duration_days = Math.round((Date.parse(data.endDate) - Date.parse(pip.start_date)) / 86_400_000) + 1;
      update.extension_reason = data.reason ?? null;
    }
    if (data.status === "active") update.published_at = new Date().toISOString();
    const { error } = await supabaseAdmin.from("pip_records").update(update).eq("id", data.pipId);
    if (error) throw new Error(error.message);
    await writePipAudit(supabaseAdmin, context, `pip_status_${data.status}`, data.pipId, {
      reason: data.reason ?? null,
      end_date: data.endDate ?? null,
    });
    if (data.status !== "active") {
      const verb = data.status === "extended" ? "extended" : "closed";
      await notifyUsers(supabaseAdmin, [await findUserIdByEmail(supabaseAdmin, pip.employee_email)], { type: `pip_${data.status}`, title: `Your PIP was ${verb}`, link: "/my-pip" });
      await notifyUsers(supabaseAdmin, [pip.manager_user_id], { type: `pip_${data.status}`, title: `${pip.employee_name}'s PIP was ${verb}`, link: `/pip/${data.pipId}` });
    }
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
export const listPipManagerOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePipAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // shortcut: first 1000 auth users, same limit as findUserIdByEmail.
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw new Error(error.message);
    return data.users
      .flatMap((user) => user.email ? [{ id: user.id, email: user.email }] : [])
      .sort((a, b) => a.email.localeCompare(b.email));
  });

export const setPipManager = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ pipId: idSchema, managerUserId: idSchema.nullable() }).parse(data))
  .handler(async ({ data, context }) => {
    const role = await requirePipAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadPip(supabaseAdmin, data.pipId);
    if (!isPipOwner(role, context.userId, pip)) throw new Error("Only the assigned HR Admin or Super Admin can change the manager");
    const manager = await resolveManager(supabaseAdmin, data.managerUserId, pip.employee_email);
    const { error } = await supabaseAdmin.from("pip_records").update(manager).eq("id", data.pipId);
    if (error) throw new Error(error.message);
    await writePipAudit(supabaseAdmin, context, "pip_manager_changed", data.pipId, { manager_email: manager.manager_email });
    if (pip.status !== "draft") {
      await notifyUsers(supabaseAdmin, [manager.manager_user_id], { type: "pip_manager_assigned", title: "You were assigned as manager on a PIP", link: `/pip/${data.pipId}` });
    }
    return { ok: true };
  });

export const addPipComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ pipId: idSchema, body: z.string().trim().min(1).max(3000) }).parse(data))
  .handler(async ({ data, context }) => {
    const role = await getPipRole(context);
    const email = contextEmail(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadPip(supabaseAdmin, data.pipId);
    if (!canViewPip(role, context.userId, email, pip)) throw new Error("PIP not found or you do not have access");
    const authorRole = isPipOwner(role, context.userId, pip) ? "HR" : pip.manager_user_id === context.userId ? "Manager" : "Employee";
    const { error } = await supabaseAdmin.from("pip_comments").insert({
      pip_id: data.pipId, body: data.body, author_user_id: context.userId, author_email: email, author_role: authorRole,
    });
    if (error) throw new Error(error.message);
    await writePipAudit(supabaseAdmin, context, "pip_comment_added", data.pipId, { author_role: authorRole });
    const employeeId = pip.status === "draft" ? null : await findUserIdByEmail(supabaseAdmin, pip.employee_email);
    const staff = [pip.hr_owner_user_id, pip.manager_user_id].filter((id) => id !== context.userId && id !== employeeId);
    await notifyUsers(supabaseAdmin, staff, { type: "pip_comment", title: `New comment on ${pip.employee_name}'s PIP`, link: `/pip/${data.pipId}` });
    if (employeeId !== context.userId) {
      await notifyUsers(supabaseAdmin, [employeeId], { type: "pip_comment", title: "New comment on your PIP", link: "/my-pip" });
    }
    return { ok: true };
  });

const DOCUMENT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const;
export type PipDocumentType = (typeof DOCUMENT_TYPES)[number];
const documentSchema = z.object({
  pipId: idSchema,
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(DOCUMENT_TYPES),
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
});

// Step 1 of an upload: the server checks access and hands back a one-time signed upload URL.
export const createPipDocumentUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => documentSchema.parse(data))
  .handler(async ({ data, context }) => {
    const role = await requirePipAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadPip(supabaseAdmin, data.pipId);
    if (!isPipOwner(role, context.userId, pip)) throw new Error("Only the assigned HR Admin or Super Admin can upload documents");
    const safeName = data.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-100);
    const path = `${data.pipId}/${crypto.randomUUID()}-${safeName}`;
    const { data: signed, error } = await supabaseAdmin.storage.from("pip-documents").createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Unable to start the upload");
    return { path: signed.path, token: signed.token };
  });

// Step 2: record the uploaded file once the browser has finished sending it.
export const addPipDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => documentSchema.extend({ path: z.string().min(1).max(400), shared: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const role = await requirePipAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadPip(supabaseAdmin, data.pipId);
    if (!isPipOwner(role, context.userId, pip)) throw new Error("Only the assigned HR Admin or Super Admin can upload documents");
    if (!data.path.startsWith(`${data.pipId}/`) || data.path.includes("..")) throw new Error("Invalid document path");
    const { error } = await supabaseAdmin.from("pip_documents").insert({
      pip_id: data.pipId, file_name: data.fileName, storage_path: data.path, content_type: data.contentType,
      size_bytes: data.sizeBytes, shared_with_employee: data.shared, uploaded_by: context.userId, uploaded_by_email: contextEmail(context),
    });
    if (error) throw new Error(error.message);
    await writePipAudit(supabaseAdmin, context, "pip_document_added", data.pipId, { file_name: data.fileName, shared: data.shared });
    if (data.shared && pip.status !== "draft") {
      await notifyUsers(supabaseAdmin, [await findUserIdByEmail(supabaseAdmin, pip.employee_email)], { type: "pip_document", title: "A document was added to your PIP", link: "/my-pip" });
    }
    return { ok: true };
  });

export const getPipDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: idSchema }).parse(data))
  .handler(async ({ data, context }) => {
    // Reading through the user's own client lets the database decide whether they may see this document.
    const { data: doc, error } = await context.supabase.from("pip_documents").select("storage_path, file_name").eq("id", data.documentId).maybeSingle();
    if (error || !doc) throw new Error("Document not found or you do not have access");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signError } = await supabaseAdmin.storage.from("pip-documents").createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
    if (signError || !signed) throw new Error(signError?.message ?? "Unable to create download link");
    return { url: signed.signedUrl };
  });

async function loadOwnedDocument(context: AuthContext, documentId: string) {
  const role = await requirePipAdmin(context);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: doc, error } = await supabaseAdmin.from("pip_documents").select("id, pip_id, storage_path, file_name").eq("id", documentId).maybeSingle();
  if (error || !doc) throw new Error("Document not found");
  const pip = await loadPip(supabaseAdmin, doc.pip_id);
  if (!isPipOwner(role, context.userId, pip)) throw new Error("Only the assigned HR Admin or Super Admin can change documents");
  return { supabaseAdmin, doc, pip };
}

export const setPipDocumentShared = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: idSchema, shared: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, doc, pip } = await loadOwnedDocument(context, data.documentId);
    const { error } = await supabaseAdmin.from("pip_documents").update({ shared_with_employee: data.shared }).eq("id", doc.id);
    if (error) throw new Error(error.message);
    await writePipAudit(supabaseAdmin, context, data.shared ? "pip_document_shared" : "pip_document_unshared", pip.id, { file_name: doc.file_name });
    if (data.shared && pip.status !== "draft") {
      await notifyUsers(supabaseAdmin, [await findUserIdByEmail(supabaseAdmin, pip.employee_email)], { type: "pip_document", title: "A document was shared on your PIP", link: "/my-pip" });
    }
    return { ok: true };
  });

export const deletePipDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: idSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, doc, pip } = await loadOwnedDocument(context, data.documentId);
    const { error } = await supabaseAdmin.from("pip_documents").delete().eq("id", doc.id);
    if (error) throw new Error(error.message);
    const { error: storageError } = await supabaseAdmin.storage.from("pip-documents").remove([doc.storage_path]);
    if (storageError) console.error("PIP document file not removed", storageError.message);
    await writePipAudit(supabaseAdmin, context, "pip_document_deleted", pip.id, { file_name: doc.file_name });
    return { ok: true };
  });

export const getPipAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ pipId: idSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const role = await getPipRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pip = await loadPip(supabaseAdmin, data.pipId);
    if (!canViewPip(role, context.userId, contextEmail(context), pip)) throw new Error("PIP not found or you do not have access");
    const today = new Date().toISOString().slice(0, 10);
    const to = pip.end_date < today ? pip.end_date : today;
    if (!pip.employee_id) return { from: pip.start_date, to, total: 0, counts: {} as Record<string, number> };
    const { data: rows, error } = await supabaseAdmin.from("attendance").select("status")
      .eq("student_id", pip.employee_id).gte("date", pip.start_date).lte("date", to);
    if (error) throw new Error(error.message);
    const counts: Record<string, number> = {};
    for (const row of rows ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
    return { from: pip.start_date, to, total: rows?.length ?? 0, counts };
  });
