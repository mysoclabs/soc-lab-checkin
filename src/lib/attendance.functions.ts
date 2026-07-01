import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Any authenticated user may operate the check-in scanner, but the `students`
// table RLS now restricts SELECT to admins or the row's own email — a scanner
// operator needs to resolve *other* employees' QR codes. This server function
// does that lookup with the service-role client and returns only the fields
// the scanner UI needs, instead of granting broad client-side table access.
export const resolveStudentByCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ code: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: employee, error } = await supabaseAdmin
      .from("students")
      .select("id, name, student_id")
      .eq("student_id", data.code)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return employee;
  });
