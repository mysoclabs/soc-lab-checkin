import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { resolveEffectiveShift } from "@/lib/resolve-shift";
import { isAutoCheckoutDue, autoCheckoutDeadline } from "@/lib/shift-time";

export const Route = createFileRoute("/api/cron/auto-checkout")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const today = format(new Date(), "yyyy-MM-dd");
        const now = new Date();

        const { data: openRows, error } = await supabaseAdmin
          .from("attendance")
          .select("id, student_id")
          .eq("date", today)
          .not("check_in", "is", null)
          .is("check_out", null);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        let closed = 0;
        for (const row of openRows ?? []) {
          const shift = await resolveEffectiveShift(supabaseAdmin, row.student_id, today);
          if (!isAutoCheckoutDue(now, shift, now)) continue;
          const checkOut = autoCheckoutDeadline(shift, now);
          const { error: updateErr } = await supabaseAdmin
            .from("attendance")
            .update({ check_out: checkOut.toISOString() })
            .eq("id", row.id);
          if (!updateErr) closed += 1;
        }

        return Response.json({ closed });
      },
    },
  },
});
