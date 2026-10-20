import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { realConnection } from "./connections.ts";
import { replyToComment, sendInstagramMessage } from "./meta.ts";

type EventContext = { conversationId?: string; commentId?: string };
const nodeData = (node: Record<string, any>) => node?.data && typeof node.data === "object" ? node.data as Record<string, any> : {};

export async function runAutomations(admin: SupabaseClient, companyId: string, triggerKind: "comment_received" | "message_received", text: string, context: EventContext = {}, source = "real") {
  const { data: automations, error } = await admin.from("automations").select("*").eq("company_id", companyId).eq("enabled", true);
  if (error) throw error;
  const { data: connection } = await admin.from("connections").select("*").eq("company_id", companyId).maybeSingle();
  let conversation: Record<string, any> | null = null;
  let comment: Record<string, any> | null = null;
  if (context.conversationId) {
    const { data } = await admin.from("conversations").select("*").eq("id", context.conversationId).eq("company_id", companyId).maybeSingle();
    conversation = data;
  }
  if (context.commentId) {
    const { data } = await admin.from("comments").select("*").eq("id", context.commentId).eq("company_id", companyId).maybeSingle();
    comment = data;
  }
  const results = [];
  for (const automation of automations || []) {
    const nodes: Record<string, any>[] = Array.isArray(automation.nodes) ? automation.nodes : [];
    const trigger = nodes.find((node) => nodeData(node).kind === "trigger" && nodeData(node).subtype === triggerKind);
    if (!trigger) continue;
    const triggerKeyword = String(nodeData(trigger).keyword || "").trim().toLowerCase();
    if (triggerKeyword && !text.toLowerCase().includes(triggerKeyword)) continue;
    const lines: string[] = [];
    let ended = false;
    let blocked = false;
    for (const node of nodes.filter((candidate) => nodeData(candidate).kind === "condition")) {
      const data = nodeData(node);
      if (data.subtype === "keyword" && data.keyword && !text.toLowerCase().includes(String(data.keyword).toLowerCase())) lines.push(`Palavra-chave “${data.keyword}” não corresponde.`);
      if (data.subtype === "has_tag" && data.tag && conversation && !(conversation.tags || []).includes(data.tag)) lines.push(`A conversa não possui a etiqueta “${data.tag}”.`);
      if (data.subtype === "business_hours") {
        const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: Deno.env.get("APP_TZ") || "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
        if (hour < 9 || hour >= 18) lines.push("Fora do horário comercial (09h–18h) — envio automático suspenso.");
      }
    }
    if (lines.length) {
      ended = true;
    } else {
      for (const node of nodes.filter((candidate) => nodeData(candidate).kind === "action")) {
        const data = nodeData(node);
        if (data.subtype === "reply_comment") {
          if (!comment || triggerKind !== "comment_received") { lines.push("Responder comentário: sem comentário de origem — ignorado."); continue; }
          if (!connection || connection.source !== "real" || !connection.enabled_features?.includes("comments")) { blocked = true; lines.push("Resposta automática de comentário bloqueada: conexão ou permissão ausente."); continue; }
          try {
            const conn = await realConnection(admin, companyId);
            await replyToComment(String(comment.platform_comment_id), String(data.text || ""), conn.token, conn.login_flow);
            await admin.from("comments").update({ reply_text: String(data.text || ""), replied_at: new Date().toISOString(), reply_source: "real", status: "replied" }).eq("id", comment.id).eq("company_id", companyId);
            lines.push("Comentário respondido automaticamente.");
          } catch (error) { blocked = true; lines.push(`Resposta de comentário falhou: ${error instanceof Error ? error.message : "erro da Meta"}`); }
        } else if (data.subtype === "send_message") {
          if (!connection || connection.state !== "connected") { blocked = true; lines.push("Envio de mensagem bloqueado: conexão ausente ou sem permissão."); continue; }
          if (triggerKind === "comment_received") {
            await admin.from("tasks").insert({ company_id: companyId, title: "Resposta privada autorizada ao comentário — enviar dentro da janela permitida.", source, done: false });
            lines.push("Resposta privada ao comentário encaminhada para tarefa.");
          } else if (conversation) {
            const { data: lastInbound } = await admin.from("messages").select("created_at")
              .eq("company_id", companyId).eq("conversation_id", conversation.id).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (!lastInbound || Date.now() - new Date(lastInbound.created_at).getTime() > 24 * 60 * 60_000) { blocked = true; lines.push("Mensagem automática bloqueada: a janela de resposta de 24 horas expirou."); continue; }
            if (connection.source !== "real") { blocked = true; lines.push("Envio de mensagem bloqueado: conexão real ausente."); continue; }
            const conn = await realConnection(admin, companyId);
            const sent = await sendInstagramMessage(conn.ig_user_id, String(conversation.platform_scoped_id || ""), String(data.text || ""), conn.token, conn.login_flow);
            await admin.from("messages").insert({ company_id: companyId, conversation_id: conversation.id, direction: "out", text: String(data.text || ""), source: "real", platform_message_id: String(sent.message_id || "") });
            await admin.from("conversations").update({ last_message_at: new Date().toISOString(), unread: 0 }).eq("id", conversation.id).eq("company_id", companyId);
            lines.push(`Mensagem enviada (“${String(data.text || "").slice(0, 60)}”).`);
          } else { ended = true; lines.push("Sem conversa ativa para enviar mensagem — automação encerrada."); }
        } else if (data.subtype === "apply_tag") {
          const tag = String(data.tag || "").trim();
          if (tag && conversation) {
            conversation.tags = [...new Set([...(conversation.tags || []), tag])];
            await admin.from("conversations").update({ tags: conversation.tags }).eq("id", conversation.id).eq("company_id", companyId);
            lines.push(`Etiqueta “${tag}” aplicada.`);
          }
        } else if (data.subtype === "create_task") {
          await admin.from("tasks").insert({ company_id: companyId, title: String(data.text || `Tarefa criada pela automação “${automation.name}”.`), source, done: false });
          lines.push("Tarefa interna criada.");
        } else if (data.subtype === "assign" && conversation && data.assignee) {
          conversation.assignee = String(data.assignee).trim();
          await admin.from("conversations").update({ assignee: conversation.assignee }).eq("id", conversation.id).eq("company_id", companyId);
          lines.push(`Atendimento atribuído a ${conversation.assignee}.`);
        } else if (data.subtype === "end") { ended = true; lines.push("Fluxo encerrado pela automação."); break; }
      }
    }
    const result = blocked ? "blocked" : ended ? "ended" : "executed";
    const { data: run, error: runError } = await admin.from("automation_runs").insert({
      company_id: companyId, automation_id: automation.id, automation_name: automation.name,
      trigger: triggerKind, matched_text: text.slice(0, 200), source, result, detail: lines.join(" | "),
    }).select("*").single();
    if (runError) throw runError;
    await admin.from("automations").update({ runs: Number(automation.runs || 0) + 1, last_run_at: new Date().toISOString() }).eq("id", automation.id).eq("company_id", companyId);
    results.push(run);
  }
  return results;
}
