import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, Check, Clock3, MessageCircle, Search, Send, StickyNote, Tag, UserCog, X } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { companyKey, useCompanies } from "@/lib/company-context";
import type { ConnectionStatus, Conversation, ConversationDetail, ConversationFollowUp, Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LockBanner } from "@/components/connection-bits";

const QUICK_REPLIES = ["Obrigado pelo contato! 😊", "Enviaremos os detalhes hoje mesmo.", "Podemos agendar uma chamada?"];

const STATUS_LABELS: Record<Conversation["status"], string> = {
  open: "Aberto",
  pending: "Pendente",
  resolved: "Resolvido",
};

export default function Inbox() {
  const queryClient = useQueryClient();
  const { activeCompany } = useCompanies();
  const companyId = activeCompany?.id;

  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState("");
  const [replyText, setReplyText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [newTag, setNewTag] = useState("");
  const [followupOpen, setFollowupOpen] = useState(false);
  const [followupTitle, setFollowupTitle] = useState("Retomar conversa");
  const [followupNote, setFollowupNote] = useState("");
  const [followupDue, setFollowupDue] = useState("");

  const { data: conversations = [] } = useQuery({
    queryKey: companyKey(companyId, "conversations", search),
    queryFn: () => apiGet<Conversation[]>(`/companies/${companyId}/conversations?q=${encodeURIComponent(search)}`),
    enabled: !!companyId,
  });
  const { data: detail } = useQuery({
    queryKey: companyKey(companyId, "conversation", activeId),
    queryFn: () => apiGet<ConversationDetail>(`/companies/${companyId}/conversations/${activeId}`),
    enabled: !!companyId && !!activeId,
  });
  const { data: connStatus } = useQuery({
    queryKey: companyKey(companyId, "connection"),
    queryFn: () => apiGet<ConnectionStatus>(`/companies/${companyId}/connection`),
    enabled: !!companyId,
  });
  const { data: followups = [] } = useQuery({
    queryKey: companyKey(companyId, "followups", activeId),
    queryFn: () => apiGet<ConversationFollowUp[]>(`/companies/${companyId}/conversations/${activeId}/followups`),
    enabled: !!companyId && !!activeId,
  });

  const connected = connStatus?.connection?.state === "connected" || connStatus?.connection?.state === "partially_connected";

  useEffect(() => {
    if (!activeId && conversations.length > 0) setActiveId(conversations[0].id);
  }, [conversations, activeId]);

  useEffect(() => {
    if (!detail || !companyId) return;
    queryClient.setQueriesData<Conversation[]>(
      { queryKey: companyKey(companyId, "conversations") },
      (current) => current?.map((conversation) => conversation.id === detail.id ? { ...conversation, unread: 0 } : conversation),
    );
  }, [detail?.id, companyId, queryClient]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "conversations") });
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "conversation", activeId) });
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "reports") });
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "runs") });
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "followups", activeId) });
  }

  function errorToast(error: unknown) {
    const detail = error instanceof ApiError ? (error.body as { detail?: string } | null)?.detail : undefined;
    if (typeof detail === "string") toast.error(detail);
    else toast.error("Operação não concluída.");
  }

  const sendMutation = useMutation({
    mutationFn: () => apiPost<Message>(`/companies/${companyId}/conversations/${activeId}/messages`, { text: replyText }),
    onSuccess: () => {
      setReplyText("");
      invalidate();
      toast.success("Resposta enviada.");
    },
    onError: errorToast,
  });

  const patchMutation = useMutation({
    mutationFn: (updates: Record<string, string>) => apiPatch<Conversation>(`/companies/${companyId}/conversations/${activeId}`, updates),
    onSuccess: () => {
      invalidate();
      toast.success("Atendimento atualizado.");
    },
    onError: errorToast,
  });

  const createFollowupMutation = useMutation({
    mutationFn: () => apiPost<ConversationFollowUp>(`/companies/${companyId}/conversations/${activeId}/followups`, {
      title: followupTitle,
      note: followupNote,
      due_at: followupDue,
      assigned_to: detail?.assignee ?? "",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companyKey(companyId, "followups", activeId) });
      setFollowupOpen(false);
      setFollowupTitle("Retomar conversa");
      setFollowupNote("");
      setFollowupDue("");
      toast.success("Follow-up agendado para esta conversa.");
    },
    onError: errorToast,
  });

  const updateFollowupMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "completed" | "pending" }) =>
      apiPatch<ConversationFollowUp>(`/companies/${companyId}/conversations/${activeId}/followups/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: companyKey(companyId, "followups", activeId) }),
    onError: errorToast,
  });

  const cancelFollowupMutation = useMutation({
    mutationFn: (followupId: string) => apiDelete<ConversationFollowUp>(`/companies/${companyId}/conversations/${activeId}/followups/${followupId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: companyKey(companyId, "followups", activeId) }),
    onError: errorToast,
  });

  if (!activeCompany) {
    return <div className="rounded-xl border border-[#282E40] bg-[#181C26] p-8 text-center text-[#94A3B8]">Selecione uma empresa primeiro.</div>;
  }

  const employees = activeCompany.employees.map((e) => e.name);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Atendimento</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#F8FAFC] md:text-3xl">Central de Direct</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Conversas organizadas por empresa — respeitando a janela de 24h da Meta para respostas.
          </p>
        </div>
      </div>

      {!connected && <LockBanner onConnect={() => (window.location.href = "/connection?connect=1")} testid="inbox-lock-banner" />}

      <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-[#282E40] bg-[#181C26] md:grid-cols-12">
        {/* Conversations */}
        <div className="border-b border-[#282E40] md:col-span-4 md:border-b-0 md:border-r" data-testid="inbox-conversation-list">
          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar conversa…"
                data-testid="inbox-search-input"
                className="border-[#282E40] bg-[#10131B] pl-9 text-[#F8FAFC]"
              />
            </div>
          </div>
          <div className="max-h-[420px] space-y-1 overflow-y-auto px-2 pb-4 md:max-h-[520px]">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                data-testid={`inbox-conversation-${conv.id}`}
                onClick={() => setActiveId(conv.id)}
                className={cn(
                  "w-full rounded-lg p-3 text-left transition-colors",
                  activeId === conv.id ? "bg-[#2A2317]" : "hover:bg-[#10131B]"
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-[#10131B]" style={{ backgroundColor: conv.avatar_color }}>
                    {conv.contact_name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-[#F8FAFC]">{conv.contact_name}</p>
                      {conv.unread > 0 && (
                        <Badge data-testid={`inbox-unread-${conv.id}`} className="h-4 rounded-full bg-[#C5A46D] px-1.5 text-[10px] font-bold text-[#10131B]">
                          {conv.unread}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-[#94A3B8]">
                      {conv.contact_username} · {format(parseISO(conv.last_message_at), "dd/MM HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {conv.unread > 0 && (
                    <Badge className="rounded-full border-[#FBBF24]/40 bg-[#2A1D17] text-[#FBBF24]" data-testid={`inbox-unanswered-${conv.id}`}>
                      Não respondida
                    </Badge>
                  )}
                  {conv.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="rounded-full bg-[#222838] text-[#94A3B8]">{tag}</Badge>
                  ))}
                  {conv.assignee && (
                    <Badge variant="secondary" className="rounded-full bg-[#222838] text-[#E9D2A8]">{conv.assignee}</Badge>
                  )}
                </div>
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-[#94A3B8]">Nenhuma conversa encontrada.</p>
            )}
          </div>
        </div>

        {/* Chat */}
        <div className="flex min-h-[420px] flex-col md:col-span-5 md:border-r" data-testid="inbox-chat-panel">
          {detail ? (
            <>
              <div className="flex items-center gap-3 border-b border-[#282E40] p-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-[#10131B]" style={{ backgroundColor: detail.avatar_color }}>
                  {detail.contact_name.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <p className="text-sm font-semibold text-[#F8FAFC]" data-testid="inbox-chat-contact">{detail.contact_name}</p>
                  <p className="text-xs text-[#94A3B8]">{detail.contact_username}</p>
                </div>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4" data-testid="inbox-messages">
                {detail.messages.map((message) => (
                  <div key={message.id} className={cn("flex", message.direction === "in" ? "justify-start" : "justify-end")}>
                    <div
                      data-testid={`inbox-message-${message.id}`}
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                        message.direction === "in" ? "bg-[#202534] text-[#F8FAFC]" : "bg-[#C5A46D] text-[#10131B]"
                      )}
                    >
                      {message.text}
                      <span className="mt-1 block text-[10px] opacity-70">
                        {format(parseISO(message.created_at), "HH:mm", { locale: ptBR })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {connected && (
                <div className="space-y-2 border-t border-[#282E40] p-4">
                  <div className="flex flex-wrap gap-1.5" data-testid="inbox-quick-replies">
                    {QUICK_REPLIES.map((reply) => (
                      <button
                        key={reply}
                        type="button"
                        data-testid="inbox-quick-reply"
                        onClick={() => setReplyText(reply)}
                        className="rounded-full border border-[#282E40] bg-[#10131B] px-2.5 py-1 text-xs text-[#94A3B8] transition-colors hover:border-[#C5A46D]/40 hover:text-[#C5A46D]"
                      >
                        {reply}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Responder mensagem…"
                      data-testid="inbox-reply-input"
                      className="border-[#282E40] bg-[#10131B] text-[#F8FAFC]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && replyText.trim()) sendMutation.mutate();
                      }}
                    />
                    <Button
                      data-testid="inbox-send-button"
                      disabled={!replyText.trim() || sendMutation.isPending}
                      onClick={() => sendMutation.mutate()}
                      aria-label="Enviar resposta"
                      className="bg-[#C5A46D] text-[#10131B] hover:bg-[#D8B77E]"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-[10px] text-[#94A3B8]">Respostas dentro da janela de atendimento de 24h da Meta.</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-[#94A3B8]">
              <MessageCircle className="h-8 w-8" />
              <p className="text-sm">Selecione uma conversa.</p>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="space-y-5 p-4 md:col-span-3" data-testid="inbox-details-panel">
          {detail && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-widest text-[#C5A46D]">Status do atendimento</Label>
                <Select
                  value={detail.status}
                  onValueChange={(value: string) => patchMutation.mutate({ status: value })}
                >
                  <SelectTrigger data-testid="inbox-status-select" className="w-full border-[#282E40] bg-[#10131B] text-sm text-[#F8FAFC]">
                    <SelectValue>{(v: string) => STATUS_LABELS[v as Conversation["status"]]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="border-[#282E40] bg-[#1E2330]">
                    {(["open", "pending", "resolved"] as const).map((s) => (
                      <SelectItem key={s} value={s} data-testid={`inbox-status-${s}`}>{STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2" data-testid="inbox-followups-panel">
                <div className="flex items-center justify-between gap-2">
                  <Label className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-[#C5A46D]">
                    <CalendarClock className="h-3.5 w-3.5" /> Follow-ups
                  </Label>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="inbox-followup-add"
                    onClick={() => setFollowupOpen(true)}
                    className="h-7 border-[#282E40] px-2 text-xs text-[#F8FAFC] hover:bg-[#202534]"
                  >
                    Agendar
                  </Button>
                </div>
                <div className="space-y-2">
                  {followups.map((item) => {
                    const overdue = item.status === "pending" && new Date(item.due_at).getTime() < Date.now();
                    return (
                      <div key={item.id} data-testid={`inbox-followup-${item.id}`} className="rounded-lg border border-[#282E40] bg-[#10131B] p-2.5">
                        <div className="flex items-start gap-2">
                          <Clock3 className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", overdue ? "text-[#F87171]" : "text-[#C5A46D]")} />
                          <div className="min-w-0 flex-1">
                            <p className={cn("text-xs font-medium", item.status === "completed" && "line-through opacity-60", "text-[#F8FAFC]")}>{item.title}</p>
                            <p className={cn("mt-0.5 text-[10px]", overdue ? "text-[#F87171]" : "text-[#94A3B8]")}>
                              {format(parseISO(item.due_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}{overdue ? " · Atrasado" : ""}
                            </p>
                            {item.assigned_to && <p className="mt-0.5 text-[10px] text-[#94A3B8]">Responsável: {item.assigned_to}</p>}
                            {item.note && <p className="mt-1 whitespace-pre-wrap text-xs text-[#94A3B8]">{item.note}</p>}
                          </div>
                          {item.status === "pending" ? (
                            <div className="flex shrink-0 gap-1">
                              <button type="button" aria-label="Concluir follow-up" data-testid={`inbox-followup-complete-${item.id}`} onClick={() => updateFollowupMutation.mutate({ id: item.id, status: "completed" })} className="rounded p-1 text-[#94A3B8] hover:bg-[#202534] hover:text-[#4ADE80]">
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button type="button" aria-label="Cancelar follow-up" data-testid={`inbox-followup-cancel-${item.id}`} onClick={() => cancelFollowupMutation.mutate(item.id)} className="rounded p-1 text-[#94A3B8] hover:bg-[#202534] hover:text-[#F87171]">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">{item.status === "completed" ? "Concluído" : "Cancelado"}</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {followups.length === 0 && <p className="rounded-lg border border-dashed border-[#282E40] p-3 text-center text-xs text-[#94A3B8]">Nenhum retorno agendado.</p>}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-[#C5A46D]">
                  <UserCog className="h-3.5 w-3.5" /> Funcionário responsável
                </Label>
                <Select
                  value={detail.assignee}
                  onValueChange={(value: string) => patchMutation.mutate({ assignee: value })}
                >
                  <SelectTrigger data-testid="inbox-assignee-select" className="w-full border-[#282E40] bg-[#10131B] text-sm text-[#F8FAFC]">
                    <SelectValue>{(v: string) => v || "Não atribuído"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="border-[#282E40] bg-[#1E2330]">
                    <SelectItem value="—" onClick={() => patchMutation.mutate({ assignee: "" })}>Não atribuído</SelectItem>
                    {employees.map((name) => (
                      <SelectItem key={name} value={name} data-testid={`inbox-assignee-${name}`}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-[#C5A46D]">
                  <Tag className="h-3.5 w-3.5" /> Etiquetas
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {detail.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1 rounded-full bg-[#222838] text-[#F8FAFC]">
                      {tag}
                      <button
                        type="button"
                        aria-label={`Remover etiqueta ${tag}`}
                        data-testid={`inbox-tag-remove-${tag}`}
                        onClick={() => patchMutation.mutate({ remove_tag: tag })}
                        className="text-[#94A3B8] hover:text-[#F87171]"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    placeholder="Nova etiqueta"
                    data-testid="inbox-tag-input"
                    className="border-[#282E40] bg-[#10131B] text-[#F8FAFC]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="inbox-tag-add"
                    disabled={!newTag.trim()}
                    onClick={() => {
                      patchMutation.mutate({ add_tag: newTag.trim() });
                      setNewTag("");
                    }}
                    className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]"
                  >
                    +
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-[#C5A46D]">
                  <StickyNote className="h-3.5 w-3.5" /> Notas internas
                </Label>
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Anotação visível apenas para a equipe…"
                  data-testid="inbox-note-input"
                  className="border-[#282E40] bg-[#10131B] text-[#F8FAFC]"
                />
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="inbox-note-save"
                  disabled={!noteText.trim()}
                  onClick={() => {
                    patchMutation.mutate({ note: noteText.trim() });
                    setNoteText("");
                  }}
                  className="w-full border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]"
                >
                  Salvar anotação
                </Button>
                <div className="space-y-1.5">
                  {detail.notes.map((note) => (
                    <div key={note.id} className="rounded-lg bg-[#10131B] p-2.5" data-testid="inbox-note-item">
                      <p className="text-xs text-[#F8FAFC]">{note.text}</p>
                      <p className="mt-0.5 text-[10px] text-[#94A3B8]">
                        {note.author} · {format(parseISO(note.created_at), "dd/MM HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={followupOpen} onOpenChange={setFollowupOpen}>
        <DialogContent role="dialog" className="border-[#2E364D] bg-[#1E2330]" data-testid="inbox-followup-dialog">
          <DialogHeader>
            <DialogTitle className="text-[#F8FAFC]">Agendar follow-up</DialogTitle>
            <DialogDescription className="text-[#94A3B8]">
              Crie um lembrete vinculado a {detail?.contact_name ?? "esta conversa"} para a equipe retomar o atendimento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="followup-title" className="text-[#94A3B8]">Motivo do retorno</Label>
              <Input id="followup-title" value={followupTitle} onChange={(event) => setFollowupTitle(event.target.value)} maxLength={120} data-testid="inbox-followup-title" className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="followup-due" className="text-[#94A3B8]">Data e horário</Label>
              <Input id="followup-due" type="datetime-local" value={followupDue} onChange={(event) => setFollowupDue(event.target.value)} required data-testid="inbox-followup-due" className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="followup-note" className="text-[#94A3B8]">Observação</Label>
              <Textarea id="followup-note" value={followupNote} onChange={(event) => setFollowupNote(event.target.value)} placeholder="Contexto para a equipe…" maxLength={1000} data-testid="inbox-followup-note" className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]" />
            </div>
            <p className="text-xs text-[#94A3B8]">Responsável atual: {detail?.assignee || "Não atribuído"}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFollowupOpen(false)}>Cancelar</Button>
            <Button data-testid="inbox-followup-submit" disabled={!followupTitle.trim() || !followupDue || createFollowupMutation.isPending} onClick={() => createFollowupMutation.mutate()} className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]">
              {createFollowupMutation.isPending ? "Agendando…" : "Agendar retorno"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
