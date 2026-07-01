import { supabase } from "@/integrations/supabase/client";
import { createAuditLog } from "@/lib/audit.functions";

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

export type NotifyInput = {
  audience: "user" | "admins";
  user_id?: string | null;
  type: string;
  title: string;
  message?: string;
  link?: string;
};

export async function notify(n: NotifyInput): Promise<void> {
  try {
    await supabase.from("notifications").insert({
      audience: n.audience,
      user_id: n.audience === "user" ? n.user_id ?? null : null,
      type: n.type,
      title: n.title,
      message: n.message ?? null,
      link: n.link ?? null,
    });
  } catch (err) {
    console.error("notify failed", err);
  }
}
