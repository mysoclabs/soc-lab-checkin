import { describe, expect, it } from "vitest";
import {
  canChangePipStatus,
  canDeletePip,
  canEditPipBasics,
  canManagePipGoals,
  canPublishPip,
  canViewPip,
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
});