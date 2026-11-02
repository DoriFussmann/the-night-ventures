import { supabase } from "@/lib/supabase";

// JSON headers carrying the signed-in user's Supabase token. Every /api route
// that spends money (LLM, image, data providers) rejects calls without it.
export async function jsonAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}
