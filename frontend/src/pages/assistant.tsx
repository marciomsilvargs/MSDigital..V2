import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Bot, Check, Plus, Save, Sparkles, Trash2, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { companyKey, useCompanies } from "@/lib/company-context";
import type { AiAssistant, AssistantMode, KnowledgeBase, KnowledgeEntry, KnowledgeEntryKind, KnowledgeVersion } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Workspace = { assistant: AiAssistant; base: KnowledgeBase; version: KnowledgeVersion; entries: KnowledgeEntry[] };
const kinds: Array<{ value: KnowledgeEntryKind; label: string }> = [
  { value: "institutional", label: "Institucional" }, { value: "hours", label: "Horários" },
  { value: "service", label: "Serviço" }, { value: "course", label: "Curso" },
  { value: "event", label: "Evento" }, { value: "price", label: "Preço" },
  { value: "promotion", label: "Promoção" }, { value: "faq", label: "Pergunta frequente" },
];

export default function Assistant() {
  const queryClient = useQueryClient();
  const { activeCompany } = useCompanies();
  const companyId = activeCompany?.id;
  const [form, setForm] = useState<Partial<AiAssistant>>({});
  const [newEntry, setNewEntry] = useState({ kind: "faq" as KnowledgeEntryKind, title: "", content: "" });

  const { data: workspace, isLoading } = useQuery({
    queryKey: companyKey(companyId, "assistant"),
    queryFn: () => apiGet<Workspace>(`/companies/${companyId}/assistant`),
    enabled: !!companyId,
  });
  useEffect(() => { if (workspace?.assistant) setForm(workspace.assistant); }, [workspace?.assistant]);

  function errorToast(error: unknown) {
    const message = error instanceof ApiError ? error.message : "Operação não concluída.";
    toast.error(message);
  }
  function invalidate() { queryClient.invalidateQueries({ queryKey: companyKey(companyId, "assistant") }); }

  const saveMutation = useMutation({
    mutationFn: () => apiPatch<AiAssistant>(`/companies/${companyId}/assistant`, form),
    onSuccess: () => { invalidate(); toast.success("Configurações do assistente salvas."); }, onError: errorToast,
  });
  const addMutation = useMutation({
    mutationFn: () => apiPost<KnowledgeEntry>(`/companies/${companyId}/assistant/entries`, newEntry),
    onSuccess: () => { invalidate(); setNewEntry({ kind: "faq", title: "", content: "" }); toast.success("Conhecimento adicionado à versão de rascunho."); }, onError: errorToast,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/companies/${companyId}/assistant/entries/${id}`),
    onSuccess: () => { invalidate(); toast.success("Conhecimento removido."); }, onError: errorToast,
  });
  const publishMutation = useMutation({
    mutationFn: () => apiPost<Workspace>(`/companies/${companyId}/assistant/publish`),
    onSuccess: () => { invalidate(); toast.success("Nova versão publicada e ativada para a empresa."); }, onError: errorToast,
  });

  if (!activeCompany) return <div className="rounded-xl border border-[#282E40] bg-[#181C26] p-8 text-center text-[#94A3B8]">Selecione uma empresa primeiro.</div>;
  if (isLoading || !workspace) return <div className="rounded-xl border border-[#282E40] bg-[#181C26] p-8 text-center text-[#94A3B8]">Carregando Assistente IA…</div>;
  const update = (values: Partial<AiAssistant>) => setForm((current) => ({ ...current, ...values }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Inteligência por empresa</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-[#F8FAFC] md:text-3xl"><Sparkles className="h-6 w-6 text-[#C5A46D]" /> Assistente IA — {activeCompany.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#94A3B8]">Configure a personalidade e publique uma base de conhecimento independente para esta empresa.</p>
        </div>
        <Badge className={cn("rounded-full border", workspace.assistant.enabled ? "border-[#4ADE80]/40 bg-[#142A20] text-[#86EFAC]" : "border-[#F59E0B]/40 bg-[#2A2317] text-[#FCD34D]")}>{workspace.assistant.enabled ? "Assistente ativo" : "Assistente pausado"}</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="space-y-5 border-[#282E40] bg-[#181C26] p-5 lg:col-span-5">
          <div className="flex items-center gap-3"><Bot className="h-5 w-5 text-[#C5A46D]" /><div><h2 className="font-semibold text-[#F8FAFC]">Configuração do assistente</h2><p className="text-xs text-[#94A3B8]">Estas regras valem somente para {activeCompany.name}.</p></div></div>
          <div className="space-y-2"><Label className="text-[#94A3B8]">Nome</Label><Input value={form.name ?? ""} onChange={(e) => update({ name: e.target.value })} className="border-[#282E40] bg-[#10131B] text-[#F8FAFC]" /></div>
          <div className="space-y-2"><Label className="text-[#94A3B8]">Personalidade</Label><Textarea value={form.personality ?? ""} onChange={(e) => update({ personality: e.target.value })} placeholder="Ex.: acolhedor, objetivo e profissional" className="min-h-24 border-[#282E40] bg-[#10131B] text-[#F8FAFC]" /></div>
          <div className="space-y-2"><Label className="text-[#94A3B8]">Modo de atendimento</Label><select value={form.mode ?? "supervised"} onChange={(e) => update({ mode: e.target.value as AssistantMode })} className="h-10 w-full rounded-md border border-[#282E40] bg-[#10131B] px-3 text-sm text-[#F8FAFC]"><option value="automatic">Automático</option><option value="supervised">Supervisionado</option><option value="assisted">Assistido</option></select></div>
          <label className="flex items-center gap-3 text-sm text-[#F8FAFC]"><input type="checkbox" checked={Boolean(form.enabled)} onChange={(e) => update({ enabled: e.target.checked })} className="h-4 w-4 accent-[#C5A46D]" /> Permitir uso do assistente nas automações</label>
          <label className="flex items-center gap-3 text-sm text-[#F8FAFC]"><input type="checkbox" checked={form.human_handoff_enabled !== false} onChange={(e) => update({ human_handoff_enabled: e.target.checked })} className="h-4 w-4 accent-[#C5A46D]" /> Permitir transferência para atendimento humano</label>
          <div className="space-y-2"><Label className="text-[#94A3B8]">Mensagem de transferência</Label><Textarea value={form.handoff_message ?? ""} onChange={(e) => update({ handoff_message: e.target.value })} className="border-[#282E40] bg-[#10131B] text-[#F8FAFC]" /></div>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"><Save className="h-4 w-4" /> Salvar configuração</Button>
        </Card>

        <Card className="space-y-5 border-[#282E40] bg-[#181C26] p-5 lg:col-span-7">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div className="flex items-center gap-3"><BookOpen className="h-5 w-5 text-[#C5A46D]" /><div><h2 className="font-semibold text-[#F8FAFC]">Base de conhecimento</h2><p className="text-xs text-[#94A3B8]">Rascunho v{workspace.version.version_number} · {workspace.entries.length} itens cadastrados</p></div></div><Button onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending || workspace.entries.length === 0} className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"><Check className="h-4 w-4" /> Publicar versão</Button></div>
          <div className="grid gap-3 rounded-lg border border-dashed border-[#3A4052] bg-[#10131B] p-4 sm:grid-cols-[180px_1fr]"><select value={newEntry.kind} onChange={(e) => setNewEntry((v) => ({ ...v, kind: e.target.value as KnowledgeEntryKind }))} className="h-10 rounded-md border border-[#282E40] bg-[#181C26] px-3 text-sm text-[#F8FAFC]">{kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select><Input value={newEntry.title} onChange={(e) => setNewEntry((v) => ({ ...v, title: e.target.value }))} placeholder="Título (ex.: Horário da linha de tiro)" className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]" /><Textarea value={newEntry.content} onChange={(e) => setNewEntry((v) => ({ ...v, content: e.target.value }))} placeholder="Informação que o assistente poderá consultar…" className="min-h-20 border-[#282E40] bg-[#181C26] text-[#F8FAFC] sm:col-span-2" /><Button onClick={() => addMutation.mutate()} disabled={!newEntry.title.trim() || !newEntry.content.trim() || addMutation.isPending} className="bg-[#202534] text-[#F8FAFC] hover:bg-[#2A3144] sm:col-span-2"><Plus className="h-4 w-4" /> Adicionar conhecimento</Button></div>
          <div className="space-y-3">{workspace.entries.map((entry) => <div key={entry.id} className="flex items-start gap-3 rounded-lg border border-[#282E40] bg-[#10131B] p-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge className="border border-[#C5A46D]/30 bg-[#2A2317] text-[#E9D2A8]">{kinds.find((kind) => kind.value === entry.kind)?.label ?? entry.kind}</Badge><p className="font-semibold text-[#F8FAFC]">{entry.title}</p></div><p className="mt-1 whitespace-pre-wrap text-sm text-[#94A3B8]">{entry.content}</p></div><Button size="icon" variant="ghost" onClick={() => { if (window.confirm("Remover este conhecimento do rascunho?")) deleteMutation.mutate(entry.id); }} className="text-[#F87171]" aria-label="Remover conhecimento"><Trash2 className="h-4 w-4" /></Button></div>)}{workspace.entries.length === 0 && <div className="rounded-lg border border-dashed border-[#282E40] p-8 text-center text-sm text-[#94A3B8]"><Upload className="mx-auto mb-2 h-6 w-6 text-[#C5A46D]" />Adicione horários, preços, serviços, cursos, eventos e perguntas frequentes.</div>}</div>
        </Card>
      </div>

      <Card className="border-[#282E40] bg-[#181C26] p-5"><div className="flex items-center gap-3"><UserRound className="h-5 w-5 text-[#C5A46D]" /><div><h2 className="font-semibold text-[#F8FAFC]">Próxima etapa</h2><p className="text-sm text-[#94A3B8]">A base publicada já fica versionada por empresa. A consulta pelo modelo e a integração nos blocos de automação serão conectadas na próxima fase.</p></div></div></Card>
    </div>
  );
}

