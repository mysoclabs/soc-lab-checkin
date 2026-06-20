import { supabase } from "@/integrations/supabase/client";

let cachedIp: string | null = null;
async function getIp(): Promise<string | null> {
  if (cachedIp !== null) return cachedIp;
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const j = await res.json();
    cachedIp = j.ip ?? null;
  } catch {
    cachedIp = null;
  }
  return cachedIp;
}

export type AuditEntry = {
  action: string;
  entity: string;
  entity_id?: string | null;
  details?: Record<string, unknown> | null;
};

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    const ip = await getIp();
    await supabase.from("audit_logs").insert({
      user_id: u.user?.id ?? null,
      user_name: u.user?.email ?? null,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entity_id ?? null,
      details: entry.details ?? null,
      ip_address: ip,
    });
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
