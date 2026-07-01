import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Vulnerability Report finding #5 (High): notifications must never be
// writable by the browser with an arbitrary audience/type/link — that let
// any authenticated employee forge admin-targeted "notifications" with a
// phishing link. This server function is the only path allowed to write
// notifications; `type` is restricted to the fixed set of events the app
// actually raises, and `link` may only be an internal relative path, never
// an external URL. The table's RLS denies all client INSERTs (see the
// matching migration).

const relativePath = z
  .string()
  .max(200)
  .regex(/^\/[a-zA-Z0-9\-_/]*$/, "link must be an internal relative path")
  .nullable()
  .optional();

const ADMIN_BROADCAST_TYPES = [
  "leave_submitted",
  "late_check_in",
  "early_check_out",
  "employee_created",
] as const;

const USER_TYPES = ["leave_approved", "leave_rejected"] as const;

const entrySchema = z.discriminatedUnion("audience", [
  z.object({
    audience: z.literal("admins"),
    type: z.enum(ADMIN_BROADCAST_TYPES),
    title: z.string().min(1).max(200),
    message: z.string().max(500).nullable().optional(),
    link: relativePath,
  }),
  z.object({
    audience: z.literal("user"),
    user_id: z.string().uuid(),
    type: z.enum(USER_TYPES),
    title: z.string().min(1).max(200),
    message: z.string().max(500).nullable().optional(),
    link: relativePath,
  }),
]);

export const createNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => entrySchema.parse(data))
  .handler(async ({ data, context }) => {
    if (data.audience === "user" && data.user_id !== context.userId) {
      const [{ data: isSuperAdmin }, { data: isHrAdmin }] = await Promise.all([
        context.supabase.rpc("has_role", { _user_id: context.userId, _role: "super_admin" }),
        context.supabase.rpc("has_role", { _user_id: context.userId, _role: "hr_admin" }),
      ]);
      if (!isSuperAdmin && !isHrAdmin) {
        throw new Error("Forbidden: only admins can notify other users");
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("notifications").insert({
      audience: data.audience,
      user_id: data.audience === "user" ? data.user_id : null,
      type: data.type,
      title: data.title,
      message: data.message ?? null,
      link: data.link ?? null,
    });
    if (error) throw new Error(error.message);
  });
