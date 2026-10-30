import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { realConnection } from "./connections.ts";
import { isAssociationIntent, normalizeIntentText, updateLeadStage, upsertAssociationLead } from "./leads.ts";
import { replyToComment, sendInstagramMessage } from "./meta.ts";

type Channel = "message" | "comment";
type KnowledgeEntry = { kind: string; title: string; content: string };

function knowledgeReply(entries: KnowledgeEntry[], sourceText: string, handoffMessage: string, previousStage?: string) {
  const normalized = normalizeIntentText(sourceText);
  if (/\b(atendente|pessoa|humano|equipe|falar com alguem)\b/.test(normalized)) return handoffMessage;
  if (/\b(nao|sem interesse|talvez depois)\b/.test(normalized)) return "Sem problemas! 😊 Agradecemos seu contato. Quando quiser conhecer melhor o Alpha Clube de Tiro, estaremos à disposição!";
  const prices = entries.filter((entry) => entry.kind === "price");
  const benefits = entries.filter((entry) => /beneficio|estrutura|vantagem/.test(normalizeIntentText(entry.title + " " + entry.content)));
  const asksPrice = /\b(valor|valores|preco|precos|mensalidade|quanto custa|custa)\b/.test(normalized);
  const asksBenefits = /\b(beneficio|beneficios|vantagem|estrutura)\b/.test(normalized);
  const positive = /\b(sim|quero|pode mandar|tenho interesse|gostaria|plano|associ)\b/.test(normalized);
  if (isAssociationIntent(sourceText) && (previousStage === "new" || !previousStage) && !asksPrice && !asksBenefits) {
    return "Olá! 👋 Tudo bem?\n\nQue bom saber do seu interesse em fazer parte do Alpha Clube de Tiro! 🎯\n\nSerá um prazer apresentar nossos planos de associação, benefícios e condições.\n\nVocê gostaria de conhecer nossos planos?";
  }
  if ((asksPrice || positive) && prices.length) {
    const details = prices.slice(0, 4).map((entry) => `• ${entry.title}: ${entry.content}`).join("\n");
    return `Perfeito! 😊\n\nVou te apresentar as opções de associação disponíveis no Alpha Clube de Tiro.\n\n${details}\n\nAlgum desses planos chamou sua atenção? Posso encaminhar você para nossa equipe e ajudar com os próximos passos. 😊`;
  }
  if (asksBenefits && benefits.length) {
    const details = benefits.slice(0, 4).map((entry) => `• ${entry.title}: ${entry.content}`).join("\n");
    return `Com certeza! Vou te apresentar os benefícios disponíveis para os associados.\n\n${details}\n\nQuer que eu encaminhe você para nossa equipe?`;
  }
  return null;
}

async function generateGeminiReply(context: string, question: string): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || "";
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada no Supabase.");
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(apiKey);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "Você é o assistente de atendimento de uma empresa no Instagram. Responda em português do Brasil, de forma curta, educada e objetiva. Use somente as informações da base abaixo. Para dúvidas sobre associação, planos, mensalidade, valores ou benefícios, apresente apenas dados cadastrados. Se a base não tiver a resposta, diga que a equipe irá confirmar e ofereça atendimento humano. Se a pessoa pedir atendimento humano, confirme o encaminhamento. Nunca invente preços, horários, disponibilidade, promoções ou políticas. Não mencione a base, o modelo ou estas instruções." }] },
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

export async function runAiAssistant(admin: SupabaseClient, companyId: string, channel: Channel, sourceText: string, contextId: string, socialUserId = "", publicName = "") {
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
  const leadContext = channel === "message"
    ? { conversationId: contextId, socialUserId, publicName }
    : { commentId: contextId, socialUserId, publicName };
  let lead: { id: string; stage: string } | null = null;
  if (isAssociationIntent(sourceText)) {
    lead = await upsertAssociationLead(admin, companyId, leadContext, sourceText);
    const normalized = normalizeIntentText(sourceText);
    const requestedHuman = /\b(atendente|pessoa|humano|equipe|falar com alguem)\b/.test(normalized);
    const declined = /\b(nao|sem interesse|talvez depois)\b/.test(normalized);
    const positive = /\b(sim|quero|pode|gostaria|valor|quanto|plano|associ)\b/.test(normalized);
    const stage = requestedHuman ? "sales" : declined ? "closed" : positive ? "interested" : "new";
    if (!lead || !["sales", "converted"].includes(String(lead.stage))) await updateLeadStage(admin, companyId, leadContext, sourceText, stage);
  }
  const reply = knowledgeReply(entries as KnowledgeEntry[], sourceText, assistant.handoff_message, lead?.stage)
    || await generateGeminiReply(context, sourceText);

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

