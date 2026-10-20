import { handleError, json, preflight, requireMember } from "../_shared/http.ts";
import { FB_SCOPES, IG_SCOPES } from "../_shared/meta.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  try {
    const body = await req.json();
    const companyId = String(body.company_id || "");
    const { admin } = await requireMember(req, companyId);
    const { data: connection, error } = await admin.from("connections").select("*").eq("company_id", companyId).maybeSingle();
    if (error) throw error;
    const fbConfigured = !!(Deno.env.get("META_APP_ID") && Deno.env.get("META_APP_SECRET"));
    const igConfigured = !!(Deno.env.get("INSTAGRAM_APP_ID") && Deno.env.get("INSTAGRAM_APP_SECRET"));
    return json({
      demo_mode: !fbConfigured && !igConfigured,
      connection,
      required_scopes: (connection?.login_flow === "facebook_login" ? FB_SCOPES : IG_SCOPES),
      instagram_login_available: igConfigured,
      facebook_login_available: fbConfigured,
    });
  } catch (error) { return handleError(error); }
});
