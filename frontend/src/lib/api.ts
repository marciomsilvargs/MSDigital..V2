import { requireSupabase } from "@/lib/supabase";

// Compatibility facade while pages are moved to Supabase. All regular data reads and
// writes go directly to Postgres through supabase-js; privileged Meta actions call Edge Functions.
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const normalized = typeof body === "string" ? { detail: body } : body;
    const detail = normalized && typeof normalized === "object" && "detail" in normalized
      ? String((normalized as { detail: unknown }).detail)
      : `request failed with ${status}`;
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.body = normalized;
  }
}

type Row = Record<string, any>;
type Body = Record<string, any>;
const db = () => requireSupabase() as any;
const fail = (error: any): never => { throw new ApiError(Number(error?.status) || 400, { detail: error?.message || error?.details || String(error) }); };
async function result<T>(query: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await query;
  if (error) fail(error);
  return data;
}
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

async function company(companyId: string): Promise<Row> {
  const row = await result<Row | null>(db().from("companies").select("*").eq("id", companyId).maybeSingle());
  if (!row) throw new ApiError(404, "Empresa não encontrada.");
  return row;
}
async function companyView(companyId: string): Promise<Row> {
  const row = await company(companyId);
  row.employees = await result<Row[]>(db().from("employees").select("*").eq("company_id", companyId).order("created_at"));
  return row;
}
async function connectionStatus(companyId: string): Promise<Row> {
  return await edge<Row>("meta-connect-status", { company_id: companyId });
}
async function upsertConnection(companyId: string, values: Body | null): Promise<Row> {
  if (values) await result(db().from("connections").upsert({ company_id: companyId, ...values, updated_at: now() }));
  return connectionStatus(companyId);
}
async function edge<T>(name: string, body: Body): Promise<T> {
  const { data, error } = await db().functions.invoke(name, { body });
  if (error) {
    let responseBody: unknown = data;
    const response = error?.context instanceof Response ? error.context as Response : null;
    if (response) {
      try { responseBody = await response.clone().json(); }
      catch { responseBody = { detail: error.message || "A função do Supabase não respondeu corretamente." }; }
    }
    throw new ApiError(Number(response?.status) || Number(error?.status) || 500, responseBody || { detail: error?.message || "Falha na função do Supabase." });
  }
  return data as T;
}
async function insertRow<T>(table: string, values: Body): Promise<T> {
  return result<T>(db().from(table).insert(values).select("*").single());
}
async function withSignedMedia<T extends Row>(rows: T[], pathKey = "storage_path"): Promise<T[]> {
  const client = db();
  return await Promise.all(rows.map(async (row) => {
    if (!row[pathKey]) return row;
    const { data, error } = await client.storage.from("media").createSignedUrl(row[pathKey], 3600);
    if (error) fail(error);
    return { ...row, url: data.signedUrl };
  }));
}

/**
 * Instagram overlays the account header, reply field, and action buttons above a
 * Story. Convert regular image uploads to a 1080×1920 composition with a safe
 * foreground area so text placed near the edges is not hidden by those controls.
 */
async function prepareStoryImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  try {
    const image = await createImageBitmap(file);
    const width = 1080;
    const height = 1920;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;

    // A blurred cover image keeps the frame visually full while the source is
    // reduced into the Instagram safe area (top 250px / bottom 270px).
    const backgroundScale = Math.max(width / image.width, height / image.height);
    const backgroundWidth = image.width * backgroundScale;
    const backgroundHeight = image.height * backgroundScale;
    context.filter = "blur(28px) brightness(0.48)";
    context.drawImage(image, (width - backgroundWidth) / 2, (height - backgroundHeight) / 2, backgroundWidth, backgroundHeight);
    context.filter = "none";

    const safeLeft = 54;
    const safeTop = 250;
    const safeWidth = width - safeLeft * 2;
    const safeHeight = height - safeTop - 270;
    const foregroundScale = Math.min(safeWidth / image.width, safeHeight / image.height);
    const foregroundWidth = image.width * foregroundScale;
    const foregroundHeight = image.height * foregroundScale;
    context.drawImage(image, (width - foregroundWidth) / 2, safeTop + (safeHeight - foregroundHeight) / 2, foregroundWidth, foregroundHeight);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return file;
    const safeName = file.name.replace(/\.[^.]+$/, "") || "story";
    return new File([blob], `${safeName}-story.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}
async function updateRow<T>(table: string, rowId: string, values: Body, companyId?: string): Promise<T> {
  let query = db().from(table).update(values).eq("id", rowId);
  if (companyId) query = query.eq("company_id", companyId);
  return result<T>(query.select("*").single());
}

async function request<T>(method: string, path: string, body?: Body | null): Promise<T> {
  const parsed = new URL(path, "http://local");
  const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const query = parsed.searchParams;
  const payload = body ?? {};

  if (parts[0] !== "companies") {
    if (parts[0] === "status") return [] as T;
    throw new ApiError(404, `Rota não mapeada para Supabase: ${method} ${path}`);
  }

  // Company registry and staff.
  if (parts.length === 1) {
    if (method === "GET") {
      const companies = await result<Row[]>(db().from("companies").select("*").order("created_at"));
      const employees = await result<Row[]>(db().from("employees").select("*"));
      return companies.map((c) => ({ ...c, employees: employees.filter((e) => e.company_id === c.id) })) as T;
    }
    if (method === "POST") {
      const name = String(payload.name ?? "").trim();
      if (!name) throw new ApiError(400, "Informe o nome da empresa.");
      const { data: row, error } = await db().rpc("create_company_for_current_user", {
        company_name: name,
        company_segment: String(payload.segment ?? "").trim(),
      });
      if (error) fail(error);
      return { ...row, employees: [] } as T;
    }
  }

  const companyId = parts[1];
  if (!companyId) throw new ApiError(400, "Empresa inválida.");
  if (parts.length === 2) {
    if (method === "GET") return await companyView(companyId) as T;
    if (method === "PATCH") return await updateRow<Row>("companies", companyId, payload).then((r) => ({ ...r, employees: [] })) as T;
    if (method === "DELETE") { await result(db().from("companies").delete().eq("id", companyId)); return undefined as T; }
  }

  if (parts[2] === "employees") {
    if (method === "POST") {
      await company(companyId);
      const name = String(payload.name ?? "").trim();
      if (!name) throw new ApiError(400, "Informe o nome do funcionário.");
      await insertRow("employees", { company_id: companyId, name, role: String(payload.role ?? "atendente").trim() || "atendente", email: String(payload.email ?? "").trim() });
      return await companyView(companyId) as T;
    }
    if (method === "DELETE" && parts[3]) {
      await result(db().from("employees").delete().eq("id", parts[3]).eq("company_id", companyId));
      return await companyView(companyId) as T;
    }
  }

  // Instagram connection. Real OAuth/token work is intentionally delegated to a Supabase Edge Function.
  if (parts[2] === "connection") {
    if (parts.length === 3 && method === "GET") return await connectionStatus(companyId) as T;
    const action = parts[3];
    if (action === "connect" && parts[4] === "start" && method === "POST") return await edge<T>("meta-connect-start", { company_id: companyId, flow: payload.flow || "instagram_login" });
    if (action === "connect" && parts[4] === "cancel" && method === "POST") {
      const current = await result<Row | null>(db().from("connections").select("source").eq("company_id", companyId).maybeSingle());
      if (current?.source === "real") await edge("meta-connect-disconnect", { company_id: companyId, cancel: true });
      else await result(db().from("connections").delete().eq("company_id", companyId));
      return await connectionStatus(companyId) as T;
    }
    if (["verify", "sync"].includes(action) && method === "POST") {
      const row = await result<Row | null>(db().from("connections").select("*").eq("company_id", companyId).maybeSingle());
      if (row?.source === "real") return await edge<T>("meta-connect-verify", { company_id: companyId });
      return await upsertConnection(companyId, row ? { last_synced_at: now() } : null) as T;
    }
    if (action === "disconnect" && method === "POST") {
      const current = await result<Row | null>(db().from("connections").select("source").eq("company_id", companyId).maybeSingle());
      if (current?.source === "real") await edge("meta-connect-disconnect", { company_id: companyId });
      else await result(db().from("connections").delete().eq("company_id", companyId));
      return await connectionStatus(companyId) as T;
    }
    if (action === "connect" && parts[4] === "pending" && method === "GET") return await edge<T>("meta-connect-pending", { company_id: companyId, pending_id: parts[5] });
    if (action === "connect" && parts[4] === "select" && method === "POST") return await edge<T>("meta-connect-select", { company_id: companyId, ...payload });
  }

  // Stories and media library.
  if (parts[2] === "media" && parts.length === 3 && method === "GET") return await withSignedMedia(await result<Row[]>(db().from("media").select("*").eq("company_id", companyId).order("created_at", { ascending: false }))) as T;
  if (parts[2] === "media" && method === "POST") {
    const url = String(payload.url ?? "").trim();
    if (!url) throw new ApiError(400, "Informe a URL da mídia.");
    const media_type = payload.media_type || (/\.(mp4|mov|webm)(\?|$)/i.test(url) ? "video" : "image");
    return await insertRow("media", { company_id: companyId, url, media_type, name: payload.name || "mídia externa" }) as T;
  }
  if (parts[2] === "stories" && parts.length === 3 && method === "GET") {
    let q = db().from("stories").select("*").eq("company_id", companyId).order("schedule_at");
    if (query.get("status")) q = q.eq("status", query.get("status"));
    return await withSignedMedia(await result<Row[]>(q), "media_storage_path") as T;
  }
  if (parts[2] === "stories" && parts.length === 3 && method === "POST") {
    const media = await result<Row | null>(db().from("media").select("*").eq("id", payload.media_id).eq("company_id", companyId).maybeSingle());
    if (!media) throw new ApiError(404, "Mídia não encontrada nesta empresa.");
    const scheduleAt = String(payload.schedule_at ?? "");
    if (!scheduleAt || Number.isNaN(Date.parse(scheduleAt))) throw new ApiError(400, "Escolha uma data e horário válidos.");
    const conn = await result<Row | null>(db().from("connections").select("state,source,enabled_features").eq("company_id", companyId).maybeSingle());
    const execution = conn && ["connected", "partially_connected"].includes(conn.state) && conn.enabled_features?.includes("publish") ? conn.source : "pending";
    return await insertRow("stories", { company_id: companyId, media_url: media.url, media_storage_path: media.storage_path ?? null, media_type: media.media_type, caption: String(payload.caption ?? "").trim(), schedule_at: new Date(scheduleAt).toISOString(), status: payload.as_draft ? "draft" : "scheduled", execution }) as T;
  }
  if (parts[2] === "stories" && parts[3]) {
    const storyId = parts[3];
    if (parts[4] === "publish-now" && method === "POST") {
      const story = await result<Row>(db().from("stories").select("*").eq("id", storyId).eq("company_id", companyId).single());
      const conn = await result<Row | null>(db().from("connections").select("*").eq("company_id", companyId).maybeSingle());
      if (story.status === "published" || story.status === "publishing") throw new ApiError(409, "Este story já foi enviado ou está em processamento.");
      if (!conn || !["connected", "partially_connected"].includes(conn.state) || !conn.enabled_features?.includes("publish")) throw new ApiError(403, "Conecte o Instagram desta empresa com permissão de publicação.");
      if (conn.source !== "real") throw new ApiError(403, "A publicação exige uma conexão real com a Meta.");
      return await edge<T>("publish-story", { company_id: companyId, story_id: storyId });
    }
    if (parts[4] === "retry" && method === "POST") {
      const story = await result<Row>(db().from("stories").select("*").eq("id", storyId).eq("company_id", companyId).single());
      if (story.status !== "failed") throw new ApiError(409, "Apenas stories com falha podem ser reenviados.");
      return await updateRow("stories", storyId, { status: "scheduled", attempts: 0 }, companyId) as T;
    }
    if (parts[4] === "duplicate" && method === "POST") {
      const old = await result<Row>(db().from("stories").select("*").eq("id", storyId).eq("company_id", companyId).single());
      const conn = await result<Row | null>(db().from("connections").select("state,source,enabled_features").eq("company_id", companyId).maybeSingle());
      const execution = conn && ["connected", "partially_connected"].includes(conn.state) && conn.enabled_features?.includes("publish") ? conn.source : "pending";
      const { id: _id, created_at: _created, platform_id: _platformId, published_at: _publishedAt, ...copy } = old;
      return await insertRow("stories", { ...copy, status: old.status === "draft" ? "draft" : "scheduled", attempts: 0, last_error: null, platform_id: "", published_at: null, execution }) as T;
    }
    if (method === "PATCH") {
      const current = await result<Row>(db().from("stories").select("*").eq("id", storyId).eq("company_id", companyId).single());
      if (["published", "canceled"].includes(current.status)) throw new ApiError(409, "Não é possível editar um story publicado ou cancelado.");
      const updates: Body = {};
      if (payload.caption !== undefined) updates.caption = String(payload.caption).trim();
      if (payload.schedule_at !== undefined) {
        const scheduleAt = String(payload.schedule_at);
        if (Number.isNaN(Date.parse(scheduleAt))) throw new ApiError(400, "Escolha uma data e horário válidos.");
        updates.schedule_at = new Date(scheduleAt).toISOString();
      }
      if (payload.status !== undefined) {
        if (payload.status !== "canceled") throw new ApiError(400, "Use as ações dedicadas para publicar ou tentar novamente.");
        updates.status = "canceled";
      }
      const updated = Object.keys(updates).length ? await updateRow<Row>("stories", storyId, updates, companyId) : current;
      return (await withSignedMedia([updated], "media_storage_path"))[0] as T;
    }
    if (method === "DELETE") { const deleted = await result<Row[]>(db().from("stories").delete().eq("id", storyId).eq("company_id", companyId).select("*")); return (deleted[0] ?? undefined) as T; }
  }

  // Inbox and messages.
  if (parts[2] === "conversations" && parts.length === 3 && method === "GET") {
    let q = db().from("conversations").select("*").eq("company_id", companyId).order("last_message_at", { ascending: false });
    const search = query.get("q")?.trim();
    if (search) q = q.or(`contact_name.ilike.%${search}%,contact_username.ilike.%${search}%`);
    return await result<Row[]>(q) as T;
  }
  if (parts[2] === "conversations" && parts[3]) {
    const conversationId = parts[3];
    if (parts.length === 4 && method === "GET") {
      const convo = await result<Row>(db().from("conversations").select("*").eq("id", conversationId).eq("company_id", companyId).single());
      if (Number(convo.unread || 0) > 0) {
        await result(db().from("conversations").update({ unread: 0 }).eq("id", conversationId).eq("company_id", companyId));
        convo.unread = 0;
      }
      convo.messages = await result<Row[]>(db().from("messages").select("*").eq("company_id", companyId).eq("conversation_id", conversationId).order("created_at"));
      return convo as T;
    }
    if (parts[4] === "followups") {
      if (parts.length === 5 && method === "GET") {
        return await result<Row[]>(db().from("conversation_followups").select("*").eq("company_id", companyId).eq("conversation_id", conversationId).order("due_at", { ascending: true })) as T;
      }
      if (parts.length === 5 && method === "POST") {
        const title = String(payload.title ?? "").trim();
        const dueAt = String(payload.due_at ?? "").trim();
        if (!title) throw new ApiError(400, "Informe o motivo do follow-up.");
        if (!dueAt || Number.isNaN(Date.parse(dueAt))) throw new ApiError(400, "Escolha uma data e horário válidos.");
        const { data: authData, error: authError } = await db().auth.getUser();
        if (authError || !authData.user) throw new ApiError(401, "Faça login novamente.");
        return await insertRow("conversation_followups", {
          company_id: companyId,
          conversation_id: conversationId,
          title,
          note: String(payload.note ?? "").trim(),
          due_at: new Date(dueAt).toISOString(),
          assigned_to: String(payload.assigned_to ?? "").trim(),
          created_by: authData.user.id,
        }) as T;
      }
      if (parts[5] && method === "PATCH") {
        const followupId = parts[5];
        const updates: Body = {};
        for (const key of ["title", "note", "due_at", "assigned_to", "status"] as const) {
          if (payload[key] !== undefined) updates[key] = payload[key];
        }
        if (updates.title !== undefined) updates.title = String(updates.title).trim();
        if (updates.due_at !== undefined) updates.due_at = new Date(String(updates.due_at)).toISOString();
        if (updates.status === "completed") updates.completed_at = now();
        else if (updates.status === "pending") updates.completed_at = null;
        updates.updated_at = now();
        let query = db().from("conversation_followups").update(updates)
          .eq("id", followupId).eq("company_id", companyId).eq("conversation_id", conversationId);
        return await result<Row>(query.select("*").single()) as T;
      }
      if (parts[5] && method === "DELETE") {
        return await updateRow("conversation_followups", parts[5], { status: "cancelled" }, companyId) as T;
      }
    }
    if (parts[4] === "messages" && method === "POST") {
      const text = String(payload.text ?? "").trim();
      if (!text) throw new ApiError(400, "A mensagem não pode ficar vazia.");
      const conversation = await result<Row | null>(db().from("conversations").select("id,status").eq("id", conversationId).eq("company_id", companyId).maybeSingle());
      if (!conversation) throw new ApiError(404, "Conversa não encontrada nesta empresa.");
      const conn = await result<Row | null>(db().from("connections").select("*").eq("company_id", companyId).maybeSingle());
      if (!conn || !["connected", "partially_connected"].includes(conn.state)) throw new ApiError(403, "Conecte o Instagram desta empresa para habilitar as funcionalidades.");
      if (conn.source !== "real") throw new ApiError(403, "O envio exige uma conexão real com a Meta.");
      return await edge<T>("send-message", { company_id: companyId, conversation_id: conversationId, text });
    }
    if (parts.length === 4 && method === "PATCH") {
      const current = await result<Row>(db().from("conversations").select("*").eq("id", conversationId).eq("company_id", companyId).single());
      const updates: Body = {};
      for (const k of ["status", "assignee"] as const) if (payload[k] !== undefined) updates[k] = payload[k];
      if (payload.add_tag) updates.tags = [...new Set([...(current.tags ?? []), payload.add_tag])];
      if (payload.remove_tag) updates.tags = (updates.tags ?? current.tags ?? []).filter((tag: string) => tag !== payload.remove_tag);
      if (payload.note) {
        const { data: authData } = await db().auth.getUser();
        const author = String(authData.user?.user_metadata?.name ?? authData.user?.email ?? "");
        updates.notes = [...(current.notes ?? []), { id: id(), text: String(payload.note).trim(), created_at: now(), author }];
      }
      return await updateRow("conversations", conversationId, updates, companyId) as T;
    }
  }
  // Comments and automations.
  if (parts[2] === "comments" && parts.length === 3 && method === "GET") {
    let q = db().from("comments").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
    if (query.get("status") && query.get("status") !== "all") q = q.eq("status", query.get("status"));
    const search = query.get("q")?.trim();
    if (search) q = q.or(`text.ilike.%${search}%,author.ilike.%${search}%,post_caption.ilike.%${search}%`);
    return await result<Row[]>(q) as T;
  }
  if (parts[2] === "comments" && parts[3]) {
    if (parts[4] === "reply" && method === "POST") {
      const conn = await result<Row | null>(db().from("connections").select("*").eq("company_id", companyId).maybeSingle());
      if (!conn || !["connected", "partially_connected"].includes(conn.state) || !conn.enabled_features?.includes("comments")) throw new ApiError(403, "Conecte o Instagram desta empresa com permissão para comentários.");
      if (conn.source !== "real") throw new ApiError(403, "A resposta exige uma conexão real com a Meta.");
      return await edge<T>("reply-comment", { company_id: companyId, comment_id: parts[3], ...payload });
    }
    if (method === "PATCH") return await updateRow("comments", parts[3], payload, companyId) as T;
  }
  if (parts[2] === "automations" && parts.length === 3 && method === "GET") return await result<Row[]>(db().from("automations").select("*").eq("company_id", companyId).order("created_at", { ascending: false })) as T;
  if (parts[2] === "automations" && parts.length === 3 && method === "POST") return await insertRow("automations", { company_id: companyId, ...payload }) as T;
  if (parts[2] === "automations" && parts[3]) {
    if (method === "PATCH") return await updateRow("automations", parts[3], payload, companyId) as T;
    if (method === "DELETE") { await result(db().from("automations").delete().eq("id", parts[3]).eq("company_id", companyId)); return undefined as T; }
  }
  if (parts[2] === "automation-runs" && method === "GET") return await result<Row[]>(db().from("automation_runs").select("*").eq("company_id", companyId).order("created_at", { ascending: false })) as T;
  if (parts[2] === "tasks" && parts.length === 3 && method === "GET") return await result<Row[]>(db().from("tasks").select("*").eq("company_id", companyId).order("created_at", { ascending: false })) as T;
  if (parts[2] === "tasks" && parts[3] && method === "PATCH") return await updateRow("tasks", parts[3], payload, companyId) as T;

  if (parts[2] === "reports" && method === "GET") {
    const [stories, comments, messages, runs, conversations, reportConnection] = await Promise.all([
      result<Row[]>(db().from("stories").select("status,execution,created_at,published_at").eq("company_id", companyId)),
      result<Row[]>(db().from("comments").select("id,source,created_at,replied_at").eq("company_id", companyId)),
      result<Row[]>(db().from("messages").select("conversation_id,direction,source,created_at").eq("company_id", companyId).order("created_at")),
      result<Row[]>(db().from("automation_runs").select("result,source,created_at").eq("company_id", companyId)),
      result<Row[]>(db().from("conversations").select("id,status").eq("company_id", companyId)),
      result<Row | null>(db().from("connections").select("source").eq("company_id", companyId).maybeSingle()),
    ]);
    const responseDurations = comments
      .filter((comment) => comment.created_at && comment.replied_at)
      .map((comment) => (Date.parse(comment.replied_at) - Date.parse(comment.created_at)) / 60_000)
      .filter((duration) => Number.isFinite(duration) && duration >= 0);
    const totals = {
      stories_published: stories.filter((x) => x.status === "published").length,
      stories_scheduled: stories.filter((x) => x.status === "scheduled").length,
      stories_failed: stories.filter((x) => x.status === "failed").length,
      comments_received: comments.length,
      messages_received: messages.filter((x) => x.direction === "in").length,
      avg_response_minutes: responseDurations.length ? Math.round(responseDurations.reduce((sum, value) => sum + value, 0) / responseDurations.length) : 0,
      atendimentos_concluidos: conversations.filter((x) => x.status === "resolved").length,
      automations_executed: runs.filter((x) => ["executed", "blocked", "ended"].includes(x.result)).length,
    };
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d.toISOString().slice(0, 10); });
    const series = days.map((date) => ({ date, stories_published: stories.filter((x) => x.status === "published" && x.published_at?.slice(0, 10) === date).length, comments: comments.filter((x) => x.created_at?.slice(0, 10) === date).length, messages: messages.filter((x) => x.direction === "in" && x.created_at?.slice(0, 10) === date).length }));
    const sources = { demo: 0, real: 0 };
    for (const source of [
      ...stories.map((item) => item.execution),
      ...comments.map((item) => item.source),
      ...messages.map((item) => item.source),
    ]) {
      if (source === "real") sources.real += 1;
      else sources.demo += 1;
    }
    return { company_id: companyId, generated_at: now(), demo_mode: reportConnection?.source !== "real", totals, series, sources } as T;
  }

  throw new ApiError(404, `Rota não mapeada para Supabase: ${method} ${path}`);
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>("POST", path, (body ?? {}) as Body);
export const apiPut = <T>(path: string, body?: unknown) => request<T>("PUT", path, (body ?? {}) as Body);
export const apiPatch = <T>(path: string, body?: unknown) => request<T>("PATCH", path, (body ?? {}) as Body);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);

export const apiPostForm = async <T>(path: string, form: FormData): Promise<T> => {
  const match = path.match(/^\/companies\/([^/]+)\/media\/upload$/);
  if (!match) throw new ApiError(404, `Rota não mapeada para Supabase: POST ${path}`);
  const companyId = decodeURIComponent(match[1]);
  const sourceFile = form.get("file");
  if (!(sourceFile instanceof File)) throw new ApiError(400, "Selecione um arquivo de mídia.");
  const file = await prepareStoryImage(sourceFile);
  if (file.size > 3_000_000) throw new ApiError(413, "Arquivo maior que 3 MB mesmo após o ajuste para Story.");
  const client = db();
  const objectPath = `${companyId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error: uploadError } = await client.storage.from("media").upload(objectPath, file, { contentType: file.type, upsert: false });
  if (uploadError) fail(uploadError);
  const { data: signed, error: signedError } = await client.storage.from("media").createSignedUrl(objectPath, 3600);
  if (signedError) fail(signedError);
  return await insertRow("media", { company_id: companyId, media_type: file.type.startsWith("video/") ? "video" : "image", url: `storage://media/${objectPath}`, storage_path: objectPath, name: sourceFile.name }).then((row: any) => ({ ...row, url: signed.signedUrl })) as T;
};
