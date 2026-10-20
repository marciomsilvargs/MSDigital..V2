import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarClock,
  CheckCircle2,
  Clapperboard,
  Copy,
  Link2,
  Play,
  RotateCcw,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm, ApiError } from "@/lib/api";
import { companyKey, useCompanies } from "@/lib/company-context";
import type { ConnectionStatus, MediaItem, Story, StoryStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { LockBanner, SourceBadge } from "@/components/connection-bits";

const STATUS_META: Record<StoryStatus, { label: string; className: string }> = {
  draft: { label: "Rascunho", className: "bg-slate-800 text-slate-300 border-slate-700" },
  scheduled: { label: "Agendado", className: "bg-blue-950/60 text-blue-300 border-blue-800" },
  publishing: { label: "Publicando…", className: "bg-blue-950/60 text-blue-300 border-blue-800 animate-pulse" },
  published: { label: "Publicado", className: "bg-emerald-950/60 text-emerald-300 border-emerald-800" },
  failed: { label: "Falhou", className: "bg-red-950/60 text-red-300 border-red-800" },
  canceled: { label: "Cancelado", className: "bg-slate-800 text-slate-400 border-slate-700" },
};

function StatusBadge({ status, testid }: { status: StoryStatus; testid?: string }) {
  const meta = STATUS_META[status];
  return (
    <Badge data-testid={testid ?? "story-status-badge"} className={cn("rounded-full border", meta.className)}>
      {meta.label}
    </Badge>
  );
}

export default function Stories() {
  const queryClient = useQueryClient();
  const { activeCompany } = useCompanies();
  const companyId = activeCompany?.id;

  const { data: media = [] } = useQuery({
    queryKey: companyKey(companyId, "media"),
    queryFn: () => apiGet<MediaItem[]>(`/companies/${companyId}/media`),
    enabled: !!companyId,
  });
  const { data: stories = [] } = useQuery({
    queryKey: companyKey(companyId, "stories"),
    queryFn: () => apiGet<Story[]>(`/companies/${companyId}/stories`),
    enabled: !!companyId,
  });
  const { data: connStatus } = useQuery({
    queryKey: companyKey(companyId, "connection"),
    queryFn: () => apiGet<ConnectionStatus>(`/companies/${companyId}/connection`),
    enabled: !!companyId,
  });

  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [caption, setCaption] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [view, setView] = useState("week");
  const [selectedDay, setSelectedDay] = useState(new Date());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const connection = connStatus?.connection ?? null;
  const connected = connection?.state === "connected" || connection?.state === "partially_connected";
  const activeMedia = selectedMedia ?? media[0] ?? null;

  function errorToast(error: unknown) {
    const detail = error instanceof ApiError ? (error.body as { detail?: string } | null)?.detail : undefined;
    if (typeof detail === "string") toast.error(detail);
    else toast.error("Operação não concluída.");
  }

  function invalidateStories() {
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "stories") });
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "reports") });
  }

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiPostForm<MediaItem>(`/companies/${companyId}/media/upload`, form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companyKey(companyId, "media") });
      toast.success("Mídia adicionada à biblioteca!");
    },
    onError: errorToast,
  });

  const urlMutation = useMutation({
    mutationFn: () => apiPost<MediaItem>(`/companies/${companyId}/media`, { url: mediaUrl, name: "mídia externa" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companyKey(companyId, "media") });
      setUrlDialogOpen(false);
      setMediaUrl("");
      toast.success("Mídia externa adicionada!");
    },
    onError: errorToast,
  });

  const scheduleMutation = useMutation({
    mutationFn: (asDraft: boolean) =>
      apiPost<Story>(`/companies/${companyId}/stories`, {
        media_id: activeMedia!.id,
        caption,
        schedule_at: scheduleAt ? new Date(scheduleAt).toISOString() : new Date().toISOString(),
        as_draft: asDraft,
      }),
    onSuccess: (_data, asDraft) => {
      invalidateStories();
      setCaption("");
      toast.success(asDraft ? "Rascunho salvo." : "Story agendado com sucesso! Publicação automática no horário programado.");
    },
    onError: errorToast,
  });

  const storyAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "publish" | "duplicate" | "retry" | "cancel" | "delete" }) => {
      const base = `/companies/${companyId}/stories/${id}`;
      switch (action) {
        case "publish":
          return apiPost<Story>(`${base}/publish-now`);
        case "duplicate":
          return apiPost<Story>(`${base}/duplicate`);
        case "retry":
          return apiPost<Story>(`${base}/retry`);
        case "cancel":
          return apiPatch<Story>(base, { status: "canceled" });
        case "delete":
          return apiDelete<Story>(base);
      }
    },
    onSuccess: (_data, vars) => {
      invalidateStories();
      const messages: Record<string, string> = {
        publish: "Story publicado!",
        duplicate: "Story duplicado — ajuste o horário.",
        retry: "Story reagendado para nova tentativa.",
        cancel: "Story cancelado.",
        delete: "Story excluído.",
      };
      toast.success(messages[vars.action]);
    },
    onError: errorToast,
  });

  if (!activeCompany) {
    return (
      <div className="rounded-xl border border-[#282E40] bg-[#181C26] p-8 text-center text-[#94A3B8]">
        Selecione uma empresa primeiro.
      </div>
    );
  }

  const weekDays = eachDayOfInterval({ start: startOfWeek(selectedDay, { weekStartsOn: 0 }), end: endOfWeek(selectedDay, { weekStartsOn: 0 }) });
  const monthDays = eachDayOfInterval({ start: startOfMonth(selectedDay), end: endOfMonth(selectedDay) });
  const storiesOfDay = (day: Date) => stories.filter((s) => isSameDay(parseISO(s.schedule_at), day));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Estúdio de Stories</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#F8FAFC] md:text-3xl">Stories — {activeCompany.name}</h1>
        <p className="mt-1 text-sm text-[#94A3B8]">
          Agende múltiplos stories, duplique publicações e acompanhe tentativas — a publicação ocorre no
          servidor, mesmo com o navegador fechado.
        </p>
      </div>

      {!connected && <LockBanner onConnect={() => (window.location.href = "/connection?connect=1")} testid="stories-lock-banner" />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Library */}
        <Card className="border-[#282E40] bg-[#181C26] lg:col-span-4" data-testid="story-library-card">
          <div className="flex items-center justify-between p-5 pb-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Biblioteca de mídias</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" data-testid="media-upload-button" onClick={() => fileInputRef.current?.click()} className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]">
                <Upload className="h-3.5 w-3.5" /> Enviar
              </Button>
              <Button size="sm" variant="outline" data-testid="media-url-button" onClick={() => setUrlDialogOpen(true)} className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]">
                <Link2 className="h-3.5 w-3.5" /> URL
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                data-testid="media-file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadMutation.mutate(file);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 px-5 pb-5">
            {media.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`media-item-${item.id}`}
                onClick={() => setSelectedMedia(item)}
                className={cn(
                  "relative aspect-[9/16] overflow-hidden rounded-lg border-2 transition-colors",
                  activeMedia?.id === item.id ? "border-[#C5A46D]" : "border-transparent hover:border-[#C5A46D]/40"
                )}
              >
                {item.media_type === "image" ? (
                  <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
                ) : (
                  <video src={item.url} className="h-full w-full object-cover" muted />
                )}
              </button>
            ))}
            {media.length === 0 && (
              <p className="col-span-3 py-8 text-center text-sm text-[#94A3B8]">Nenhuma mídia na biblioteca.</p>
            )}
          </div>
        </Card>

        {/* 9:16 preview */}
        <div className="lg:col-span-4" data-testid="story-preview-column">
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-[#282E40] bg-[#181C26] p-6">
            <div className="relative aspect-[9/16] w-full max-w-[240px] overflow-hidden rounded-2xl border-4 border-[#282E40] bg-[#0D1017]" data-testid="story-preview-frame">
              {activeMedia ? (
                activeMedia.media_type === "image" ? (
                  <img src={activeMedia.url} alt="Pré-visualização do story" className="h-full w-full object-cover" />
                ) : (
                  <video src={activeMedia.url} className="h-full w-full object-cover" muted autoPlay loop />
                )
              ) : (
                <div className="flex h-full items-center justify-center text-[#94A3B8]">
                  <Clapperboard className="h-8 w-8" />
                </div>
              )}
              {caption && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                  <p className="text-xs text-white" data-testid="story-preview-caption">{caption}</p>
                </div>
              )}
              <span className="absolute left-2 right-2 top-2 flex h-6 items-center gap-1.5 rounded-full bg-black/50 px-2">
                <span className="h-1.5 flex-1 rounded-full bg-white/70" />
                <span className="h-1.5 flex-1 rounded-full bg-white/30" />
              </span>
            </div>
            <p className="mt-3 text-xs text-[#94A3B8]">Pré-visualização 9:16</p>
          </div>
        </div>

        {/* Scheduling */}
        <Card className="border-[#282E40] bg-[#181C26] lg:col-span-4" data-testid="story-schedule-card">
          <div className="p-5 pb-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Agendar publicação</p>
          </div>
          <div className="space-y-4 px-5 pb-5">
            <div className="space-y-2">
              <Label htmlFor="story-caption" className="text-[#94A3B8]">Legenda</Label>
              <Textarea
                id="story-caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Texto do story…"
                data-testid="story-caption-input"
                className="border-[#282E40] bg-[#10131B] text-[#F8FAFC]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="story-when" className="text-[#94A3B8]">Data e hora</Label>
              <Input
                id="story-when"
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                data-testid="story-datetime-input"
                className="border-[#282E40] bg-[#10131B] text-[#F8FAFC]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Button
                data-testid="story-schedule-submit"
                disabled={!activeMedia || scheduleMutation.isPending}
                onClick={() => scheduleMutation.mutate(false)}
                className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"
              >
                <CalendarClock className="h-4 w-4" /> Agendar Story
              </Button>
              <Button
                data-testid="story-draft-submit"
                variant="outline"
                disabled={!activeMedia || scheduleMutation.isPending}
                onClick={() => scheduleMutation.mutate(true)}
                className="border-[#282E40] bg-transparent text-[#F8FAFC] hover:bg-[#202534]"
              >
                Salvar rascunho
              </Button>
            </div>
            <p className="rounded-lg bg-[#10131B] p-3 text-xs text-[#94A3B8]">
              {connected
                ? "A publicação será executada automaticamente pelo servidor no horário programado."
                : "Sem conexão ativa: o agendamento é permitido, mas a publicação falhará com orientação até o Instagram ser conectado."}
            </p>
          </div>
        </Card>
      </div>

      {/* Calendar + history */}
      <Card className="border-[#282E40] bg-[#181C26]" data-testid="story-calendar-card">
        <Tabs value={view} onValueChange={setView}>
          <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
            <TabsList className="bg-[#10131B]">
              <TabsTrigger value="week" data-testid="calendar-week-tab">Semana</TabsTrigger>
              <TabsTrigger value="month" data-testid="calendar-month-tab">Mês</TabsTrigger>
              <TabsTrigger value="history" data-testid="calendar-history-tab">Histórico</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" data-testid="calendar-prev" onClick={() => setSelectedDay((d) => addDays(d, view === "month" ? -15 : -7))}>←</Button>
              <span className="text-sm font-semibold capitalize text-[#F8FAFC]">{format(selectedDay, "MMMM 'de' yyyy", { locale: ptBR })}</span>
              <Button size="sm" variant="ghost" data-testid="calendar-next" onClick={() => setSelectedDay((d) => addDays(d, view === "month" ? 15 : 7))}>→</Button>
            </div>
          </div>

          <TabsContent value="week" className="px-5 pb-5">
            <div className="grid grid-cols-7 gap-2" data-testid="calendar-week-grid">
              {weekDays.map((day) => (
                <button
                  key={day.toISOString()}
                  type="button"
                  data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    "min-h-24 rounded-lg border p-2 text-left transition-colors",
                    isSameDay(day, selectedDay) ? "border-[#C5A46D] bg-[#2A2317]" : "border-[#282E40] bg-[#10131B] hover:border-[#C5A46D]/40"
                  )}
                >
                  <p className="text-[10px] uppercase text-[#94A3B8]">{format(day, "EEE", { locale: ptBR })}</p>
                  <p className="text-sm font-bold text-[#F8FAFC]">{format(day, "dd")}</p>
                  {storiesOfDay(day).slice(0, 2).map((story) => (
                    <span key={story.id} className="mt-1 block truncate rounded bg-[#222838] px-1 py-0.5 text-[10px] text-[#E9D2A8]">
                      {format(parseISO(story.schedule_at), "HH:mm")} {story.caption || "Story"}
                    </span>
                  ))}
                  {storiesOfDay(day).length > 2 && (
                    <span className="mt-0.5 block text-[10px] text-[#94A3B8]">+{storiesOfDay(day).length - 2} mais</span>
                  )}
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="month" className="px-5 pb-5">
            <div className="grid grid-cols-7 gap-1.5" data-testid="calendar-month-grid">
              {monthDays.map((day) => (
                <button
                  key={day.toISOString()}
                  type="button"
                  data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    "min-h-16 rounded-lg border p-1.5 text-left transition-colors",
                    isSameDay(day, selectedDay) ? "border-[#C5A46D] bg-[#2A2317]" : "border-[#282E40] bg-[#10131B] hover:border-[#C5A46D]/40"
                  )}
                >
                  <p className="text-xs font-semibold text-[#F8FAFC]">{format(day, "dd")}</p>
                  {storiesOfDay(day).length > 0 && (
                    <span className="mt-0.5 block rounded bg-[#222838] px-1 text-[10px] text-[#E9D2A8]">
                      {storiesOfDay(day).length} story{storiesOfDay(day).length > 1 ? "s" : ""}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="history" className="px-5 pb-5" data-testid="story-history-list">
            <div className="space-y-3">
              {[...stories].reverse().map((story) => (
                <div key={story.id} data-testid={`story-row-${story.id}`} className="flex flex-col gap-3 rounded-xl border border-[#282E40] bg-[#10131B] p-4 sm:flex-row sm:items-center">
                  <div className="h-16 w-9 shrink-0 overflow-hidden rounded bg-[#202534]">
                    {story.media_type === "image" ? (
                      <img src={story.media_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <video src={story.media_url} className="h-full w-full object-cover" muted />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={story.status} testid={`story-status-${story.id}`} />
                      {story.status === "published" && story.execution && (
                        <SourceBadge source={story.execution} testid={`story-execution-${story.id}`} />
                      )}
                      <span className="text-xs text-[#94A3B8]" data-testid={`story-when-${story.id}`}>
                        {format(parseISO(story.schedule_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                      </span>
                      {story.attempts > 0 && (
                        <span className="text-xs text-[#FBBF24]">{story.attempts} tentativa{story.attempts > 1 ? "s" : ""}</span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-[#F8FAFC]">{story.caption || "Sem legenda"}</p>
                    {story.last_error && (
                      <p className="mt-1 rounded bg-[#221318] px-2 py-1 text-xs text-[#F87171]" data-testid={`story-error-${story.id}`}>
                        {story.last_error}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {["draft", "scheduled", "failed"].includes(story.status) && (
                      <Button size="sm" variant="outline" data-testid={`story-publish-${story.id}`} onClick={() => storyAction.mutate({ id: story.id, action: "publish" })} disabled={!connected} className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]" aria-label="Publicar agora">
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="outline" data-testid={`story-duplicate-${story.id}`} onClick={() => storyAction.mutate({ id: story.id, action: "duplicate" })} className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]" aria-label="Duplicar">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    {story.status === "failed" && (
                      <Button size="sm" variant="outline" data-testid={`story-retry-${story.id}`} onClick={() => storyAction.mutate({ id: story.id, action: "retry" })} className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]" aria-label="Tentar novamente">
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {["draft", "scheduled"].includes(story.status) && (
                      <Button size="sm" variant="outline" data-testid={`story-cancel-${story.id}`} onClick={() => storyAction.mutate({ id: story.id, action: "cancel" })} className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]" aria-label="Cancelar">
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="outline" data-testid={`story-delete-${story.id}`} onClick={() => storyAction.mutate({ id: story.id, action: "delete" })} className="border-[#282E40] text-[#F87171] hover:bg-[#221318]" aria-label="Excluir">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {stories.length === 0 && <p className="py-8 text-center text-sm text-[#94A3B8]">Nenhum story agendado ainda.</p>}
            </div>
          </TabsContent>
        </Tabs>
      </Card>

      <Dialog open={urlDialogOpen} onOpenChange={setUrlDialogOpen}>
        <DialogContent role="dialog" className="border-[#2E364D] bg-[#1E2330]" data-testid="media-url-dialog">
          <DialogHeader>
            <DialogTitle className="text-[#F8FAFC]">Adicionar mídia por URL</DialogTitle>
            <DialogDescription className="text-[#94A3B8]">
              Use uma URL HTTPS pública (exigida pela Graph API para publicação real).
            </DialogDescription>
          </DialogHeader>
          <Input
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
            placeholder="https://…/foto.jpg"
            data-testid="media-url-input"
            className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUrlDialogOpen(false)}>Cancelar</Button>
            <Button data-testid="media-url-submit" disabled={!mediaUrl.trim() || urlMutation.isPending} onClick={() => urlMutation.mutate()} className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]">
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
