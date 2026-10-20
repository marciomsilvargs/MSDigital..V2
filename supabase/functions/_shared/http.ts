import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

export function clients(req?: Request): { admin: SupabaseClient; userClient?: SupabaseClient } {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) throw new Error("Supabase function environment is incomplete.");
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = req?.headers.get("authorization");
  const userClient = auth && anon ? createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: auth } },
  }) : undefined;
  return { admin, userClient };
}

export async function requireMember(req: Request, companyId: string): Promise<{ admin: SupabaseClient; user: User }> {
  const { admin, userClient } = clients(req);
  if (!userClient) throw new HttpError(401, "Faça login novamente.");
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new HttpError(401, "Faça login novamente.");
  const { data: membership, error: memberError } = await admin.from("company_members")
    .select("company_id").eq("company_id", companyId).eq("user_id", user.id).maybeSingle();
  if (memberError || !membership) throw new HttpError(403, "Você não tem acesso a esta empresa.");
  return { admin, user };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function handleError(error: unknown): Response {
  if (error instanceof HttpError) return json({ detail: error.message }, error.status);
  console.error(error);
  return json({ detail: error instanceof Error ? error.message : "Falha interna." }, 500);
}
