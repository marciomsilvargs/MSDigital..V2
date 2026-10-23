export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
];
export const FB_SCOPES = [
  "instagram_basic", "instagram_content_publish", "instagram_manage_comments",
  "instagram_manage_messages", "pages_show_list", "pages_read_engagement",
];

export function apiVersion(flow: string): string {
  return Deno.env.get(flow === "facebook_login" ? "META_FB_API_VERSION" : "META_API_VERSION") || "v26.0";
}
export function graphHost(flow: string): string {
  return flow === "facebook_login" ? "graph.facebook.com" : "graph.instagram.com";
}
export function graphBase(flow: string): string {
  return `https://${graphHost(flow)}/${apiVersion(flow)}`;
}

export async function graphRequest(path: string, token: string, init: RequestInit = {}): Promise<Record<string, any>> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Graph API retornou HTTP ${response.status}.`);
  return data;
}

export async function exchangeInstagramCode(code: string, redirectUri: string) {
  const clientId = Deno.env.get("INSTAGRAM_APP_ID") || "";
  const clientSecret = Deno.env.get("INSTAGRAM_APP_SECRET") || "";
  if (!clientId || !clientSecret) throw new Error("Login do Instagram não está configurado no Supabase.");
  const shortResponse = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code }),
  });
  const short = await shortResponse.json();
  if (!shortResponse.ok) throw new Error(`Meta não aceitou o código OAuth (${shortResponse.status}).`);
  const longToken = await graphRequest("https://graph.instagram.com/access_token?" + new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: clientSecret, access_token: short.access_token }), short.access_token);
  const version = apiVersion("instagram_login");
  const profile = await graphRequest(`https://graph.instagram.com/${version}/me?` + new URLSearchParams({ fields: "user_id,id,username,name,account_type,profile_picture_url" }), longToken.access_token);
  return { token: longToken.access_token as string, expiresIn: Number(longToken.expires_in || 5_184_000), scopes: (short.permissions || IG_SCOPES) as string[], profile };
}

export async function exchangeFacebookCode(code: string, redirectUri: string) {
  const appId = Deno.env.get("META_APP_ID") || "";
  const secret = Deno.env.get("META_APP_SECRET") || "";
  if (!appId || !secret) throw new Error("Login do Facebook não está configurado no Supabase.");
  const base = graphBase("facebook_login");
  const short = await graphRequest(`${base}/oauth/access_token?` + new URLSearchParams({ client_id: appId, client_secret: secret, redirect_uri: redirectUri, code }), "");
  const long = await graphRequest(`${base}/oauth/access_token?` + new URLSearchParams({ client_id: appId, client_secret: secret, grant_type: "fb_exchange_token", fb_exchange_token: short.access_token }), "");
  const permissions = await graphRequest(`${base}/me/permissions`, long.access_token);
  const scopes = (permissions.data || []).filter((item: Record<string, string>) => item.status === "granted").map((item: Record<string, string>) => item.permission);
  const pageList = await graphRequest(`${base}/me/accounts?` + new URLSearchParams({ fields: "id,name,access_token,instagram_business_account{id,username,profile_picture_url}" }), long.access_token);
  return { expiresIn: Number(long.expires_in || 5_184_000), scopes, pages: pageList.data || [] };
}

export async function subscribeWebhooks(igUserId: string, token: string, flow: string) {
  const base = graphBase(flow);
  const body = new URLSearchParams({ subscribed_fields: "comments,messages" });
  try {
    await graphRequest(`${base}/${encodeURIComponent(igUserId)}/subscribed_apps`, token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    return true;
  } catch (error) { console.error("Could not subscribe Instagram webhooks", error); return false; }
}

export async function createAndPublishStory(igId: string, token: string, mediaUrl: string, video: boolean, flow: string) {
  const base = graphBase(flow);
  const params = new URLSearchParams({ media_type: "STORIES", [video ? "video_url" : "image_url"]: mediaUrl });
  const container = await graphRequest(`${base}/${encodeURIComponent(igId)}/media`, token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params });
  let finished = false;
  for (let i = 0; i < 24; i++) {
    const status = await graphRequest(`${base}/${encodeURIComponent(container.id)}?fields=status_code`, token);
    if (status.status_code === "FINISHED") { finished = true; break; }
    if (status.status_code === "ERROR") throw new Error("Instagram não conseguiu processar a mídia do Story.");
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (!finished) throw new Error("Tempo esgotado aguardando o processamento da mídia no Instagram.");
  const published = await graphRequest(`${base}/${encodeURIComponent(igId)}/media_publish`, token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: String(container.id) }) });
  return String(published.id || "");
}

export async function fetchStoryInsights(mediaId: string, token: string, flow: string) {
  const base = graphBase(flow);
  const metrics = "impressions,reach,replies,exits,taps_forward,taps_back";
  try {
    return await graphRequest(`${base}/${encodeURIComponent(mediaId)}/insights?` + new URLSearchParams({ metric: metrics }), token);
  } catch (error) {
    // Meta can reject metrics that are unavailable for a specific account or
    // API version. Keep the useful core metrics in that case.
    return await graphRequest(`${base}/${encodeURIComponent(mediaId)}/insights?` + new URLSearchParams({ metric: "impressions,reach" }), token);
  }
}

export async function deleteInstagramMedia(mediaId: string, token: string, flow: string) {
  return await graphRequest(`${graphBase(flow)}/${encodeURIComponent(mediaId)}`, token, { method: "DELETE" });
}

export async function sendInstagramMessage(igId: string, recipientId: string, text: string, token: string, flow: string) {
  return await graphRequest(`${graphBase(flow)}/${encodeURIComponent(igId)}/messages`, token, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
}

export async function replyToComment(commentId: string, text: string, token: string, flow: string) {
  const body = new URLSearchParams({ message: text });
  return await graphRequest(`${graphBase(flow)}/${encodeURIComponent(commentId)}/replies`, token, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  });
}

