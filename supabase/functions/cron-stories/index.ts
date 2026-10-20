import { realConnection } from "../_shared/connections.ts";
import { createAndPublishStory } from "../_shared/meta.ts";
import { clients, json } from "../_shared/http.ts";

function authorized(req: Request) {
  const secret = Deno.env.get("CRON_SECRET") || "";
  const supplied = req.headers.get("x-cron-secret") || "";
  return !!secret && supplied.length === secret.length && [...secret].every((char, i) => char.charCodeAt(0) === supplied.charCodeAt(i));
}

Deno.serve(async (req) => {
  if (req.method !== "POST" || !authorized(req)) return json({ detail: "Não autorizado." }, 401);
  try {
    const { admin } = clients();
    const { data: due, error } = await admin.from("stories").select("*").eq("status", "scheduled").lte("schedule_at", new Date().toISOString()).order("schedule_at").limit(50);
    if (error) throw error;
    let processed = 0;
    for (const story of due || []) {
      const { data: lock, error: lockError } = await admin.from("stories").update({ status: "publishing" })
        .eq("id", story.id).eq("status", "scheduled").select("id").maybeSingle();
      if (lockError) throw lockError;
      if (!lock) continue;
      try {
        const { data: connection, error: connectionError } = await admin.from("connections").select("*").eq("company_id", story.company_id).maybeSingle();
        if (connectionError) throw connectionError;
        if (!connection || connection.state !== "connected") throw new Error("Conecte o Instagram desta empresa para habilitar as funcionalidades.");
        if (connection.source !== "real") throw new Error("A publicação exige uma conexão real com a Meta.");
        {
          const conn = await realConnection(admin, story.company_id);
          let mediaUrl = String(story.media_url || "");
          if (story.media_storage_path) {
            const { data: signed, error: signedError } = await admin.storage.from("media").createSignedUrl(story.media_storage_path, 3600);
            if (signedError) throw signedError;
            mediaUrl = signed.signedUrl;
          }
          if (!mediaUrl.startsWith("https://")) throw new Error("A mídia precisa estar hospedada em HTTPS para ser publicada no Instagram.");
          const platformId = await createAndPublishStory(conn.ig_user_id, conn.token, mediaUrl, story.media_type === "video", conn.login_flow);
          const { error: updateError } = await admin.from("stories").update({ status: "published", execution: "real", platform_id: platformId, published_at: new Date().toISOString(), last_error: null }).eq("id", story.id);
          if (updateError) throw updateError;
        }
      } catch (error) {
        const attempts = Number(story.attempts || 0) + 1;
        const { error: updateError } = await admin.from("stories").update({
          status: attempts >= 3 ? "failed" : "scheduled", attempts,
          last_error: error instanceof Error ? error.message.slice(0, 500) : "Falha ao publicar o Story.",
        }).eq("id", story.id);
        if (updateError) console.error(updateError);
      }
      processed++;
    }
    return json({ ok: true, processed });
  } catch (error) { console.error("Scheduled Story processor failed", error); return json({ detail: "Falha processando Stories agendados." }, 500); }
});
