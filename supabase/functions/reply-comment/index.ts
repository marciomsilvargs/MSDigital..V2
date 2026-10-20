import { realConnection } from "../_shared/connections.ts";
import { replyToComment } from "../_shared/meta.ts";
import { handleError, json, preflight, requireMember } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  try {
    const body = await req.json();
    const companyId = String(body.company_id || "");
    const commentId = String(body.comment_id || "");
    const text = String(body.text || "").trim();
    if (!text) return json({ detail: "A resposta não pode ficar vazia." }, 400);
    const { admin } = await requireMember(req, companyId);
    const conn = await realConnection(admin, companyId);
    if (!conn.enabled_features?.includes("comments")) return json({ detail: "A conexão não tem permissão para responder comentários." }, 403);
    const { data: comment, error } = await admin.from("comments").select("*").eq("id", commentId).eq("company_id", companyId).maybeSingle();
    if (error) throw error;
    if (!comment) return json({ detail: "Comentário não encontrado nesta empresa." }, 404);
    if (!comment.platform_comment_id) return json({ detail: "Este comentário não tem um identificador válido da Meta." }, 409);
    await replyToComment(comment.platform_comment_id, text, conn.token, conn.login_flow);
    const { data: updated, error: updateError } = await admin.from("comments").update({
      reply_text: text, replied_at: new Date().toISOString(), reply_source: "real", status: "replied",
    }).eq("id", commentId).eq("company_id", companyId).select("*").single();
    if (updateError) throw updateError;
    return json(updated);
  } catch (error) { return handleError(error); }
});
