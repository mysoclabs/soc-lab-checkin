import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "super_admin" | "founder" | "finance" | "hr_admin" | "employee";

export function useCurrentUser() {
  const [userId, setUserId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const email = localStorage.getItem('mock-session-email');
      if (email) {
        const map: Record<string, string> = {
          'admin@mysoclabs.com': 'dev-user-id',
          'abebe@mysoclabs.com': 'user-abebe-001',
          'chaltu@mysoclabs.com': 'user-chaltu-001',
          'dawit@mysoclabs.com': 'user-dawit-001',
          'fatima@mysoclabs.com': 'user-fatima-001',
        };
        return map[email.toLowerCase()] ?? null;
      }
    }
    return null;
  });
  const [email, setEmail] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('mock-session-email');
    return null;
  });
  const [isResolved, setIsResolved] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }: { data: { user: { id: string; email: string } | null } }) => {
      setUserId(data.user?.id ?? null);
      setEmail(data.user?.email ?? null);
      setIsResolved(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e: string, session: { user: { id: string; email: string } | null } | null) => {
      if (session?.user) {
        setUserId(session.user.id ?? null);
        setEmail(session.user.email ?? null);
      } else {
        setUserId(null);
        setEmail(null);
      }
      setIsResolved(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { userId, email, isResolved };
}

const PRIORITY: AppRole[] = ["super_admin", "founder", "finance", "hr_admin", "employee"];

export function useUserRole() {
  const { userId, email, isResolved } = useCurrentUser();
  const query = useQuery({
    queryKey: ["user-role", userId],
    enabled: !!userId,
    retry: false,
    queryFn: async (): Promise<AppRole | null> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId!);
      if (error) {
        return "employee";
      }
      if (!data?.length) return "employee";
      const roles = data.map((r: { role: string }) => r.role as AppRole);
      for (const r of PRIORITY) if (roles.includes(r)) return r;
      return "employee";
    },
  });

  const role = !isResolved ? null : userId ? (query.data ?? null) : null;

  return {
    role,
    isLoading: !isResolved || (!!userId && query.isLoading),
    userId,
    email,
    isSuperAdmin: role === "super_admin",
    isFounder: role === "founder" || role === "super_admin",
    isFinance: role === "finance" || role === "founder" || role === "super_admin",
    isHrAdmin: role === "hr_admin" || role === "super_admin",
    isEmployee: role === "employee",
  };
}

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  founder: "Founder",
  finance: "Finance",
  hr_admin: "HR Admin",
  employee: "Employee",
};
