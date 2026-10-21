import { clients, json } from "../_shared/http.ts";
import { runAutomations } from "../_shared/automation.ts";
import { runAiAssistant } from "../_shared/ai.ts";

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

async function verifySignature(raw: Uint8Array, header: string | null) {
  if (!header?.startsWith("sha256=")) return false;
  const received = Uint8Array.from((header.slice(7).match(/.{1,2}/g) || []).map((part) => Number.parseInt(part, 16)));
  for (const secret of [Deno.env.get("META_APP_SECRET"), Deno.env.get("INSTAGRAM_APP_SECRET")].filter(Boolean) as string[]) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
    if (equalBytes(expected, received)) return true;
  }
  return false;
}

async function findCompanyForEntry(admin: ReturnType<typeof clients>["admin"], accountId: string) {
  const { data: byIg } = await admin.from("connections").select("company_id,ig_user_id,login_flow,source").eq("ig_user_id", accountId).eq("source", "real").maybeSingle();
  if (byIg) return byIg;
  const { data: secret } = await admin.from("connection_secrets").select("company_id,page_id").eq("page_id", accountId).maybeSingle();
  if (!secret) return null;
  const { data: byPage } = await admin.from("connections").select("company_id,ig_user_id,login_flow,source").eq("company_id", secret.company_id).eq("source", "real").maybeSingle();
  return byPage || null;
}

async function saveInboundMessage(admin: ReturnType<typeof clients>["admin"], companyId: string, entryId: string, fromId: string, text: string, messageId: string) {
  if (messageId) {
    const { data: existing } = await admin.from("messages").select("id").eq("company_id", companyId).eq("platform_message_id", messageId).maybeSingle();
    if (existing) return null;
  }
  let { data: conversation } = await admin.from("conversations").select("*").eq("company_id", companyId).eq("platform_scoped_id", fromId).maybeSingle();
  if (!conversation) {
    const { data, error } = await admin.from("conversations").insert({
      company_id: companyId, platform_scoped_id: fromId, contact_name: `Contato ${fromId.slice(0, 8)}`,
      contact_username: `@${fromId}`, status: "open", assignee: "", tags: [], notes: [], unread: 0,
      last_message_at: new Date().toISOString(),
    }).select("*").single();
    if (error?.code === "23505") {
      ({ data: conversation } = await admin.from("conversations").select("*").eq("company_id", companyId).eq("platform_scoped_id", fromId).single());
    } else if (error) throw error;
    else conversation = data;
  }
  if (!conversation) return null;
  const { data: message, error } = await admin.from("messages").insert({
    company_id: companyId, conversation_id: conversation.id, direction: "in", text, source: "real", platform_message_id: messageId || "",
  }).select("*").single();
  if (error?.code === "23505") return null;
  if (error) throw error;
  const { error: updateError } = await admin.from("conversations").update({ last_message_at: message.created_at, unread: Number(conversation.unread || 0) + 1 }).eq("id", conversation.id).eq("company_id", companyId);
  if (updateError) throw updateError;
  return { conversationId: conversation.id, message };
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode") || url.searchParams.get("hub_mode");
    const token = url.searchParams.get("hub.verify_token") || url.searchParams.get("hub_verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge") || url.searchParams.get("hub_challenge") || "";
    const expected = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") || "";
    if (mode === "subscribe" && expected && token === expected) return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
    return json({ detail: "Verificação de webhook falhou." }, 403);
  }
  if (req.method !== "POST") return json({ detail: "Método não permitido." }, 405);
  const raw = new Uint8Array(await req.arrayBuffer());
  if (!await verifySignature(raw, req.headers.get("x-hub-signature-256"))) return json({ detail: "Assinatura de webhook inválida." }, 403);
  let payload: Record<string, any>;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); }
  catch { return json({ detail: "Payload inválido." }, 400); }
  const { admin } = clients();
  const digest = await crypto.subtle.digest("SHA-256", raw);
  const eventId = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const { error: dedupeError } = await admin.from("webhook_events").insert({ event_id: eventId });
  if (dedupeError?.code === "23505") return json({ ok: true, dedup: true });
  if (dedupeError) return json({ detail: "Não foi possível registrar o evento." }, 500);

  try {
    for (const entry of payload.entry || []) {
      const account = await findCompanyForEntry(admin, String(entry.id || ""));
      if (!account) continue;
      const companyId = account.company_id;
      for (const event of entry.messaging || []) {
        if (event.message?.is_echo) continue;
        const text = String(event.message?.text || "").trim();
        const sender = String(event.sender?.id || "");
        if (!text || !sender || sender === String(account.ig_user_id)) continue;
        const saved = await saveInboundMessage(admin, companyId, String(entry.id), sender, text, String(event.message?.mid || ""));
        if (saved) {
          await runAutomations(admin, companyId, "message_received", text, { conversationId: saved.conversationId }, "real");
          try { await runAiAssistant(admin, companyId, "message", text, saved.conversationId); }
          catch (error) { console.error("AI assistant message reply failed", error); }
        }
      }
      for (const change of entry.changes || []) {
        if (change.field !== "comments" && !(change.field === "feed" && change.value?.item === "comment")) continue;
        const value = change.value || {};
        const platformId = String(value.id || value.comment_id || "");
        const text = String(value.text || "").trim();
        if (!platformId || !text) continue;
        const { data: existing } = await admin.from("comments").select("id").eq("company_id", companyId).eq("platform_comment_id", platformId).maybeSingle();
        if (existing) continue;
        const { data: comment, error } = await admin.from("comments").insert({
          company_id: companyId, platform_comment_id: platformId, post_id: String(value.media?.id || ""),
          post_caption: "", author: String(value.from?.username || value.from?.id || "@desconhecido"),
          text, status: "new", source: "real",
        }).select("*").single();
        if (error?.code === "23505") continue;
        if (error) throw error;
        await runAutomations(admin, companyId, "comment_received", text, { commentId: comment.id }, "real");
        try { await runAiAssistant(admin, companyId, "comment", text, comment.id); }
        catch (error) { console.error("AI assistant comment reply failed", error); }
      }
    }
    return json({ ok: true });
  } catch (error) {
    console.error("Instagram webhook processing failed", error);
    // Meta retries non-2xx deliveries; the event fingerprint is removed so retry can process it.
    await admin.from("webhook_events").delete().eq("event_id", eventId);
    return json({ detail: "Falha processando o webhook." }, 500);
  }
});

