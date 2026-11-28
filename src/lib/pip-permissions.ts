export const PIP_STATUSES = [
  "draft",
  "active",
  "extended",
  "completed",
  "unsuccessful",
  "cancelled",
] as const;

export type PipStatus = (typeof PIP_STATUSES)[number];
export type PipRole = "super_admin" | "hr_admin" | "employee";

export type PipAccessRecord = {
  status: PipStatus;
  hr_owner_user_id: string;
  employee_email: string;
  manager_user_id?: string | null;
};

// The reporting manager is set per plan, so any signed-in user can be one, whatever their app role.
export function isPipManager(userId: string, pip: PipAccessRecord) {
  return !!userId && pip.manager_user_id === userId && pip.status !== "draft";
}

export function isPipOwner(role: PipRole, userId: string, pip: PipAccessRecord) {
  return role === "super_admin" || (role === "hr_admin" && pip.hr_owner_user_id === userId);
}

export function canViewPip(role: PipRole, userId: string, email: string, pip: PipAccessRecord) {
  if (role === "super_admin" || isPipManager(userId, pip)) return true;
  if (role === "hr_admin") return pip.hr_owner_user_id === userId;
  return pip.status !== "draft" && pip.employee_email.toLowerCase() === email.toLowerCase();
}

export function canEditPipBasics(role: PipRole, userId: string, pip: PipAccessRecord) {
  return role === "super_admin" || (role === "hr_admin" && pip.hr_owner_user_id === userId && pip.status === "draft");
}

export function canPublishPip(role: PipRole, userId: string, pip: PipAccessRecord) {
  return (role === "super_admin" || role === "hr_admin")
    && (role === "super_admin" || pip.hr_owner_user_id === userId)
    && pip.status === "draft";
}

export function canManagePipGoals(role: PipRole, userId: string, pip: PipAccessRecord) {
  if (role === "super_admin") return true;
  return role === "hr_admin"
    && pip.hr_owner_user_id === userId
    && ["draft", "active", "extended"].includes(pip.status);
}

// Check-ins and goal progress: the HR owner, or the manager while the plan is running.
export function canReviewPip(role: PipRole, userId: string, pip: PipAccessRecord) {
  return canManagePipGoals(role, userId, pip)
    || (isPipManager(userId, pip) && ["active", "extended"].includes(pip.status));
}

// HR owners may extend or close a running plan; cancel and reopen stay Super Admin only.
export function canChangePipStatus(role: PipRole, userId: string, pip: PipAccessRecord, next: PipStatus) {
  if (role === "super_admin") return true;
  return role === "hr_admin"
    && pip.hr_owner_user_id === userId
    && ["active", "extended"].includes(pip.status)
    && ["extended", "completed", "unsuccessful"].includes(next);
}

export function canDeletePip(role: PipRole) {
  return role === "super_admin";
}
// Plans without goals are allowed as drafts; once goals exist their weights must total 100%.
export function goalWeightsAddUp(weights: number[]) {
  return weights.length === 0 || Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 100) < 0.01;
}
