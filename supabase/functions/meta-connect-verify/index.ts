import { realConnection, subscribeInstagram } from "../_shared/connections.ts";
import { graphBase, graphRequest, FB_SCOPES, IG_SCOPES } from "../_shared/meta.ts";
import { handleError, json, preflight, requireMember } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  let authorizedCompanyId = "";
  try {
    const body = await req.json();
    const companyId = String(body.company_id || "");
    const { admin } = await requireMember(req, companyId);
    authorizedCompanyId = companyId;
    const conn = await realConnection(admin, companyId);
    const profile = await graphRequest(`${graphBase(conn.login_flow)}/${encodeURIComponent(conn.ig_user_id)}?fields=id,username,name,account_type,profile_picture_url`, conn.token);
    const requiredScopes = conn.login_flow === "facebook_login" ? FB_SCOPES : IG_SCOPES;
    const missingScopes = requiredScopes.filter((scope) => !(conn.granted_scopes || []).includes(scope));
    // The app-level webhook destination is configured in Meta. This call enrolls
    // the connected Instagram account so it can receive comments and Directs.
    const instagramHooks = await subscribeInstagram(conn.ig_user_id, conn.token, conn.login_flow);
    const updated = {
      username: profile.username || conn.username,
      profile_pic: profile.profile_picture_url || conn.profile_pic,
      state: missingScopes.length ? "partially_connected" : "connected",
      webhooks: { ...(conn.webhooks || {}), comments: instagramHooks, messages: instagramHooks },
      last_synced_at: new Date().toISOString(),
      last_error: missingScopes.length ? `Permissões ausentes: ${missingScopes.join(", ")}` : null,
      error_hint: missingScopes.length ? "Conclua a autorização concedendo todas as permissões solicitadas." : null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await admin.from("connections").update(updated).eq("company_id", companyId).select("*").single();
    if (error) throw error;
    return json({ demo_mode: false, connection: data, required_scopes: conn.login_flow === "facebook_login" ? FB_SCOPES : IG_SCOPES, instagram_login_available: !!Deno.env.get("INSTAGRAM_APP_ID"), facebook_login_available: !!Deno.env.get("META_APP_ID") });
  } catch (error) {
    const body = await req.clone().json().catch(() => ({}));
    const companyId = String(body.company_id || "");
    try {
      const { admin } = (await import("../_shared/http.ts")).clients(req);
      if (companyId && authorizedCompanyId === companyId) {
        const { data: current } = await admin.from("connections").select("*").eq("company_id", companyId).maybeSingle();
        if (current?.source === "real") {
          const { data: updated, error: updateError } = await admin.from("connections").update({
            state: "session_expired", last_error: error instanceof Error ? error.message : "Token inválido",
            error_hint: "A Graph API rejeitou o token. Reconecte a conta para autorizar novamente.", updated_at: new Date().toISOString(),
          }).eq("company_id", companyId).select("*").single();
          if (updateError) throw updateError;
          const scopes = current.login_flow === "facebook_login" ? FB_SCOPES : IG_SCOPES;
          return json({ demo_mode: false, connection: updated, required_scopes: scopes,
            instagram_login_available: !!Deno.env.get("INSTAGRAM_APP_ID"),
            facebook_login_available: !!Deno.env.get("META_APP_ID") });
        }
      }
    } catch (inner) { console.error(inner); }
    return handleError(error);
  }
});
