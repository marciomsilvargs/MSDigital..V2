import { handleError, json, preflight, requireMember } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  try {
    const body = await req.json();
    const companyId = String(body.company_id || "");
    const pendingId = String(body.pending_id || "");
    const { admin } = await requireMember(req, companyId);
    const { data, error } = await admin.from("oauth_pending").select("id,pages,expires_at")
      .eq("id", pendingId).eq("company_id", companyId).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) throw error;
    if (!data) return json({ detail: "Seleção expirada. Inicie a conexão novamente." }, 404);
    return json({ pending_id: data.id, accounts: (data.pages || []).map((page: Record<string, unknown>) => ({
      page_id: page.page_id, page_name: page.page_name, ig_user_id: page.ig_user_id,
      username: page.username || "", profile_pic: page.profile_pic || "",
    })) });
  } catch (error) { return handleError(error); }
});
