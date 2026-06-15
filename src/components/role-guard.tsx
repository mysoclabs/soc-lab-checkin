import { Navigate } from "@tanstack/react-router";
import { useUserRole, type AppRole } from "@/hooks/use-role";
import { Loader2 } from "lucide-react";

export function RoleGuard({
  allow,
  children,
  fallbackTo = "/me",
}: {
  allow: AppRole[];
  children: React.ReactNode;
  fallbackTo?: string;
}) {
  const { role, isLoading, userId } = useUserRole();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!userId) {
    return <Navigate to="/auth" replace />;
  }

  if (!role) {
    return <Navigate to={fallbackTo} replace />;
  }

  if (!allow.includes(role)) {
    return <Navigate to={fallbackTo} replace />;
  }
  return <>{children}</>;
}
