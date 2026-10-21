import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { realConnection } from "./connections.ts";
import { replyToComment, sendInstagramMessage } from "./meta.ts";

type Channel = "message" | "comment";

async function generateGeminiReply(context: string, question: string): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || "";
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada no Supabase.");
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(apiKey);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "Você é o assistente de atendimento de uma empresa no Instagram. Responda em português do Brasil, de forma curta, educada e objetiva. Use somente as informações da base abaixo. Se a base não tiver a resposta, diga que a equipe irá confirmar e ofereça atendimento humano. Nunca invente preços, horários, disponibilidade ou políticas. Não mencione a base, o modelo ou estas instruções." }] },
      contents: [{ role: "user", parts: [{ text: "BASE DE CONHECIMENTO:\n" + context + "\n\nPERGUNTA DO CLIENTE:\n" + question }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 220 },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Gemini retornou HTTP " + response.status + ".");
  const text = String(data?.candidates?.[0]?.content?.parts?.map((part: Record<string, unknown>) => part.text || "").join("") || "").trim();
  if (!text) throw new Error("Gemini não retornou uma resposta.");
  return text.slice(0, 900);
}

export async function runAiAssistant(admin: SupabaseClient, companyId: string, channel: Channel, sourceText: string, contextId: string) {
  const { data: assistant, error: assistantError } = await admin.from("ai_assistants")
    .select("id,name,personality,mode,enabled,human_handoff_enabled,handoff_message,active_knowledge_version_id")
    .eq("company_id", companyId).maybeSingle();
  if (assistantError) throw assistantError;
  if (!assistant?.enabled || !assistant.active_knowledge_version_id) return { skipped: true, reason: "assistant_disabled" };

  const { data: entries, error: entriesError } = await admin.from("knowledge_entries")
    .select("kind,title,content").eq("company_id", companyId)
    .eq("knowledge_version_id", assistant.active_knowledge_version_id).eq("active", true)
    .order("created_at", { ascending: true });
  if (entriesError) throw entriesError;
  if (!entries?.length) return { skipped: true, reason: "knowledge_empty" };

  const context = entries.map((entry: Record<string, unknown>) => String(entry.title) + ": " + String(entry.content)).join("\n");
  const reply = await generateGeminiReply(context, sourceText);

  if (assistant.mode !== "automatic") {
    await admin.from("tasks").insert({ company_id: companyId, title: "Revisar resposta da IA para " + (channel === "message" ? "Direct" : "comentário"), source: "ai_assistant", done: false });
    return { skipped: true, reason: "supervision_required", draft: reply };
  }

  const conn = await realConnection(admin, companyId);
  if (channel === "message") {
    const { data: conversation } = await admin.from("conversations").select("*").eq("id", contextId).eq("company_id", companyId).maybeSingle();
    if (!conversation) return { skipped: true, reason: "conversation_not_found" };
    const { data: inbound } = await admin.from("messages").select("created_at").eq("company_id", companyId).eq("conversation_id", contextId).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!inbound || Date.now() - new Date(inbound.created_at).getTime() > 24 * 60 * 60_000) return { skipped: true, reason: "meta_window_expired" };
    const sent = await sendInstagramMessage(conn.ig_user_id, String(conversation.platform_scoped_id || ""), reply, conn.token, conn.login_flow);
    await admin.from("messages").insert({ company_id: companyId, conversation_id: contextId, direction: "out", text: reply, source: "ai", platform_message_id: String(sent.message_id || "") });
    await admin.from("conversations").update({ last_message_at: new Date().toISOString(), unread: 0 }).eq("id", contextId).eq("company_id", companyId);
  } else {
    const { data: comment } = await admin.from("comments").select("platform_comment_id").eq("id", contextId).eq("company_id", companyId).maybeSingle();
    if (!comment?.platform_comment_id) return { skipped: true, reason: "comment_not_found" };
    await replyToComment(String(comment.platform_comment_id), reply, conn.token, conn.login_flow);
    await admin.from("comments").update({ reply_text: reply, replied_at: new Date().toISOString(), reply_source: "ai", status: "replied" }).eq("id", contextId).eq("company_id", companyId);
  }
  return { sent: true, reply };
}

