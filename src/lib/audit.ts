import { createAuditLog } from "@/lib/audit.functions";
import { createNotification } from "@/lib/notifications.functions";

export type AuditEntry = {
  action: string;
  entity: string;
  entity_id?: string | null;
  details?: Record<string, unknown> | null;
};

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await createAuditLog({ data: entry });
  } catch (err) {
    console.error("audit log failed", err);
  }
}

export type NotifyInput =
  | {
      audience: "admins";
      type: "leave_submitted" | "late_check_in" | "early_check_out" | "employee_created";
      title: string;
      message?: string;
      link?: string;
    }
  | {
      audience: "user";
      user_id: string;
      type: "leave_approved" | "leave_rejected";
      title: string;
      message?: string;
      link?: string;
    };

export async function notify(n: NotifyInput): Promise<void> {
  try {
    await createNotification({ data: n });
  } catch (err) {
    console.error("notify failed", err);
  }
}
