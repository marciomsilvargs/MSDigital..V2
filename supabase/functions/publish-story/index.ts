import { realConnection } from "../_shared/connections.ts";
import { createAndPublishStory } from "../_shared/meta.ts";
import { handleError, json, preflight, requireMember } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  let admin: ReturnType<typeof import("../_shared/http.ts").clients>["admin"] | null = null;
  let companyId = "";
  let storyId = "";
  try {
    const body = await req.json();
    companyId = String(body.company_id || "");
    storyId = String(body.story_id || "");
    ({ admin } = await requireMember(req, companyId));
    const conn = await realConnection(admin, companyId);
    if (conn.state !== "connected" && conn.state !== "partially_connected") return json({ detail: "A conexão do Instagram não está habilitada." }, 403);
    const { data: story, error } = await admin.from("stories").select("*").eq("id", storyId).eq("company_id", companyId).maybeSingle();
    if (error) throw error;
    if (!story) return json({ detail: "Story não encontrado nesta empresa." }, 404);
    if (["published", "publishing"].includes(story.status)) return json({ detail: "Este story já foi enviado ou está em processamento." }, 409);
    if (!conn.enabled_features?.includes("publish")) return json({ detail: "A conexão não tem permissão para publicar conteúdo." }, 403);
    let mediaUrl = String(story.media_url || "");
    if (story.media_storage_path) {
      const { data, error: signedError } = await admin.storage.from("media").createSignedUrl(story.media_storage_path, 3600);
      if (signedError) throw signedError;
      mediaUrl = data.signedUrl;
    }
    if (!mediaUrl.startsWith("https://")) return json({ detail: "A mídia precisa estar hospedada em HTTPS para ser publicada no Instagram." }, 400);
    const { data: locked, error: lockError } = await admin.from("stories").update({ status: "publishing", execution: "real", last_error: null })
      .eq("id", storyId).eq("company_id", companyId).not("status", "in", "(published,publishing)").select("id").maybeSingle();
    if (lockError) throw lockError;
    if (!locked) return json({ detail: "Este story já foi enviado ou está em processamento." }, 409);
    try {
      const platformId = await createAndPublishStory(conn.ig_user_id, conn.token, mediaUrl, story.media_type === "video", conn.login_flow);
      const { data: updated, error: updateError } = await admin.from("stories").update({
        status: "published", execution: "real", platform_id: platformId, published_at: new Date().toISOString(), last_error: null,
      }).eq("id", storyId).eq("company_id", companyId).select("*").single();
      if (updateError) throw updateError;
      return json(updated);
    } catch (error) {
      await admin.from("stories").update({ status: "failed", execution: "real", attempts: Number(story.attempts || 0) + 1, last_error: error instanceof Error ? error.message : "Falha ao publicar." }).eq("id", storyId).eq("company_id", companyId);
      throw error;
    }
  } catch (error) { return handleError(error); }
});
