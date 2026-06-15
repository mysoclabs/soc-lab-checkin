import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "super_admin" | "hr_admin" | "employee";

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
        .eq("user_id", userId!)
        .order("role", { ascending: true });
      if (error) {
        console.error("Failed to load user role, falling back to employee", error);
        return "employee";
      }
      if (!data?.length) return "employee";
      // Priority: super_admin > hr_admin > employee
      const roles = data.map((r) => r.role as AppRole);
      if (roles.includes("super_admin")) return "super_admin";
      if (roles.includes("hr_admin")) return "hr_admin";
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
    isHrAdmin: role === "hr_admin" || role === "super_admin",
    isEmployee: role === "employee",
  };
}

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  hr_admin: "HR Admin",
  employee: "Employee",
};
