import { createFileRoute } from "@tanstack/react-router";
import { formatInTimeZone } from "date-fns-tz";

// Daily: remind the HR owner and the manager about PIP reviews scheduled for tomorrow.
export const Route = createFileRoute("/api/cron/pip-reviews")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const tomorrow = formatInTimeZone(new Date(Date.now() + 86_400_000), "Asia/Kolkata", "yyyy-MM-dd");
        const { data: reviews, error } = await supabaseAdmin
          .from("pip_checkins")
          .select("pip_id, pip_records!inner(employee_name, status, hr_owner_user_id, manager_user_id)")
          .eq("scheduled_date", tomorrow)
          .is("completed_at", null)
          .in("pip_records.status", ["active", "extended"]);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const rows = (reviews ?? []).flatMap(({ pip_id, pip_records: pip }) =>
          [pip.hr_owner_user_id, pip.manager_user_id].filter((id): id is string => !!id).map((user_id) => ({
            audience: "user",
            user_id,
            type: "pip_review_due",
            title: `PIP review for ${pip.employee_name} is due tomorrow`,
            link: `/pip/${pip_id}`,
          })),
        );
        if (rows.length) {
          const { error: insertError } = await supabaseAdmin.from("notifications").insert(rows);
          if (insertError) return Response.json({ error: insertError.message }, { status: 500 });
        }
        return Response.json({ notified: rows.length });
      },
    },
  },
});
