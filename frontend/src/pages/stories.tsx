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
  BarChart3,
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
import type { ConnectionStatus, MediaItem, Story, StoryInsight, StoryStatus } from "@/lib/types";
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
  const { data: insightPayload } = useQuery({
    queryKey: companyKey(companyId, "story-insights"),
    queryFn: () => apiGet<{ stories: Story[]; insights: StoryInsight[] }>(`/companies/${companyId}/story-insights`),
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
  const [deleteAt, setDeleteAt] = useState("");
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [view, setView] = useState("week");
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [previewStory, setPreviewStory] = useState<Story | null>(null);
  const [previewFit, setPreviewFit] = useState<"cover" | "contain">("contain");
  const [previewScale, setPreviewScale] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const connection = connStatus?.connection ?? null;
  const connected = connection?.state === "connected" || connection?.state === "partially_connected";
  const activeMedia = selectedMedia ?? media[0] ?? null;
  const latestInsightByStory = new Map<string, StoryInsight>();
  for (const insight of insightPayload?.insights ?? []) latestInsightByStory.set(insight.story_id, insight);
  const hourlyPerformance = new Map<number, { reach: number; impressions: number }>();
  for (const story of stories) {
    const insight = latestInsightByStory.get(story.id);
    if (!insight || !story.published_at) continue;
    const hour = new Date(story.published_at).getHours();
    const current = hourlyPerformance.get(hour) ?? { reach: 0, impressions: 0 };
    current.reach += Number(insight.reach ?? 0);
    current.impressions += Number(insight.impressions ?? 0);
    hourlyPerformance.set(hour, current);
  }
  const bestHour = [...hourlyPerformance.entries()].sort((a, b) => b[1].reach - a[1].reach)[0];

  function errorToast(error: unknown) {
    const detail = error instanceof ApiError ? (error.body as { detail?: string } | null)?.detail : undefined;
    if (typeof detail === "string") toast.error(detail);
    else toast.error("Operação não concluída.");
  }

  function invalidateStories() {
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "stories") });
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "story-insights") });
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

  const deleteMediaMutation = useMutation({
    mutationFn: (id: string) => apiDelete<MediaItem>(`/companies/${companyId}/media/${id}`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: companyKey(companyId, "media") });
      setSelectedMedia((selected) => selected?.id === id ? null : selected);
      toast.success("Mídia removida da biblioteca.");
    },
    onError: errorToast,
  });

  const scheduleMutation = useMutation({
    mutationFn: (asDraft: boolean) =>
      apiPost<Story>(`/companies/${companyId}/stories`, {
        media_id: activeMedia!.id,
        caption,
        schedule_at: scheduleAt ? new Date(scheduleAt).toISOString() : new Date().toISOString(),
        delete_at: deleteAt ? new Date(deleteAt).toISOString() : null,
        crop_scale: previewScale,
        as_draft: asDraft,
      }),
    onSuccess: (_data, asDraft) => {
      invalidateStories();
      setCaption("");
      setDeleteAt("");
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
              <div
                key={item.id}
                className={cn(
                  "group relative aspect-[9/16] overflow-hidden rounded-lg border-2 transition-colors",
                  activeMedia?.id === item.id ? "border-[#C5A46D]" : "border-transparent hover:border-[#C5A46D]/40"
                )}
              >
                <button type="button" data-testid={`media-item-${item.id}`} onClick={() => setSelectedMedia(item)} aria-label={`Selecionar ${item.name}`} className="h-full w-full">
                  {item.media_type === "image" ? (
                    <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
                  ) : (
                    <video src={item.url} className="h-full w-full object-cover" muted />
                  )}
                </button>
                <button
                  type="button"
                  data-testid={`media-delete-${item.id}`}
                  aria-label={`Excluir ${item.name} da biblioteca`}
                  title="Excluir da biblioteca"
                  disabled={deleteMediaMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`Excluir “${item.name}” da biblioteca? Stories já agendados continuarão usando esta mídia.`)) deleteMediaMutation.mutate(item.id);
                  }}
                  className="absolute right-1 top-1 rounded-md bg-black/75 p-1.5 text-white opacity-0 transition-opacity hover:bg-red-700 focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
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
                  <>
                    <img src={activeMedia.url} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-xl" />
                    <img src={activeMedia.url} alt="Pré-visualização do story" className={cn("relative h-full w-full transition-transform duration-150", previewFit === "cover" ? "object-cover" : "object-contain")} style={{ transform: `scale(${previewScale})` }} />
                  </>
                ) : (
                  <>
                    <video src={activeMedia.url} aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-xl" muted autoPlay loop playsInline preload="metadata" />
                    <video src={activeMedia.url} aria-label="Pré-visualização do story" className={cn("relative h-full w-full transition-transform duration-150", previewFit === "cover" ? "object-cover" : "object-contain")} style={{ transform: `scale(${previewScale})` }} muted autoPlay loop controls playsInline preload="metadata" />
                  </>
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
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-[#94A3B8]">Ajuste:</span>
              <Button type="button" size="sm" variant={previewFit === "contain" ? "secondary" : "ghost"} onClick={() => setPreviewFit("contain")} data-testid="story-fit-contain" className="h-7 px-2 text-xs">Conter</Button>
              <Button type="button" size="sm" variant={previewFit === "cover" ? "secondary" : "ghost"} onClick={() => setPreviewFit("cover")} data-testid="story-fit-cover" className="h-7 px-2 text-xs">Preencher</Button>
            </div>
            <div className="mt-4 w-full max-w-[240px] space-y-1.5">
              <div className="flex items-center justify-between text-xs text-[#94A3B8]">
                <label htmlFor="story-preview-scale">Tamanho no Story</label>
                <span className="font-medium text-[#E9D2A8]">{Math.round(previewScale * 100)}%</span>
              </div>
              <input
                id="story-preview-scale"
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={previewScale}
                onChange={(event) => setPreviewScale(Number(event.target.value))}
                aria-label="Ajustar tamanho da mídia no Story"
                data-testid="story-preview-scale"
                className="h-2 w-full cursor-pointer accent-[#C5A46D]"
              />
              <div className="flex justify-between text-[10px] text-[#64748B]"><span>Menor</span><span>Maior</span></div>
            </div>
            <p className="mt-1 text-xs text-[#94A3B8]">Pré-visualização 9:16 · a mídia mantém a proporção original</p>
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
              <Label htmlFor="story-delete-when" className="text-[#94A3B8]">Excluir do Instagram em (opcional)</Label>
              <Input
                id="story-delete-when"
                type="datetime-local"
                value={deleteAt}
                onChange={(e) => setDeleteAt(e.target.value)}
                data-testid="story-delete-datetime-input"
                className="border-[#282E40] bg-[#10131B] text-[#F8FAFC]"
              />
              <p className="text-xs text-[#64748B]">Se ficar vazio, o Instagram remove o Story automaticamente após 24 horas.</p>
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

      <Card className="border-[#282E40] bg-[#181C26]" data-testid="story-insights-card">
        <div className="flex items-center gap-2 p-5 pb-2">
          <BarChart3 className="h-4 w-4 text-[#C5A46D]" />
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Desempenho dos Stories</p>
        </div>
        <div className="px-5 pb-5 text-sm text-[#94A3B8]">
          {bestHour ? (
            <p>Melhor horário até agora: <strong className="text-[#F8FAFC]">{String(bestHour[0]).padStart(2, "0")}:00</strong> · alcance somado <strong className="text-[#F8FAFC]">{bestHour[1].reach}</strong>.</p>
          ) : (
            <p>As métricas aparecerão depois que os próximos Stories forem publicados e o agendador fizer a primeira coleta.</p>
          )}
        </div>
      </Card>

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
                  <button type="button" onClick={() => setPreviewStory(story)} className="relative h-16 w-9 shrink-0 overflow-hidden rounded bg-[#202534]" aria-label="Abrir pré-visualização do story">
                    {story.media_type === "image" ? (
                      <img src={story.url ?? story.media_url} alt="Story agendado" className="h-full w-full object-cover" />
                    ) : (
                      <video src={story.url ?? story.media_url} className="h-full w-full object-cover" muted playsInline preload="metadata" onContextMenu={(event) => event.preventDefault()} />
                    )}
                    {story.media_type === "video" && <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white"><Play className="h-4 w-4 fill-current" /></span>}
                  </button>
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
                      {story.delete_status === "scheduled" && story.delete_at && <span className="text-xs text-[#FBBF24]">exclusão {format(parseISO(story.delete_at), "dd/MM HH:mm")}</span>}
                      {story.delete_status === "deleted" && <span className="text-xs text-[#94A3B8]">removido do Instagram</span>}
                    </div>
                    <p className="mt-1 truncate text-sm text-[#F8FAFC]">{story.caption || "Sem legenda"}</p>
                    {story.last_error && (
                      <p className="mt-1 rounded bg-[#221318] px-2 py-1 text-xs text-[#F87171]" data-testid={`story-error-${story.id}`}>
                        {story.last_error}
                      </p>
                    )}
                    {story.delete_error && <p className="mt-1 rounded bg-[#221318] px-2 py-1 text-xs text-[#F87171]">Falha na exclusão: {story.delete_error}</p>}
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
                      <Button size="sm" variant="outline" data-testid={`story-cancel-${story.id}`} onClick={() => { if (window.confirm("Cancelar este agendamento?")) storyAction.mutate({ id: story.id, action: "cancel" }); }} disabled={storyAction.isPending} className="border-[#6B5360] text-[#FBBF24] hover:bg-[#2A2024]" aria-label="Cancelar agendamento" title="Cancelar agendamento">
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                        Cancelar
                      </Button>
                    )}
                    <Button size="sm" variant="outline" data-testid={`story-delete-${story.id}`} onClick={() => { if (window.confirm("Excluir este agendamento/story permanentemente?")) storyAction.mutate({ id: story.id, action: "delete" }); }} disabled={storyAction.isPending} className="border-[#282E40] text-[#F87171] hover:bg-[#221318]" aria-label="Excluir story" title="Excluir story">
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

      <Dialog open={!!previewStory} onOpenChange={(open) => !open && setPreviewStory(null)}>
        <DialogContent className="max-w-md border-[#2E364D] bg-[#1E2330]" data-testid="story-preview-dialog">
          <DialogHeader>
            <DialogTitle className="text-[#F8FAFC]">Pré-visualização do Story</DialogTitle>
            <DialogDescription className="text-[#94A3B8]">
              {previewStory?.caption || "Sem legenda"}
            </DialogDescription>
          </DialogHeader>
          {previewStory && (
            <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-xl bg-black">
              {previewStory.media_type === "image" ? (
                <img src={previewStory.url ?? previewStory.media_url} alt="Pré-visualização do Story" className="max-h-[65vh] w-full object-contain" />
              ) : (
                <video src={previewStory.url ?? previewStory.media_url} className="max-h-[65vh] w-full" controls autoPlay playsInline preload="metadata" />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

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

