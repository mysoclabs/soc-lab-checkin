import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";
import { useOfficeSettings, formatTimeStr } from "@/hooks/use-office-settings";

export function OfficeTimingCard() {
  const { data: office } = useOfficeSettings();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const start = office?.office_start_time ?? "09:30:00";
  const end = office?.office_end_time ?? "18:30:00";
  const wh = office?.working_hours ?? 8;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Current Time</p>
            <p className="mt-1 font-mono text-3xl font-semibold tracking-tight tabular-nums">
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Clock className="h-6 w-6" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Office Time</p>
            <p className="font-medium">{formatTimeStr(start)} – {formatTimeStr(end)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Working Hours</p>
            <p className="font-medium">{wh}h / day</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
