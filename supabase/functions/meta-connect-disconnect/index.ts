import { handleError, json, preflight, requireMember } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  try {
    const body = await req.json();
    const companyId = String(body.company_id || "");
    const { admin } = await requireMember(req, companyId);
    const [connection, secrets, states, pending] = await Promise.all([
      admin.from("connections").delete().eq("company_id", companyId),
      admin.from("connection_secrets").delete().eq("company_id", companyId),
      admin.from("oauth_states").delete().eq("company_id", companyId),
      admin.from("oauth_pending").delete().eq("company_id", companyId),
    ]);
    const error = connection.error || secrets.error || states.error || pending.error;
    if (error) throw error;
    return json({ demo_mode: false, connection: null, required_scopes: [], instagram_login_available: !!Deno.env.get("INSTAGRAM_APP_ID"), facebook_login_available: !!Deno.env.get("META_APP_ID") });
  } catch (error) { return handleError(error); }
});
