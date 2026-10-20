import { realConnection } from "../_shared/connections.ts";
import { sendInstagramMessage } from "../_shared/meta.ts";
import { handleError, json, preflight, requireMember } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  try {
    const body = await req.json();
    const companyId = String(body.company_id || "");
    const conversationId = String(body.conversation_id || "");
    const text = String(body.text || "").trim();
    if (!text) return json({ detail: "A mensagem não pode ficar vazia." }, 400);
    const { admin } = await requireMember(req, companyId);
    const conn = await realConnection(admin, companyId);
    if (!conn.enabled_features?.includes("messages")) return json({ detail: "A conexão não tem permissão para mensagens." }, 403);
    const { data: conversation, error } = await admin.from("conversations").select("*").eq("id", conversationId).eq("company_id", companyId).maybeSingle();
    if (error) throw error;
    if (!conversation) return json({ detail: "Conversa não encontrada nesta empresa." }, 404);
    const recipientId = String(conversation.platform_scoped_id || "");
    if (!recipientId) return json({ detail: "Esta conversa ainda não possui um identificador de mensagem válido da Meta." }, 409);
    const { data: inbound, error: inboundError } = await admin.from("messages").select("created_at")
      .eq("company_id", companyId).eq("conversation_id", conversationId).eq("direction", "in")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (inboundError) throw inboundError;
    if (!inbound || Date.now() - new Date(inbound.created_at).getTime() > 24 * 60 * 60 * 1000) {
      return json({ detail: "A janela de resposta da Meta expirou. Aguarde uma nova mensagem do cliente antes de responder." }, 403);
    }
    const sent = await sendInstagramMessage(conn.ig_user_id, recipientId, text, conn.token, conn.login_flow);
    const { data: message, error: messageError } = await admin.from("messages").insert({
      company_id: companyId, conversation_id: conversationId, direction: "out", text, source: "real",
      platform_message_id: String(sent.message_id || ""),
    }).select("*").single();
    if (messageError) throw messageError;
    const { error: updateError } = await admin.from("conversations").update({ last_message_at: message.created_at, unread: 0, status: conversation.status === "resolved" ? "open" : conversation.status })
      .eq("id", conversationId).eq("company_id", companyId);
    if (updateError) throw updateError;
    return json(message);
  } catch (error) { return handleError(error); }
});
