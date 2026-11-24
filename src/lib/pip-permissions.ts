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
};

export function canViewPip(role: PipRole, userId: string, email: string, pip: PipAccessRecord) {
  if (role === "super_admin") return true;
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

export function canChangePipStatus(role: PipRole) {
  return role === "super_admin";
}

export function canDeletePip(role: PipRole) {
  return role === "super_admin";
}