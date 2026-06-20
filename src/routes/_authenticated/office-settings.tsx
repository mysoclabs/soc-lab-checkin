import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Save } from "lucide-react";
import { toast } from "sonner";
import { RoleGuard } from "@/components/role-guard";
import { useOfficeSettings, DEFAULT_OFFICE_SETTINGS, type OfficeSettings } from "@/hooks/use-office-settings";

export const Route = createFileRoute("/_authenticated/office-settings")({
  head: () => ({ meta: [{ title: "Office Settings · MySOC Labs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin", "hr_admin"]} fallbackTo="/">
      <OfficeSettingsPage />
    </RoleGuard>
  ),
});

function toHHMM(t: string) {
  return t.slice(0, 5);
}

function OfficeSettingsPage() {
  const { data, isLoading } = useOfficeSettings();
  const qc = useQueryClient();
  const [form, setForm] = useState<OfficeSettings>(DEFAULT_OFFICE_SETTINGS);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        id: 1,
        office_start_time: form.office_start_time.length === 5 ? `${form.office_start_time}:00` : form.office_start_time,
        office_end_time: form.office_end_time.length === 5 ? `${form.office_end_time}:00` : form.office_end_time,
        working_hours: Number(form.working_hours),
        grace_period_minutes: Number(form.grace_period_minutes),
        late_threshold: form.late_threshold.length === 5 ? `${form.late_threshold}:00` : form.late_threshold,
        half_day_threshold: form.half_day_threshold.length === 5 ? `${form.half_day_threshold}:00` : form.half_day_threshold,
      };
      const { error } = await supabase.from("office_settings").upsert(payload, { onConflict: "id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Office settings saved");
      qc.invalidateQueries({ queryKey: ["office-settings"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Settings className="h-6 w-6 text-primary" /> Office Settings
        </h1>
        <p className="text-sm text-muted-foreground">Company-wide timing rules used across attendance.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Timing</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <form
              className="grid gap-5 sm:grid-cols-2"
              onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
            >
              <Field label="Office Start Time">
                <Input type="time" value={toHHMM(form.office_start_time)}
                  onChange={(e) => setForm({ ...form, office_start_time: e.target.value })} />
              </Field>
              <Field label="Office End Time">
                <Input type="time" value={toHHMM(form.office_end_time)}
                  onChange={(e) => setForm({ ...form, office_end_time: e.target.value })} />
              </Field>
              <Field label="Working Hours (per day)">
                <Input type="number" min={1} max={24} step={0.25} value={form.working_hours}
                  onChange={(e) => setForm({ ...form, working_hours: Number(e.target.value) })} />
              </Field>
              <Field label="Grace Period (minutes)">
                <Input type="number" min={0} max={120} value={form.grace_period_minutes}
                  onChange={(e) => setForm({ ...form, grace_period_minutes: Number(e.target.value) })} />
              </Field>
              <Field label="Late Threshold">
                <Input type="time" value={toHHMM(form.late_threshold)}
                  onChange={(e) => setForm({ ...form, late_threshold: e.target.value })} />
              </Field>
              <Field label="Half-Day Threshold">
                <Input type="time" value={toHHMM(form.half_day_threshold)}
                  onChange={(e) => setForm({ ...form, half_day_threshold: e.target.value })} />
              </Field>
              <div className="sm:col-span-2 flex justify-end">
                <Button type="submit" disabled={save.isPending}>
                  <Save className="mr-2 h-4 w-4" /> Save changes
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
