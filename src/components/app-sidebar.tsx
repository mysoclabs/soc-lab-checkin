import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, ClipboardCheck, ScanLine, FileBarChart2,
  LogOut, ShieldCheck, User as UserIcon, CalendarClock, CalendarDays, Clock, PartyPopper, Shield, Wallet, QrCode,
} from "lucide-react";
const mysocLogo = { url: "/favicon.ico" };
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useUserRole, ROLE_LABELS, type AppRole } from "@/hooks/use-role";
import { useQueryClient } from "@tanstack/react-query";

type NavItem = {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  roles: AppRole[];
};

const items: NavItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, roles: ["super_admin", "hr_admin"] },
  { title: "Employees", url: "/students", icon: Users, roles: ["super_admin", "hr_admin"] },
  { title: "Attendance", url: "/attendance", icon: ClipboardCheck, roles: ["super_admin", "hr_admin"] },
  { title: "QR Scanner", url: "/scanner", icon: ScanLine, roles: ["super_admin", "hr_admin", "founder"] },
  { title: "Reports", url: "/reports", icon: FileBarChart2, roles: ["super_admin", "hr_admin"] },
  { title: "Leave Management", url: "/leaves", icon: CalendarDays, roles: ["super_admin", "hr_admin"] },
  { title: "Holidays", url: "/holidays", icon: PartyPopper, roles: ["super_admin", "hr_admin"] },
  { title: "Shifts", url: "/shifts", icon: Clock, roles: ["super_admin", "hr_admin"] },
  { title: "Users & Roles", url: "/users", icon: ShieldCheck, roles: ["super_admin"] },
  { title: "Audit Logs", url: "/audit-logs", icon: Shield, roles: ["super_admin", "hr_admin"] },
  { title: "Finance", url: "/finance", icon: Wallet, roles: ["super_admin", "founder", "finance"] },
  { title: "My Profile", url: "/me", icon: UserIcon, roles: ["employee", "founder", "finance"] },
  { title: "My QR", url: "/my-qr", icon: QrCode, roles: ["super_admin", "employee", "founder", "finance", "hr_admin"] },
  { title: "My Attendance", url: "/my-attendance", icon: CalendarClock, roles: ["employee"] },
  { title: "My Leaves", url: "/my-leaves", icon: CalendarDays, roles: ["employee", "hr_admin"] },
];

const roleBadgeClass: Record<AppRole, string> = {
  super_admin: "bg-primary/15 text-primary",
  founder: "bg-success/15 text-success",
  finance: "bg-accent/15 text-accent-foreground",
  hr_admin: "bg-warning/15 text-warning",
  employee: "bg-muted text-muted-foreground",
};

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { role, email } = useUserRole();

  const isActive = (url: string) => (url === "/" ? pathname === "/" : pathname.startsWith(url));

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/auth", replace: true });
  };

  const visible = items.filter((i) => (role ? i.roles.includes(role) : false));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center">
            <img src={mysocLogo.url} alt="MySocLabs" className="h-full w-full object-contain" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">MySocLabs</span>
            <span className="text-xs text-muted-foreground">Attendance System</span>
          </div>
        </div>
        {role && (
          <div className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
            <Badge variant="secondary" className={roleBadgeClass[role]}>
              {ROLE_LABELS[role]}
            </Badge>
            {email && <p className="mt-1 truncate text-xs text-muted-foreground">{email}</p>}
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} tooltip="Sign out">
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
