import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Vulnerability Report finding #4: audit_logs must never be writable by the
// browser, even under the caller's own identity — a real audit trail can't
// be user-fabricated. This server function is the only path allowed to
// write audit_logs; user_id/user_name/ip_address come from the verified
// request context, not from client input, and the table's RLS denies all
// client INSERTs (see reportss/fix-audit-logs.sql).

const entrySchema = z.object({
  action: z.string().min(1).max(200),
  entity: z.string().min(1).max(200),
  entity_id: z.string().max(200).nullable().optional(),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
});

function getClientIp(): string | null {
  const request = getRequest();
  const headers = request?.headers;
  if (!headers) return null;
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

export const createAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => entrySchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userName = (context.claims as { email?: string } | undefined)?.email ?? null;
    const { error } = await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId,
      user_name: userName,
      action: data.action,
      entity: data.entity,
      entity_id: data.entity_id ?? null,
      details: (data.details ?? null) as never,
      ip_address: getClientIp(),
    });
    if (error) throw new Error(error.message);
  });
