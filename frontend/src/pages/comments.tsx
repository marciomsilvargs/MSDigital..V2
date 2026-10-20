import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCheck, MessageSquare, Reply, Search } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { companyKey, useCompanies } from "@/lib/company-context";
import type { CommentItem, ConnectionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LockBanner, SourceBadge } from "@/components/connection-bits";

const FILTERS = [
  { value: "", label: "Todos" },
  { value: "new", label: "Novos" },
  { value: "replied", label: "Respondidos" },
  { value: "resolved", label: "Resolvidos" },
] as const;

const STATUS_META: Record<CommentItem["status"], { label: string; className: string }> = {
  new: { label: "Novo", className: "bg-blue-950/60 text-blue-300 border-blue-800" },
  replied: { label: "Respondido", className: "bg-emerald-950/60 text-emerald-300 border-emerald-800" },
  resolved: { label: "Resolvido", className: "bg-slate-800 text-slate-300 border-slate-700" },
};

export default function Comments() {
  const queryClient = useQueryClient();
  const { activeCompany } = useCompanies();
  const companyId = activeCompany?.id;

  const [filter, setFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [replyingId, setReplyingId] = useState("");
  const [replyText, setReplyText] = useState("");

  const { data: comments = [] } = useQuery({
    queryKey: companyKey(companyId, "comments", filter, search),
    queryFn: () =>
      apiGet<CommentItem[]>(`/companies/${companyId}/comments?status=${filter}&q=${encodeURIComponent(search)}`),
    enabled: !!companyId,
  });
  const { data: connStatus } = useQuery({
    queryKey: companyKey(companyId, "connection"),
    queryFn: () => apiGet<ConnectionStatus>(`/companies/${companyId}/connection`),
    enabled: !!companyId,
  });

  const connected = connStatus?.connection?.state === "connected" || connStatus?.connection?.state === "partially_connected";

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "comments") });
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "reports") });
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "runs") });
  }

  function errorToast(error: unknown) {
    const detail = error instanceof ApiError ? (error.body as { detail?: string } | null)?.detail : undefined;
    if (typeof detail === "string") toast.error(detail);
    else toast.error("Operação não concluída.");
  }

  const replyMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      apiPost<CommentItem>(`/companies/${companyId}/comments/${id}/reply`, { text }),
    onSuccess: () => {
      invalidate();
      setReplyingId("");
      setReplyText("");
      toast.success("Comentário respondido.");
    },
    onError: errorToast,
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiPatch<CommentItem>(`/companies/${companyId}/comments/${id}`, { status }),
    onSuccess: () => {
      invalidate();
      toast.success("Status atualizado.");
    },
    onError: errorToast,
  });

  if (!activeCompany) {
    return <div className="rounded-xl border border-[#282E40] bg-[#181C26] p-8 text-center text-[#94A3B8]">Selecione uma empresa primeiro.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Moderação</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#F8FAFC] md:text-3xl">Central de Comentários</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Respostas manuais, automáticas e por palavra-chave — cada empresa com seus comentários isolados.
          </p>
        </div>
      </div>

      {!connected && <LockBanner onConnect={() => (window.location.href = "/connection?connect=1")} testid="comments-lock-banner" />}

      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div className="flex flex-wrap gap-2" data-testid="comments-filter-pills">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              data-testid={`comments-filter-${f.value || "all"}`}
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f.value
                  ? "border-[#C5A46D] bg-[#2A2317] text-[#E9D2A8]"
                  : "border-[#282E40] bg-[#181C26] text-[#94A3B8] hover:border-[#C5A46D]/40"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative md:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por texto, autor, palavra-chave…"
            data-testid="comments-search-input"
            className="border-[#282E40] bg-[#181C26] pl-9 text-[#F8FAFC]"
          />
        </div>
      </div>

      <div className="space-y-3" data-testid="comments-list">
        {comments.map((comment) => (
          <div key={comment.id} data-testid={`comment-card-${comment.id}`} className="rounded-xl border border-[#282E40] bg-[#181C26] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#202534] text-xs font-bold text-[#C5A46D]">
                  {comment.author.replace("@", "").slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <p className="text-sm font-semibold text-[#F8FAFC]" data-testid={`comment-author-${comment.id}`}>{comment.author}</p>
                  <p className="text-xs text-[#94A3B8]">
                    Em “{comment.post_caption || comment.post_id}” ·{" "}
                    {format(parseISO(comment.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Badge data-testid={`comment-status-${comment.id}`} className={cn("rounded-full border", STATUS_META[comment.status].className)}>
                  {STATUS_META[comment.status].label}
                </Badge>
                <SourceBadge source={comment.source} testid={`comment-source-${comment.id}`} />
              </div>
            </div>

            <p className="mt-3 rounded-lg bg-[#10131B] p-3 text-sm text-[#F8FAFC]" data-testid={`comment-text-${comment.id}`}>
              {comment.text}
            </p>

            {comment.reply_text && (
              <div className="mt-2 rounded-lg border border-[#4ADE80]/25 bg-[#14201B] p-3" data-testid={`comment-reply-${comment.id}`}>
                <p className="text-xs font-semibold text-[#4ADE80]">Resposta da agência ({comment.reply_source === "real" ? "Meta" : "não sincronizada"})</p>
                <p className="mt-1 text-sm text-[#F8FAFC]">{comment.reply_text}</p>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                data-testid={`comment-reply-button-${comment.id}`}
                onClick={() => {
                  setReplyingId(replyingId === comment.id ? "" : comment.id);
                  setReplyText("");
                }}
                disabled={!connected}
                className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]"
              >
                <Reply className="h-3.5 w-3.5" /> Responder
              </Button>
              {comment.status !== "resolved" && (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid={`comment-resolve-${comment.id}`}
                  onClick={() => patchMutation.mutate({ id: comment.id, status: "resolved" })}
                  className="text-[#94A3B8] hover:text-[#4ADE80]"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Marcar resolvido
                </Button>
              )}
            </div>

            {replyingId === comment.id && (
              <div className="mt-3 space-y-2">
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Escreva a resposta pública ao comentário…"
                  data-testid={`comment-reply-input-${comment.id}`}
                  className="border-[#282E40] bg-[#10131B] text-[#F8FAFC]"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" data-testid={`comment-reply-cancel-${comment.id}`} onClick={() => setReplyingId("")}>Cancelar</Button>
                  <Button
                    size="sm"
                    data-testid={`comment-reply-submit-${comment.id}`}
                    disabled={!replyText.trim() || replyMutation.isPending}
                    onClick={() => replyMutation.mutate({ id: comment.id, text: replyText.trim() })}
                    className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"
                  >
                    Enviar resposta
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
        {comments.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#282E40] p-12 text-center">
            <MessageSquare className="h-8 w-8 text-[#C5A46D]" />
            <p className="text-sm text-[#94A3B8]">Nenhum comentário encontrado.</p>
          </div>
        )}
      </div>

    </div>
  );
}
