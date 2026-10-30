import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type LeadContext = {
  conversationId?: string;
  commentId?: string;
  socialUserId?: string;
  publicName?: string;
};

export const normalizeIntentText = (value: unknown) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("pt-BR")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export const isAssociationIntent = (value: unknown) => {
  const text = normalizeIntentText(value);
  return /\b(quero|associ|soci[oa]|plano|mensalidade|valor|beneficio|custa|fazer parte|conhecer)\b/.test(text);
};

function sourceFor(context: LeadContext) {
  return context.commentId ? "instagram_comment" : "instagram_direct";
}

export async function upsertAssociationLead(admin: SupabaseClient, companyId: string, context: LeadContext, text: string) {
  const socialUserId = String(context.socialUserId || "").trim();
  if (!socialUserId || !isAssociationIntent(text)) return null;
  const now = new Date().toISOString();
  const { data: existing, error: readError } = await admin.from("crm_leads")
    .select("id,stage")
    .eq("company_id", companyId).eq("social_network", "instagram").eq("social_user_id", socialUserId)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) {
    await admin.from("crm_leads").update({ last_interaction_at: now, updated_at: now, last_conversation_id: context.conversationId || null })
      .eq("id", existing.id).eq("company_id", companyId);
    return existing;
  }
  const { data, error } = await admin.from("crm_leads").insert({
    company_id: companyId, social_network: "instagram", social_user_id: socialUserId,
    public_name: String(context.publicName || ""), source: sourceFor(context), interest_type: "association",
    stage: "new", first_interaction_at: now, last_interaction_at: now,
    last_conversation_id: context.conversationId || null,
  }).select("id,stage").single();
  if (error && error.code !== "23505") throw error;
  if (error?.code === "23505") {
    const { data: raced } = await admin.from("crm_leads").select("id,stage").eq("company_id", companyId).eq("social_network", "instagram").eq("social_user_id", socialUserId).maybeSingle();
    return raced;
  }
  return data;
}

export async function updateLeadStage(admin: SupabaseClient, companyId: string, context: LeadContext, text: string, stage: "new" | "interested" | "qualified" | "sales" | "converted" | "closed") {
  const socialUserId = String(context.socialUserId || "").trim();
  if (!socialUserId) return;
  await admin.from("crm_leads").update({ stage, last_interaction_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_conversation_id: context.conversationId || null })
    .eq("company_id", companyId).eq("social_network", "instagram").eq("social_user_id", socialUserId);
}
