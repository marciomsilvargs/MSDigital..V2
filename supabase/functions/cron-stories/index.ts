import { realConnection } from "../_shared/connections.ts";
import { createAndPublishStory, deleteInstagramMedia, fetchStoryInsights } from "../_shared/meta.ts";
import { clients, json } from "../_shared/http.ts";

function authorized(req: Request) {
  const secret = Deno.env.get("CRON_SECRET") || "";
  const supplied = req.headers.get("x-cron-secret") || "";
  return !!secret && supplied.length === secret.length && [...secret].every((char, i) => char.charCodeAt(0) === supplied.charCodeAt(i));
}

function metricValue(data: any[], name: string): number | null {
  const item = data.find((entry) => entry?.name === name);
  const value = Array.isArray(item?.values) ? item.values[0]?.value : item?.value;
  return Number.isFinite(Number(value)) ? Number(value) : null;
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
    const now = new Date();
    const capturedAt = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();

    // Refresh Story metrics while they are still available from Meta. The
    // hourly key prevents the one-minute scheduler from creating duplicates.
    const { data: metricStories, error: metricError } = await admin.from("stories")
      .select("id,company_id,platform_id,published_at")
      .eq("status", "published")
      .not("platform_id", "is", null)
      .neq("platform_id", "")
      .gte("published_at", new Date(now.getTime() - 48 * 3_600_000).toISOString())
      .limit(100);
    if (metricError) throw metricError;
    for (const story of metricStories || []) {
      try {
        const conn = await realConnection(admin, story.company_id);
        const insights = await fetchStoryInsights(story.platform_id, conn.token, conn.login_flow);
        const values = Array.isArray(insights.data) ? insights.data : [];
        await admin.from("story_insights").upsert({
          company_id: story.company_id, story_id: story.id, captured_at: capturedAt,
          impressions: metricValue(values, "impressions"), reach: metricValue(values, "reach"),
          replies: metricValue(values, "replies"), exits: metricValue(values, "exits"),
          taps_forward: metricValue(values, "taps_forward"), taps_back: metricValue(values, "taps_back"), raw: insights,
        }, { onConflict: "story_id,captured_at" });
      } catch (error) {
        console.error("Could not collect Story insights", story.id, error);
      }
    }

    const { data: deleteDue, error: deleteQueryError } = await admin.from("stories").select("*")
      .eq("delete_status", "scheduled").lte("delete_at", now.toISOString()).limit(50);
    if (deleteQueryError) throw deleteQueryError;
    for (const story of deleteDue || []) {
      await admin.from("stories").update({ delete_status: "deleting", delete_error: null }).eq("id", story.id).eq("delete_status", "scheduled");
      try {
        if (!story.platform_id) throw new Error("O Story ainda não possui um ID publicado no Instagram.");
        const conn = await realConnection(admin, story.company_id);
        await deleteInstagramMedia(story.platform_id, conn.token, conn.login_flow);
        await admin.from("stories").update({ delete_status: "deleted", deleted_at: now.toISOString(), delete_error: null }).eq("id", story.id);
      } catch (error) {
        await admin.from("stories").update({ delete_status: "failed", delete_error: error instanceof Error ? error.message.slice(0, 500) : "Falha ao excluir o Story." }).eq("id", story.id);
      }
    }

    return json({ ok: true, processed, insights: (metricStories || []).length, deletions: (deleteDue || []).length });
  } catch (error) { console.error("Scheduled Story processor failed", error); return json({ detail: "Falha processando Stories agendados." }, 500); }
});

