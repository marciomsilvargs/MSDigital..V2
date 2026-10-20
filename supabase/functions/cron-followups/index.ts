import { clients, json } from "../_shared/http.ts";

function authorized(req: Request) {
  const expected = Deno.env.get("CRON_SECRET") || "";
  const actual = req.headers.get("x-cron-secret") || "";
  if (!expected || actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST" || !authorized(req)) return json({ detail: "Não autorizado." }, 401);
  try {
    const { admin } = clients();
    const { data: due, error } = await admin.from("conversation_followups").select("*")
      .eq("status", "pending").is("reminder_sent_at", null).lte("due_at", new Date().toISOString()).order("due_at").limit(200);
    if (error) throw error;
    let created = 0;
    for (const followup of due || []) {
      const { data: conversation } = await admin.from("conversations").select("contact_name")
        .eq("id", followup.conversation_id).eq("company_id", followup.company_id).maybeSingle();
      const title = `Follow-up vencido: ${followup.title} — ${conversation?.contact_name || "conversa"}`;
      const { error: taskError } = await admin.from("tasks").upsert({
        company_id: followup.company_id, followup_id: followup.id, assigned_to: followup.assigned_to || "",
        title, source: "system", done: false,
      }, { onConflict: "followup_id", ignoreDuplicates: true });
      if (taskError) { console.error("Could not create follow-up task", taskError); continue; }
      const { error: updateError } = await admin.from("conversation_followups").update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", followup.id).eq("company_id", followup.company_id).is("reminder_sent_at", null);
      if (updateError) { console.error("Could not mark follow-up reminder", updateError); continue; }
      created++;
    }
    return json({ ok: true, reminders_created: created });
  } catch (error) { console.error("Follow-up scheduler failed", error); return json({ detail: "Falha processando os follow-ups vencidos." }, 500); }
});
