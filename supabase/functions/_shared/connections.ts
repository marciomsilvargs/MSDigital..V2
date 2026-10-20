import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "./crypto.ts";
import { FB_SCOPES, graphBase, graphRequest, IG_SCOPES, subscribeWebhooks } from "./meta.ts";

const FEATURE_BY_SCOPE: Record<string, string> = {
  instagram_business_content_publish: "publish",
  instagram_business_manage_comments: "comments",
  instagram_business_manage_messages: "messages",
  instagram_content_publish: "publish",
  instagram_manage_comments: "comments",
  instagram_manage_messages: "messages",
};

export async function saveRealConnection(admin: SupabaseClient, input: {
  companyId: string; flow: string; igId: string; username: string; profilePic?: string;
  accountType: string; scopes: string[]; token: string; expiresIn: number;
  pageId?: string; pageName?: string; webhooks?: Record<string, boolean>;
}) {
  const scopes = [...new Set(input.scopes)];
  const required = input.flow === "facebook_login" ? FB_SCOPES : IG_SCOPES;
  const missing = required.filter((scope) => !scopes.includes(scope));
  const features = [...new Set(scopes.map((scope) => FEATURE_BY_SCOPE[scope]).filter(Boolean))];
  let state = missing.length ? "partially_connected" : "connected";
  if (!features.length) state = "insufficient_permissions";
  const now = new Date().toISOString();
  const connection = {
    company_id: input.companyId, state, source: "real", provider: "meta_instagram", login_flow: input.flow,
    ig_user_id: input.igId, username: input.username || "", profile_pic: input.profilePic || "",
    account_type: input.accountType || "BUSINESS", granted_scopes: scopes, enabled_features: features,
    webhooks: input.webhooks ?? {}, token_expires_at: new Date(Date.now() + input.expiresIn * 1000).toISOString(),
    last_synced_at: now, last_error: missing.length ? `Permissões ausentes: ${missing.join(", ")}` : null,
    error_hint: missing.length ? "Conclua a autorização concedendo todas as permissões solicitadas." : null, updated_at: now,
  };
  const [connResult, secretResult] = await Promise.all([
    admin.from("connections").upsert(connection, { onConflict: "company_id" }),
    encryptToken(input.token).then((token_ciphertext) => admin.from("connection_secrets").upsert({
      company_id: input.companyId, token_ciphertext, page_id: input.pageId || "", page_name: input.pageName || "", updated_at: now,
    }, { onConflict: "company_id" })),
  ]);
  if (connResult.error) throw connResult.error;
  if (secretResult.error) throw secretResult.error;
  return connection;
}

export async function failConnection(admin: SupabaseClient, companyId: string, flow: string, message: string, hint: string) {
  await admin.from("connections").upsert({
    company_id: companyId, state: "connection_error", source: "real", login_flow: flow,
    last_error: message.slice(0, 500), error_hint: hint, updated_at: new Date().toISOString(),
  }, { onConflict: "company_id" });
  await admin.from("connection_secrets").delete().eq("company_id", companyId);
}

export async function realConnection(admin: SupabaseClient, companyId: string) {
  const [connRes, secretRes] = await Promise.all([
    admin.from("connections").select("*").eq("company_id", companyId).maybeSingle(),
    admin.from("connection_secrets").select("token_ciphertext,page_id,page_name").eq("company_id", companyId).maybeSingle(),
  ]);
  if (connRes.error) throw connRes.error;
  if (secretRes.error) throw secretRes.error;
  if (!connRes.data || connRes.data.source !== "real" || !secretRes.data) throw new Error("Conecte uma conta profissional da Meta primeiro.");
  const token = await decryptToken(secretRes.data.token_ciphertext);
  return { ...connRes.data, ...secretRes.data, token };
}

export async function subscribePage(pageId: string, token: string): Promise<boolean> {
  try {
    const form = new URLSearchParams({ subscribed_fields: "feed,messages" });
    await graphRequest(`${graphBase("facebook_login")}/${encodeURIComponent(pageId)}/subscribed_apps`, token, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form,
    });
    return true;
  } catch (error) { console.error("Could not subscribe page webhooks", error); return false; }
}

export async function subscribeInstagram(igId: string, token: string, flow: string) {
  return await subscribeWebhooks(igId, token, flow);
}
