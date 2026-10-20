import { clients, json } from "../_shared/http.ts";
import { encryptToken } from "../_shared/crypto.ts";
import { failConnection, saveRealConnection, subscribeInstagram, subscribePage } from "../_shared/connections.ts";
import { exchangeFacebookCode, exchangeInstagramCode } from "../_shared/meta.ts";

function redirect(params: Record<string, string>) {
  const base = Deno.env.get("APP_URL")?.replace(/\/$/, "");
  if (!base) return json({ detail: "APP_URL não foi configurada nas Edge Function secrets." }, 500);
  const url = new URL(`${base}/connection`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return Response.redirect(url, 302);
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const error = url.searchParams.get("error_description") || url.searchParams.get("error_message") || url.searchParams.get("error") || "";
    if (!state) return redirect({ connect: "connection_error" });
    const { admin } = clients();
    const { data: oauth, error: readError } = await admin.from("oauth_states").select("*").eq("state", state).maybeSingle();
    if (readError || !oauth) return redirect({ connect: "connection_error" });
    await admin.from("oauth_states").delete().eq("state", state);
    if (new Date(oauth.expires_at).getTime() < Date.now()) {
      await failConnection(admin, oauth.company_id, oauth.flow, "Autorização expirada.", "Inicie a conexão novamente.");
      return redirect({ connect: "connection_error" });
    }
    if (error || !code) {
      await failConnection(admin, oauth.company_id, oauth.flow, error || "Autorização negada pelo usuário.", "A autorização foi cancelada ou negada na Meta. Inicie novamente.");
      return redirect({ connect: "connection_error" });
    }
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/meta-oauth-callback`;
    if (oauth.flow === "facebook_login") {
      const bundle = await exchangeFacebookCode(code, redirectUri);
      const pages = [];
      for (const page of bundle.pages) {
        const ig = page.instagram_business_account || {};
        if (!ig.id || !page.access_token) continue;
        pages.push({
          page_id: String(page.id), page_name: page.name || "", ig_user_id: String(ig.id),
          username: ig.username || "", profile_pic: ig.profile_picture_url || "",
          token_ciphertext: await encryptToken(String(page.access_token)),
        });
      }
      if (!pages.length) {
        await failConnection(admin, oauth.company_id, oauth.flow, "Nenhuma Página administrada possui Instagram profissional vinculado.", "Vincule uma conta Instagram Business a uma Página do Facebook e tente novamente.");
        return redirect({ connect: "connection_error" });
      }
      if (pages.length === 1) {
        const page = pages[0];
        const token = await (await import("../_shared/crypto.ts")).decryptToken(page.token_ciphertext);
        const hooks = await subscribePage(page.page_id, token);
        const saved = await saveRealConnection(admin, {
          companyId: oauth.company_id, flow: "facebook_login", igId: page.ig_user_id,
          username: page.username, profilePic: page.profile_pic, accountType: "BUSINESS",
          scopes: bundle.scopes, token, expiresIn: bundle.expiresIn, pageId: page.page_id,
          pageName: page.page_name, webhooks: { comments: hooks, messages: hooks },
        });
        return redirect({ connect: saved.state });
      }
      const { data: pending, error: pendingError } = await admin.from("oauth_pending").insert({
        company_id: oauth.company_id, pages, granted_scopes: bundle.scopes, expires_in: bundle.expiresIn,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      }).select("id").single();
      if (pendingError) throw pendingError;
      await admin.from("connections").upsert({ company_id: oauth.company_id, state: "connecting", source: "real", login_flow: "facebook_login", updated_at: new Date().toISOString() }, { onConflict: "company_id" });
      return redirect({ pick: pending.id });
    }

    const bundle = await exchangeInstagramCode(code, redirectUri);
    const igId = String(bundle.profile.user_id || bundle.profile.id || "");
    if (!igId) throw new Error("A Meta não retornou o identificador da conta Instagram.");
    const hooks = await subscribeInstagram(igId, bundle.token, "instagram_login");
    const saved = await saveRealConnection(admin, {
      companyId: oauth.company_id, flow: "instagram_login", igId,
      username: String(bundle.profile.username || ""), profilePic: String(bundle.profile.profile_picture_url || ""),
      accountType: String(bundle.profile.account_type || "BUSINESS"), scopes: bundle.scopes,
      token: bundle.token, expiresIn: bundle.expiresIn, webhooks: { comments: hooks, messages: hooks },
    });
    return redirect({ connect: saved.state });
  } catch (error) {
    console.error("Meta OAuth callback failed", error);
    return redirect({ connect: "connection_error" });
  }
});
