import { describe, expect, it } from "vitest";
import {
  canChangePipStatus,
  canDeletePip,
  canEditPipBasics,
  canManagePipGoals,
  canPublishPip,
  canReviewPip,
  canViewPip,
  goalWeightsAddUp,
  isPipOwner,
  type PipAccessRecord,
} from "./pip-permissions";

const ownedDraft: PipAccessRecord = {
  status: "draft",
  hr_owner_user_id: "hr-1",
  employee_email: "employee@example.com",
};

describe("PIP access rules", () => {
  it("allows Super Admin to edit plans, change outcomes, and delete records", () => {
    expect(canEditPipBasics("super_admin", "admin-1", ownedDraft)).toBe(true);
    expect(canChangePipStatus("super_admin", "admin-1", ownedDraft, "cancelled")).toBe(true);
    expect(canDeletePip("super_admin")).toBe(true);
  });

  it("limits HR Admin editing and publishing to their own draft plans", () => {
    expect(canEditPipBasics("hr_admin", "hr-1", ownedDraft)).toBe(true);
    expect(canPublishPip("hr_admin", "hr-1", ownedDraft)).toBe(true);
    expect(canEditPipBasics("hr_admin", "hr-2", ownedDraft)).toBe(false);
    expect(canPublishPip("hr_admin", "hr-2", ownedDraft)).toBe(false);
  });

  it("lets the owning HR Admin extend or close a running plan", () => {
    const active: PipAccessRecord = { ...ownedDraft, status: "active" };
    const extended: PipAccessRecord = { ...ownedDraft, status: "extended" };
    expect(canChangePipStatus("hr_admin", "hr-1", active, "extended")).toBe(true);
    expect(canChangePipStatus("hr_admin", "hr-1", active, "completed")).toBe(true);
    expect(canChangePipStatus("hr_admin", "hr-1", extended, "unsuccessful")).toBe(true);
  });

  it("prevents HR Admin from deleting, cancelling, reopening, or touching other owners' plans", () => {
    const active: PipAccessRecord = { ...ownedDraft, status: "active" };
    const completed: PipAccessRecord = { ...ownedDraft, status: "completed" };
    expect(canDeletePip("hr_admin")).toBe(false);
    expect(canChangePipStatus("hr_admin", "hr-1", active, "cancelled")).toBe(false);
    expect(canChangePipStatus("hr_admin", "hr-1", completed, "active")).toBe(false);
    expect(canChangePipStatus("hr_admin", "hr-1", ownedDraft, "completed")).toBe(false);
    expect(canChangePipStatus("hr_admin", "hr-2", active, "extended")).toBe(false);
  });

  it("shows employees only their own non-draft PIPs", () => {
    const published: PipAccessRecord = { ...ownedDraft, status: "active" };
    expect(canViewPip("employee", "employee-1", "EMPLOYEE@example.com", published)).toBe(true);
    expect(canViewPip("employee", "employee-1", "other@example.com", published)).toBe(false);
    expect(canViewPip("employee", "employee-1", "employee@example.com", ownedDraft)).toBe(false);
  });

  it("allows the assigned HR Admin to manage active goals but not closed-plan goals", () => {
    const active: PipAccessRecord = { ...ownedDraft, status: "active" };
    const completed: PipAccessRecord = { ...ownedDraft, status: "completed" };
    expect(canManagePipGoals("hr_admin", "hr-1", active)).toBe(true);
    expect(canManagePipGoals("hr_admin", "hr-1", completed)).toBe(false);
  });

  it("requires goal weights to total 100% once goals exist", () => {
    expect(goalWeightsAddUp([])).toBe(true);
    expect(goalWeightsAddUp([30, 30, 20, 20])).toBe(true);
    expect(goalWeightsAddUp([33.33, 33.33, 33.34])).toBe(true);
    expect(goalWeightsAddUp([25])).toBe(false);
    expect(goalWeightsAddUp([60, 60])).toBe(false);
  });
});

describe("PIP v2 manager permissions", () => {
  const managed = { status: "active" as const, hr_owner_user_id: "hr-1", employee_email: "emp@x.com", manager_user_id: "mgr-1" };

  it("manager can view and review a running plan they manage", () => {
    expect(canViewPip("employee", "mgr-1", "mgr@x.com", managed)).toBe(true);
    expect(canReviewPip("employee", "mgr-1", managed)).toBe(true);
  });

  it("manager cannot see drafts, other plans, or change structure and status", () => {
    expect(canViewPip("employee", "mgr-1", "mgr@x.com", { ...managed, status: "draft" })).toBe(false);
    expect(canViewPip("employee", "mgr-2", "mgr2@x.com", managed)).toBe(false);
    expect(canManagePipGoals("employee", "mgr-1", managed)).toBe(false);
    expect(canChangePipStatus("employee", "mgr-1", managed, "completed")).toBe(false);
    expect(isPipOwner("employee", "mgr-1", managed)).toBe(false);
  });

  it("manager cannot review a closed plan", () => {
    expect(canReviewPip("employee", "mgr-1", { ...managed, status: "completed" })).toBe(false);
  });

  it("an HR Admin who is only the manager is not the owner", () => {
    expect(canViewPip("hr_admin", "mgr-1", "mgr@x.com", managed)).toBe(true);
    expect(isPipOwner("hr_admin", "mgr-1", managed)).toBe(false);
  });
});
