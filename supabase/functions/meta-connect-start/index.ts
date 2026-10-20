import { clients, handleError, json, preflight, requireMember } from "../_shared/http.ts";
import { FB_SCOPES, IG_SCOPES } from "../_shared/meta.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  try {
    if (req.method !== "POST") return json({ detail: "Método não permitido." }, 405);
    const body = await req.json();
    const companyId = String(body.company_id || "");
    const flow = body.flow === "facebook_login" ? "facebook_login" : body.flow === "instagram_login" ? "instagram_login" : "";
    if (!companyId || !flow) return json({ detail: "Empresa ou fluxo OAuth inválido." }, 400);
    const { admin } = await requireMember(req, companyId);
    const appUrl = Deno.env.get("APP_URL")?.replace(/\/$/, "");
    if (!appUrl) throw new Error("Configure APP_URL nas secrets das Edge Functions.");
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/meta-oauth-callback`;
    const fbAppId = Deno.env.get("META_APP_ID") || "";
    const igAppId = Deno.env.get("INSTAGRAM_APP_ID") || "";
    if (flow === "facebook_login" && (!fbAppId || !Deno.env.get("META_APP_SECRET"))) return json({ detail: "Login do Facebook não está configurado no Supabase." }, 409);
    if (flow === "instagram_login" && (!igAppId || !Deno.env.get("INSTAGRAM_APP_SECRET"))) return json({ detail: "Login do Instagram não está configurado no Supabase." }, 409);

    const state = crypto.randomUUID();
    const { error: stateError } = await admin.from("oauth_states").insert({
      state, company_id: companyId, flow, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (stateError) throw stateError;
    const scope = (flow === "facebook_login" ? FB_SCOPES : IG_SCOPES).join(flow === "facebook_login" ? "," : ",");
    const url = new URL(flow === "facebook_login" ? `https://www.facebook.com/${Deno.env.get("META_FB_API_VERSION") || "v26.0"}/dialog/oauth` : "https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: flow === "facebook_login" ? fbAppId : igAppId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      state,
    }).toString();
    const { error: connError } = await admin.from("connections").upsert({
      company_id: companyId, state: "awaiting_auth", source: "real", login_flow: flow,
      updated_at: new Date().toISOString(), last_error: null, error_hint: null,
    }, { onConflict: "company_id" });
    if (connError) throw connError;
    return json({ authorization_url: url.toString(), redirect_uri: redirectUri, required_scopes: flow === "facebook_login" ? FB_SCOPES : IG_SCOPES, app_url: appUrl });
  } catch (error) { return handleError(error); }
});
