import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    return { user: { id: "dev-user", email: "dev@localhost" } as any };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-border bg-background/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
            <SidebarTrigger />
            <div className="text-sm font-medium text-muted-foreground">MySocLabs · Attendance Admin</div>
            <div className="ml-auto"><NotificationBell /></div>
          </header>
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
