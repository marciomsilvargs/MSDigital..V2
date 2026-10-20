import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { getCurrentUser, isSupabaseConfigured } from "@/lib/supabase";

// Auth gate: renders the app shell splash while checking the session cookie,
// redirects to the split login screen when there is no session.
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoading, error } = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
    retry: false,
    staleTime: 60_000,
    enabled: isSupabaseConfigured,
  });

  if (!isSupabaseConfigured) return <Navigate to="/" replace />;

  if (isLoading) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-[#10131B] text-[#F8FAFC]">
        <Loader2 className="h-6 w-6 animate-spin text-[#C5A46D]" />
        <p className="text-sm text-[#94A3B8]">Carregando MS Studio Digital…</p>
      </div>
    );
  }

  if (error) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
