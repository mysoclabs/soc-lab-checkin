import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { useUserRole } from "@/hooks/use-role";
import { Link } from "@tanstack/react-router";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
  audience: string;
  user_id: string | null;
};

export function NotificationBell() {
  const qc = useQueryClient();
  const { userId, isHrAdmin } = useUserRole();

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", userId, isHrAdmin],
    enabled: !!userId,
    refetchInterval: 20000,
    queryFn: async () => {
      let query = supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(30);
      if (isHrAdmin) {
        query = query.or(`user_id.eq.${userId},audience.eq.admins`);
      } else {
        query = query.eq("user_id", userId!);
      }
      const { data } = await query;
      return (data ?? []) as Notification[];
    },
  });

  const unread = notifications.filter((n) => !n.read).length;

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
      if (unreadIds.length === 0) return;
      await supabase.from("notifications").update({ read: true }).in("id", unreadIds);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOneRead = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notifications").update({ read: true }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between border-b border-border p-3">
          <div className="text-sm font-semibold">Notifications</div>
          <Button variant="ghost" size="sm" onClick={() => markAllRead.mutate()} disabled={unread === 0}>
            Mark all read
          </Button>
        </div>
        <ScrollArea className="h-96">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => {
                const content = (
                  <div className={`flex flex-col gap-1 p-3 hover:bg-accent/40 ${!n.read ? "bg-primary/5" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium">{n.title}</div>
                      {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    </div>
                    {n.message && <div className="text-xs text-muted-foreground">{n.message}</div>}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase text-muted-foreground">{n.type.replace(/_/g, " ")}</span>
                      <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id} onClick={() => !n.read && markOneRead.mutate(n.id)}>
                    {n.link ? <Link to={n.link}>{content}</Link> : content}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
        {isHrAdmin && (
          <div className="border-t border-border p-2 text-center">
            <Link to="/audit-logs" className="text-xs text-primary hover:underline">View audit logs</Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
