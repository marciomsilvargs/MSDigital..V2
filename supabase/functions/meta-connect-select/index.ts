import { handleError, json, preflight, requireMember } from "../_shared/http.ts";
import { decryptToken } from "../_shared/crypto.ts";
import { saveRealConnection, subscribePage } from "../_shared/connections.ts";
import { FB_SCOPES } from "../_shared/meta.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  try {
    const body = await req.json();
    const companyId = String(body.company_id || "");
    const pendingId = String(body.pending_id || "");
    const pageId = String(body.page_id || "");
    const { admin } = await requireMember(req, companyId);
    const { data: pending, error } = await admin.from("oauth_pending").select("*")
      .eq("id", pendingId).eq("company_id", companyId).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) throw error;
    if (!pending) return json({ detail: "Seleção expirada. Inicie a conexão novamente." }, 404);
    const page = (pending.pages || []).find((item: Record<string, string>) => item.page_id === pageId);
    if (!page) return json({ detail: "Página não pertence a esta autorização." }, 400);
    const token = await decryptToken(page.token_ciphertext);
    const hooks = await subscribePage(page.page_id, token);
    const connection = await saveRealConnection(admin, {
      companyId, flow: "facebook_login", igId: page.ig_user_id, username: page.username,
      profilePic: page.profile_pic, accountType: "BUSINESS", scopes: pending.granted_scopes || FB_SCOPES,
      token, expiresIn: Number(pending.expires_in || 5_184_000), pageId: page.page_id,
      pageName: page.page_name, webhooks: { comments: hooks, messages: hooks },
    });
    await admin.from("oauth_pending").delete().eq("id", pendingId).eq("company_id", companyId);
    return json({ demo_mode: false, connection, required_scopes: FB_SCOPES, instagram_login_available: !!Deno.env.get("INSTAGRAM_APP_ID"), facebook_login_available: true });
  } catch (error) { return handleError(error); }
});
