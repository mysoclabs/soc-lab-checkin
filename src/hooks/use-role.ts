import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "super_admin" | "hr_admin" | "employee";

export function useCurrentUser() {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { userId, email };
}

export function useUserRole() {
  const { userId, email } = useCurrentUser();
  const query = useQuery({
    queryKey: ["user-role", userId],
    enabled: !!userId,
    queryFn: async (): Promise<AppRole | null> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId!)
        .order("role", { ascending: true });
      if (error) throw error;
      if (!data?.length) return "employee";
      // Priority: super_admin > hr_admin > employee
      const roles = data.map((r) => r.role as AppRole);
      if (roles.includes("super_admin")) return "super_admin";
      if (roles.includes("hr_admin")) return "hr_admin";
      return "employee";
    },
  });

  return {
    role: query.data ?? null,
    isLoading: query.isLoading,
    userId,
    email,
    isSuperAdmin: query.data === "super_admin",
    isHrAdmin: query.data === "hr_admin" || query.data === "super_admin",
    isEmployee: query.data === "employee",
  };
}

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  hr_admin: "HR Admin",
  employee: "Employee",
};
