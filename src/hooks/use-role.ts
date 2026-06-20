import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "super_admin" | "founder" | "finance" | "hr_admin" | "employee";

export function useCurrentUser() {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isResolved, setIsResolved] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setEmail(data.user?.email ?? null);
      setIsResolved(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
      setEmail(session?.user?.email ?? null);
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
        console.error("Failed to load user role, falling back to employee", error);
        return "employee";
      }
      if (!data?.length) return "employee";
      const roles = data.map((r) => r.role as AppRole);
      for (const r of PRIORITY) if (roles.includes(r)) return r;
      return "employee";
    },
  });

  const role = !isResolved ? null : userId ? (query.data ?? "employee") : null;

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
