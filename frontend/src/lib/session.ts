import { queryClient } from "@/lib/queryClient";
import { requireSupabase } from "@/lib/supabase";

// Session boundaries own the react-query cache — never hand-roll logout.
export async function beginSession(): Promise<void> {
  await queryClient.invalidateQueries();
}

export async function endSession(): Promise<void> {
  try {
    const { error } = await requireSupabase().auth.signOut();
    if (error) throw error;
  } finally {
    queryClient.clear();
  }
}
