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
  Pencil,
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
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Array<{ publishTime: string; deleteTime: string }>>([{ publishTime: "", deleteTime: "" }]);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatEndDate, setRepeatEndDate] = useState("");
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [view, setView] = useState("week");
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [previewStory, setPreviewStory] = useState<Story | null>(null);
  const [previewFit, setPreviewFit] = useState<"cover" | "contain">("contain");
  const [previewScale, setPreviewScale] = useState(1);
  const [selectedStoryIds, setSelectedStoryIds] = useState<string[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"all" | "scheduled" | "published" | "canceled" | "failed">("all");
  const [historySearch, setHistorySearch] = useState("");
  const [historyView, setHistoryView] = useState<"grouped" | "list">("grouped");
  const [historyVisibleLimit, setHistoryVisibleLimit] = useState(100);
  const [deleteEditStory, setDeleteEditStory] = useState<Story | null>(null);
  const [deleteEditAt, setDeleteEditAt] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const connection = connStatus?.connection ?? null;
  const connected = connection?.state === "connected" || connection?.state === "partially_connected";
  const activeMedia = selectedMedia ?? media[0] ?? null;
  const selectedMediaItems = media.filter((item) => selectedMediaIds.includes(item.id));
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

  function repeatOccurrences() {
    if (!scheduleAt || slots.length === 0) return [];
    const first = new Date(scheduleAt);
    const startDate = new Date(first);
    startDate.setHours(0, 0, 0, 0);
    const end = repeatEnabled && repeatEndDate ? new Date(`${repeatEndDate}T23:59:59`) : startDate;
    const dates: Array<{ publish_at: string; delete_at: string | null }> = [];
    const cursor = new Date(startDate);
    while (cursor <= end && dates.length < 1000) {
      if (!repeatEnabled || repeatDays.includes(cursor.getDay())) for (const slot of slots) {
        if (!slot.publishTime) continue;
        const [hour, minute] = slot.publishTime.split(":").map(Number);
        const publish = new Date(cursor);
        publish.setHours(hour, minute, 0, 0);
        let deletion: string | null = null;
        if (slot.deleteTime) {
          const [deleteHour, deleteMinute] = slot.deleteTime.split(":").map(Number);
          const deleteDate = new Date(cursor);
          deleteDate.setHours(deleteHour, deleteMinute, 0, 0);
          if (deleteDate <= publish) deleteDate.setDate(deleteDate.getDate() + 1);
          deletion = deleteDate.toISOString();
        }
        dates.push({ publish_at: publish.toISOString(), delete_at: deletion });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
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
    mutationFn: (asDraft: boolean) => editingStoryId
      ? apiPatch<Story>(`/companies/${companyId}/stories/${editingStoryId}`, {
        caption,
        schedule_at: repeatOccurrences()[0]?.publish_at ?? new Date(scheduleAt).toISOString(),
        delete_at: repeatOccurrences()[0]?.delete_at ?? null,
        crop_scale: previewScale,
      })
      : apiPost<Story | Story[]>(`/companies/${companyId}/stories`, {
        media_id: activeMedia!.id,
        caption,
        schedule_at: repeatOccurrences()[0]?.publish_at ?? new Date().toISOString(),
        crop_scale: previewScale,
        repeat_occurrences: asDraft ? [] : repeatOccurrences(),
        as_draft: asDraft,
      }),
    onSuccess: (data, asDraft) => {
      invalidateStories();
      setCaption("");
      setEditingStoryId(null);
      setSlots([{ publishTime: "", deleteTime: "" }]);
      setRepeatEnabled(false);
      setRepeatEndDate("");
      setRepeatDays([]);
      const count = Array.isArray(data) ? data.length : 1;
      toast.success(asDraft ? "Rascunho salvo." : count > 1 ? `${count} Stories agendados com sucesso!` : "Story agendado com sucesso! Publicação automática no horário programado.");
    },
    onError: errorToast,
  });

  const sequenceScheduleMutation = useMutation({
    mutationFn: async (asDraft: boolean) => {
      const occurrences = repeatOccurrences();
      const schedule = occurrences[0]?.publish_at ?? new Date(scheduleAt).toISOString();
      const payload = (item: MediaItem) => ({
        media_id: item.id,
        caption,
        schedule_at: schedule,
        crop_scale: previewScale,
        repeat_occurrences: asDraft ? [] : occurrences,
        as_draft: asDraft,
      });
      return Promise.all(selectedMediaItems.map((item) => apiPost<Story | Story[]>(`/companies/${companyId}/stories`, payload(item))));
    },
    onSuccess: (results, asDraft) => {
      invalidateStories();
      setSelectedMediaIds([]);
      setCaption("");
      setSlots([{ publishTime: "", deleteTime: "" }]);
      setRepeatEnabled(false);
      setRepeatEndDate("");
      setRepeatDays([]);
      const count = results.reduce((total, result) => total + (Array.isArray(result) ? result.length : 1), 0);
      toast.success(asDraft ? `${count} rascunhos salvos.` : `${count} Stories da sequência agendados com sucesso!`);
    },
    onError: errorToast,
  });

  const storyAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "publish" | "duplicate" | "retry" | "retry-delete" | "cancel" | "delete" }) => {
      const base = `/companies/${companyId}/stories/${id}`;
      switch (action) {
        case "publish":
          return apiPost<Story>(`${base}/publish-now`);
        case "duplicate":
          return apiPost<Story>(`${base}/duplicate`);
        case "retry":
          return apiPost<Story>(`${base}/retry`);
        case "retry-delete":
          return apiPatch<Story>(base, { delete_at: new Date().toISOString() });
        case "cancel":
          return apiPatch<Story>(base, { status: "canceled" });
        case "delete":
          return apiDelete<Story>(base);
      }
    },
    onSuccess: (_data, vars) => {
      queryClient.setQueryData<Story[]>(companyKey(companyId, "stories"), (current) => {
        if (!current) return current;
        if (vars.action === "delete") return current.filter((story) => story.id !== vars.id);
        if (vars.action === "cancel") return current.map((story) => story.id === vars.id ? { ...story, status: "canceled" } : story);
        return current;
      });
      invalidateStories();
      const messages: Record<string, string> = {
        publish: "Story publicado!",
        duplicate: "Story duplicado — ajuste o horário.",
        retry: "Story reagendado para nova tentativa.",
        "retry-delete": "Exclusão colocada novamente na fila.",
        cancel: "Story cancelado.",
        delete: "Story excluído.",
      };
      toast.success(messages[vars.action]);
    },
    onError: errorToast,
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: ({ id, deleteAt }: { id: string; deleteAt: string | null }) =>
      apiPatch<Story>(`/companies/${companyId}/stories/${id}`, { delete_at: deleteAt }),
    onSuccess: () => {
      invalidateStories();
      setDeleteEditStory(null);
      setDeleteEditAt("");
      toast.success("Regra de exclusão atualizada.");
    },
    onError: errorToast,
  });

  const bulkStoryAction = useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: "cancel" | "delete" }) => {
      await Promise.all(ids.map((id) => {
        const base = `/companies/${companyId}/stories/${id}`;
        return action === "cancel" ? apiPatch<Story>(base, { status: "canceled" }) : apiDelete<Story>(base);
      }));
    },
    onSuccess: (_data, vars) => {
      queryClient.setQueryData<Story[]>(companyKey(companyId, "stories"), (current) => {
        if (!current) return current;
        const ids = new Set(vars.ids);
        if (vars.action === "delete") return current.filter((story) => !ids.has(story.id));
        return current.map((story) => ids.has(story.id) ? { ...story, status: "canceled" } : story);
      });
      setSelectedStoryIds([]);
      invalidateStories();
      toast.success(vars.action === "cancel" ? "Agendamentos cancelados." : "Stories excluídos.");
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
  const filteredHistoryStories = [...stories]
    .reverse()
    .filter((story) => historyFilter === "all" || story.status === historyFilter)
    .filter((story) => {
      const query = historySearch.trim().toLowerCase();
      return !query || (story.caption || "").toLowerCase().includes(query) || format(parseISO(story.schedule_at), "dd/MM/yyyy HH:mm").includes(query);
    });
  // Render a bounded first page. Large repeat schedules can contain hundreds of
  // rows; keeping the rest out of the DOM prevents the history screen from
  // freezing while preserving bulk actions and month grouping for visible rows.
  const visibleHistoryStories = filteredHistoryStories.slice(0, historyVisibleLimit);
  const historyGroups = visibleHistoryStories.reduce<Record<string, Story[]>>((groups, story) => {
    const key = format(parseISO(story.schedule_at), "yyyy-MM");
    (groups[key] ??= []).push(story);
    return groups;
  }, {});
  const historyGroupEntries = Object.entries(historyGroups).sort(([a], [b]) => b.localeCompare(a));
  const selectableHistoryStories = visibleHistoryStories.filter((story) => ["draft", "scheduled"].includes(story.status));
  const allSelectableSelected = selectableHistoryStories.length > 0 && selectableHistoryStories.every((story) => selectedStoryIds.includes(story.id));
  const selectedStories = stories.filter((story) => selectedStoryIds.includes(story.id));
  const selectedCancelable = selectedStories.filter((story) => ["draft", "scheduled"].includes(story.status));

  function dateTimeLocalValue(value: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (number: number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function openDeleteEditor(story: Story) {
    setDeleteEditStory(story);
    setDeleteEditAt(dateTimeLocalValue(story.delete_at));
  }

  function toggleGroupSelection(groupStories: Story[]) {
    const ids = groupStories.filter((story) => ["draft", "scheduled"].includes(story.status)).map((story) => story.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedStoryIds.includes(id));
    setSelectedStoryIds((current) => allSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]);
  }

  function renderHistoryRow(story: Story) {
    return (
      <div key={story.id} data-testid={`story-row-${story.id}`} className="flex flex-col gap-4 rounded-xl border border-[#282E40] bg-[#10131B] p-5 sm:flex-row sm:items-center">
        <input type="checkbox" checked={selectedStoryIds.includes(story.id)} onChange={(event) => setSelectedStoryIds((current) => event.target.checked ? [...new Set([...current, story.id])] : current.filter((id) => id !== story.id))} aria-label={`Selecionar Story de ${format(parseISO(story.schedule_at), "dd/MM HH:mm")}`} className="h-4 w-4 shrink-0 accent-[#C5A46D]" />
        <button type="button" onClick={() => setPreviewStory(story)} className="relative h-24 w-14 shrink-0 overflow-hidden rounded-lg bg-[#202534]" aria-label="Abrir pré-visualização do story">
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
            {story.status === "published" && story.execution && <SourceBadge source={story.execution} testid={`story-execution-${story.id}`} />}
            <span className="text-sm text-[#94A3B8]" data-testid={`story-when-${story.id}`}>{format(parseISO(story.schedule_at), "dd/MM 'às' HH:mm", { locale: ptBR })}</span>
            {story.attempts > 0 && <span className="text-xs text-[#FBBF24]">{story.attempts} tentativa{story.attempts > 1 ? "s" : ""}</span>}
            {story.delete_status === "scheduled" && story.delete_at && <span className="text-xs text-[#FBBF24]">exclusão {format(parseISO(story.delete_at), "dd/MM HH:mm")}</span>}
            {story.delete_status === "deleted" && <span className="text-xs text-[#94A3B8]">removido do Instagram</span>}
          </div>
          <p className="mt-1 truncate text-base text-[#F8FAFC]">{story.caption || "Sem legenda"}</p>
          {story.last_error && <p className="mt-1 rounded bg-[#221318] px-2 py-1 text-xs text-[#F87171]" data-testid={`story-error-${story.id}`}>{story.last_error}</p>}
          {story.delete_error && (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded bg-[#221318] px-2 py-1 text-xs text-[#F87171]">
              <span>Falha na exclusão: {story.delete_error}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => storyAction.mutate({ id: story.id, action: "retry-delete" })} disabled={storyAction.isPending} className="h-6 px-2 text-xs text-[#FBBF24] hover:bg-[#3A2520]">Tentar exclusão</Button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          { ["draft", "scheduled", "failed"].includes(story.status) && <Button size="sm" variant="outline" data-testid={`story-publish-${story.id}`} onClick={() => storyAction.mutate({ id: story.id, action: "publish" })} disabled={!connected} className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]" aria-label="Publicar agora" title="Publicar agora"><Play className="h-3.5 w-3.5" /></Button> }
          <Button size="sm" variant="outline" data-testid={`story-duplicate-${story.id}`} onClick={() => storyAction.mutate({ id: story.id, action: "duplicate" })} className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]" aria-label="Duplicar" title="Duplicar Story"><Copy className="h-3.5 w-3.5" /></Button>
          {story.status === "failed" && <Button size="sm" variant="outline" data-testid={`story-retry-${story.id}`} onClick={() => storyAction.mutate({ id: story.id, action: "retry" })} className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]" aria-label="Tentar novamente" title="Tentar novamente"><RotateCcw className="h-3.5 w-3.5" /></Button>}
          <Button size="sm" variant="outline" onClick={() => openDeleteEditor(story)} className="border-[#282E40] text-[#CBD5E1] hover:bg-[#202534]" aria-label="Editar exclusão" title={story.delete_at ? "Editar horário de exclusão" : "Definir horário de exclusão"}><Pencil className="h-3.5 w-3.5" /></Button>
          {["draft", "scheduled"].includes(story.status) && <Button size="sm" variant="outline" data-testid={`story-cancel-${story.id}`} onClick={() => { if (window.confirm("Cancelar este agendamento?")) storyAction.mutate({ id: story.id, action: "cancel" }); }} disabled={storyAction.isPending} className="border-[#6B5360] text-[#FBBF24] hover:bg-[#2A2024]" aria-label="Cancelar agendamento" title="Cancelar agendamento"><XCircle className="mr-1.5 h-3.5 w-3.5" />Cancelar</Button>}
          <Button size="sm" variant="outline" data-testid={`story-delete-${story.id}`} onClick={() => { if (window.confirm("Excluir este agendamento/story permanentemente?")) storyAction.mutate({ id: story.id, action: "delete" }); }} disabled={storyAction.isPending} className="border-[#282E40] text-[#F87171] hover:bg-[#221318]" aria-label="Excluir story" title="Excluir story"><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    );
  }

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
        <Card className="flex flex-col border-[#282E40] bg-[#181C26] lg:col-span-4 lg:max-h-[760px]" data-testid="story-library-card">
          <div className="flex shrink-0 items-center justify-between p-5 pb-3">
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
          <div className="flex shrink-0 items-center justify-between px-5 pb-3 text-xs">
            <span className="text-[#94A3B8]">{selectedMediaItems.length > 0 ? `${selectedMediaItems.length} mídia${selectedMediaItems.length === 1 ? "" : "s"} selecionada${selectedMediaItems.length === 1 ? "" : "s"}` : "Selecione várias para uma sequência"}</span>
            {selectedMediaItems.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedMediaIds([])} className="h-7 px-2 text-xs text-[#E9D2A8]">Limpar seleção</Button>}
          </div>
          <div className="stories-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <div className="grid grid-cols-3 gap-2">
            {media.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "group relative aspect-[9/16] overflow-hidden rounded-lg border-2 transition-colors",
                  selectedMediaIds.includes(item.id) ? "border-[#C5A46D]" : activeMedia?.id === item.id ? "border-[#C5A46D]/60" : "border-transparent hover:border-[#C5A46D]/40"
                )}
              >
                <button type="button" data-testid={`media-item-${item.id}`} onClick={() => setSelectedMedia(item)} aria-label={`Selecionar ${item.name}`} className="h-full w-full">
                  {item.media_type === "image" ? (
                    <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
                  ) : (
                    <video src={item.url} className="h-full w-full object-cover" muted />
                  )}
                </button>
                <label className="absolute left-1 top-1 rounded-md bg-black/75 p-1.5 text-white shadow-sm" title="Selecionar para sequência">
                  <input type="checkbox" checked={selectedMediaIds.includes(item.id)} onChange={(event) => setSelectedMediaIds((current) => event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))} aria-label={`Incluir ${item.name} na sequência`} className="h-4 w-4 accent-[#C5A46D]" />
                </label>
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
              <Label htmlFor="story-when" className="text-[#94A3B8]">Data inicial</Label>
              <Input
                id="story-when"
                type="date"
                value={scheduleAt.slice(0, 10)}
                onChange={(e) => {
                  const firstTime = slots[0]?.publishTime || scheduleAt.slice(11, 16) || "08:00";
                  const nextSchedule = e.target.value ? `${e.target.value}T${firstTime}` : "";
                  setScheduleAt(nextSchedule);
                  if (repeatEnabled && repeatDays.length === 0 && e.target.value) setRepeatDays([new Date(`${e.target.value}T12:00:00`).getDay()]);
                }}
                data-testid="story-datetime-input"
                className="border-[#282E40] bg-[#10131B] text-[#F8FAFC]"
              />
              <p className="text-xs text-[#64748B]">Escolha apenas a data. O horário da publicação é definido em “Publicar 1”.</p>
            </div>
            <div className="space-y-2 rounded-lg border border-[#282E40] bg-[#10131B] p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Horários do dia</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSlots((current) => [...current, { publishTime: "", deleteTime: "" }])} className="h-7 px-2 text-xs text-[#E9D2A8]">+ Adicionar horário</Button>
              </div>
              <div className="space-y-2">
                {slots.map((slot, index) => (
                  <div key={`${index}-${slot.publishTime}`} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] text-[#94A3B8]">Publicar {index + 1}</label>
                      <Input type="time" value={slot.publishTime} onChange={(event) => setSlots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, publishTime: event.target.value } : item))} data-testid={`story-slot-publish-${index}`} className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-[#94A3B8]">Excluir em</label>
                      <Input type="time" value={slot.deleteTime} onChange={(event) => setSlots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, deleteTime: event.target.value } : item))} data-testid={`story-slot-delete-${index}`} className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]" />
                    </div>
                    <Button type="button" size="icon" variant="ghost" disabled={slots.length === 1} onClick={() => setSlots((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="h-9 w-8 text-[#F87171]" aria-label={`Remover horário ${index + 1}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-[#64748B]">Exemplo: publicar às 08:00 e excluir às 11:30. Se a exclusão ficar vazia, o Story expira normalmente.</p>
            </div>
            <div className="rounded-lg border border-[#282E40] bg-[#10131B] p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[#F8FAFC]">
                <input
                  type="checkbox"
                  checked={repeatEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setRepeatEnabled(enabled);
                    if (enabled && repeatDays.length === 0 && scheduleAt) setRepeatDays([new Date(scheduleAt).getDay()]);
                    if (!enabled) { setRepeatEndDate(""); setRepeatDays([]); }
                  }}
                  data-testid="story-repeat-toggle"
                  className="h-4 w-4 accent-[#C5A46D]"
                />
                <span>Repetir este Story</span>
              </label>
              {repeatEnabled && (
                <div className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="story-repeat-until" className="text-xs text-[#94A3B8]">Repetir até</Label>
                    <Input
                      id="story-repeat-until"
                      type="date"
                      value={repeatEndDate}
                      onChange={(event) => setRepeatEndDate(event.target.value)}
                      min={scheduleAt ? scheduleAt.slice(0, 10) : undefined}
                      data-testid="story-repeat-end-date"
                      className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs text-[#94A3B8]">Dias da semana</span>
                    <div className="flex flex-wrap gap-1.5">
                      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((label, day) => {
                        const selected = repeatDays.includes(day);
                        return <button key={label} type="button" onClick={() => setRepeatDays((current) => selected ? current.filter((item) => item !== day) : [...current, day].sort())} className={cn("rounded-md border px-2 py-1 text-xs transition-colors", selected ? "border-[#C5A46D] bg-[#2A2317] text-[#E9D2A8]" : "border-[#282E40] text-[#94A3B8] hover:border-[#C5A46D]/60")} aria-pressed={selected}>{label}</button>;
                      })}
                    </div>
                  </div>
                  <p className="text-xs text-[#64748B]">Mesmo horário do primeiro agendamento. Serão criadas até 366 ocorrências.</p>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                data-testid="story-schedule-submit"
                disabled={!activeMedia || scheduleMutation.isPending || !scheduleAt || !slots.some((slot) => slot.publishTime) || (repeatEnabled && (!repeatEndDate || repeatDays.length === 0 || repeatOccurrences().length === 0))}
                onClick={() => scheduleMutation.mutate(false)}
                className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"
              >
                <CalendarClock className="h-4 w-4" /> Agendar Story
              </Button>
              {selectedMediaItems.length > 1 && (
                <Button
                  data-testid="story-sequence-submit"
                  variant="outline"
                  disabled={sequenceScheduleMutation.isPending || scheduleMutation.isPending || !scheduleAt || !slots.some((slot) => slot.publishTime) || (repeatEnabled && (!repeatEndDate || repeatDays.length === 0 || repeatOccurrences().length === 0))}
                  onClick={() => sequenceScheduleMutation.mutate(false)}
                  className="border-[#C5A46D] text-[#E9D2A8] hover:bg-[#2A2317]"
                >
                  <CalendarClock className="h-4 w-4" /> Agendar sequência ({selectedMediaItems.length})
                </Button>
              )}
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
      <Card className="min-h-[440px] border-[#282E40] bg-[#181C26]" data-testid="story-calendar-card">
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
                    "min-h-32 rounded-lg border p-2 text-left transition-colors",
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
                    "min-h-28 rounded-lg border p-2 text-left transition-colors",
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
            <div className="mb-4 rounded-xl border border-[#282E40] bg-[#10131B] p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#F8FAFC]">Gerenciar agendamentos</p>
                  <p className="text-xs text-[#94A3B8]">Selecione vários Stories para cancelar ou excluir de uma vez.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Buscar legenda ou data" aria-label="Buscar agendamentos" className="h-8 w-44 border-[#282E40] bg-[#181C26] text-xs text-[#F8FAFC]" />
                  {(["all", "scheduled", "published", "canceled", "failed"] as const).map((filter) => (
                    <Button key={filter} type="button" size="sm" variant={historyFilter === filter ? "secondary" : "ghost"} onClick={() => setHistoryFilter(filter)} className="h-8 px-2 text-xs">
                      {{ all: "Todos", scheduled: "Agendados", published: "Publicados", canceled: "Cancelados", failed: "Falhos" }[filter]}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#282E40] pt-3">
                <label className="flex items-center gap-2 text-xs text-[#CBD5E1]">
                  <input type="checkbox" checked={allSelectableSelected} onChange={(event) => setSelectedStoryIds(event.target.checked ? selectableHistoryStories.map((story) => story.id) : [])} className="h-4 w-4 accent-[#C5A46D]" aria-label="Selecionar todos os agendamentos visíveis" />
                  Selecionar agendados visíveis ({selectableHistoryStories.length})
                </label>
                <span className="text-xs text-[#64748B]">{selectedStoryIds.length} selecionado(s)</span>
                <div className="ml-auto flex gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={selectedCancelable.length === 0 || bulkStoryAction.isPending} onClick={() => { if (window.confirm(`Cancelar ${selectedCancelable.length} agendamento(s)?`)) bulkStoryAction.mutate({ ids: selectedCancelable.map((story) => story.id), action: "cancel" }); }} className="h-8 border-[#6B5360] px-2 text-xs text-[#FBBF24] hover:bg-[#2A2024]">Cancelar selecionados</Button>
                  <Button type="button" size="sm" variant="outline" disabled={selectedStories.length === 0 || bulkStoryAction.isPending} onClick={() => { if (window.confirm(`Excluir ${selectedStories.length} Story(s) permanentemente?`)) bulkStoryAction.mutate({ ids: selectedStories.map((story) => story.id), action: "delete" }); }} className="h-8 border-[#6B5360] px-2 text-xs text-[#F87171] hover:bg-[#221318]">Excluir selecionados</Button>
                </div>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#282E40] bg-[#10131B] px-3 py-2">
              <span className="text-xs text-[#94A3B8]">{filteredHistoryStories.length} registro{filteredHistoryStories.length === 1 ? "" : "s"} encontrado{filteredHistoryStories.length === 1 ? "" : "s"}</span>
              <div className="flex items-center gap-1 rounded-md border border-[#282E40] bg-[#181C26] p-1" aria-label="Modo de visualização do histórico">
                <Button type="button" size="sm" variant={historyView === "grouped" ? "secondary" : "ghost"} onClick={() => setHistoryView("grouped")} className="h-7 px-2 text-xs" data-testid="history-grouped-view">Por mês</Button>
                <Button type="button" size="sm" variant={historyView === "list" ? "secondary" : "ghost"} onClick={() => setHistoryView("list")} className="h-7 px-2 text-xs" data-testid="history-list-view">Lista</Button>
              </div>
            </div>
            <div className="stories-scrollbar max-h-[620px] space-y-3 overflow-y-auto pr-1">
              {historyView === "grouped" && historyGroupEntries.map(([month, groupStories]) => {
                const monthLabel = format(parseISO(`${month}-01`), "MMMM 'de' yyyy", { locale: ptBR });
                const groupSelectable = groupStories.filter((story) => ["draft", "scheduled"].includes(story.status));
                const groupSelected = groupSelectable.length > 0 && groupSelectable.every((story) => selectedStoryIds.includes(story.id));
                return (
                  <details key={month} open={historyGroupEntries[0]?.[0] === month} className="rounded-xl border border-[#282E40] bg-[#10131B]">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
                      <span className="flex items-center gap-2 text-sm font-semibold capitalize text-[#F8FAFC]"><span className="text-[#C5A46D]">▾</span>{monthLabel}<span className="text-xs font-normal text-[#64748B]">{groupStories.length} story{groupStories.length === 1 ? "" : "s"}</span></span>
                      {groupSelectable.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={(event) => { event.preventDefault(); toggleGroupSelection(groupStories); }} className="h-7 px-2 text-xs text-[#E9D2A8]">{groupSelected ? "Desmarcar mês" : "Selecionar mês"}</Button>}
                    </summary>
                    <div className="space-y-3 border-t border-[#282E40] p-3">{groupStories.map(renderHistoryRow)}</div>
                  </details>
                );
              })}
              {historyView === "list" && visibleHistoryStories.map((story) => (
                <div key={story.id} data-testid={`story-row-${story.id}`} className="flex flex-col gap-4 rounded-xl border border-[#282E40] bg-[#10131B] p-5 sm:flex-row sm:items-center">
                  <input type="checkbox" checked={selectedStoryIds.includes(story.id)} onChange={(event) => setSelectedStoryIds((current) => event.target.checked ? [...new Set([...current, story.id])] : current.filter((id) => id !== story.id))} aria-label={`Selecionar Story de ${format(parseISO(story.schedule_at), "dd/MM HH:mm")}`} className="h-4 w-4 shrink-0 accent-[#C5A46D]" />
                  <button type="button" onClick={() => setPreviewStory(story)} className="relative h-24 w-14 shrink-0 overflow-hidden rounded-lg bg-[#202534]" aria-label="Abrir pré-visualização do story">
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
                      <span className="text-sm text-[#94A3B8]" data-testid={`story-when-${story.id}`}>
                        {format(parseISO(story.schedule_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                      </span>
                      {story.attempts > 0 && (
                        <span className="text-xs text-[#FBBF24]">{story.attempts} tentativa{story.attempts > 1 ? "s" : ""}</span>
                      )}
                      {story.delete_status === "scheduled" && story.delete_at && <span className="text-xs text-[#FBBF24]">exclusão {format(parseISO(story.delete_at), "dd/MM HH:mm")}</span>}
                      {story.delete_status === "deleted" && <span className="text-xs text-[#94A3B8]">removido do Instagram</span>}
                    </div>
                    <p className="mt-1 truncate text-base text-[#F8FAFC]">{story.caption || "Sem legenda"}</p>
                    {story.last_error && (
                      <p className="mt-1 rounded bg-[#221318] px-2 py-1 text-xs text-[#F87171]" data-testid={`story-error-${story.id}`}>
                        {story.last_error}
                      </p>
                    )}
                    {story.delete_error && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 rounded bg-[#221318] px-2 py-1 text-xs text-[#F87171]">
                        <span>Falha na exclusão: {story.delete_error}</span>
                        <Button type="button" size="sm" variant="ghost" onClick={() => storyAction.mutate({ id: story.id, action: "retry-delete" })} disabled={storyAction.isPending} className="h-6 px-2 text-xs text-[#FBBF24] hover:bg-[#3A2520]">Tentar exclusão</Button>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {["draft", "scheduled", "failed"].includes(story.status) && (
                      <Button size="sm" variant="outline" data-testid={`story-publish-${story.id}`} onClick={() => storyAction.mutate({ id: story.id, action: "publish" })} disabled={!connected} className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]" aria-label="Publicar agora" title="Publicar agora">
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="outline" data-testid={`story-duplicate-${story.id}`} onClick={() => storyAction.mutate({ id: story.id, action: "duplicate" })} className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]" aria-label="Duplicar" title="Duplicar Story">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    {story.status === "failed" && (
                      <Button size="sm" variant="outline" data-testid={`story-retry-${story.id}`} onClick={() => storyAction.mutate({ id: story.id, action: "retry" })} className="border-[#282E40] text-[#F8FAFC] hover:bg-[#202534]" aria-label="Tentar novamente" title="Tentar novamente">
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openDeleteEditor(story)} className="border-[#282E40] text-[#CBD5E1] hover:bg-[#202534]" aria-label="Editar exclusão" title={story.delete_at ? "Editar horário de exclusão" : "Definir horário de exclusão"}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
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
              {filteredHistoryStories.length > visibleHistoryStories.length && (
                <Button type="button" variant="outline" onClick={() => setHistoryVisibleLimit((limit) => limit + 100)} className="w-full border-[#282E40] text-[#E9D2A8]">
                  Carregar mais ({filteredHistoryStories.length - visibleHistoryStories.length} restantes)
                </Button>
              )}
              {filteredHistoryStories.length === 0 && <p className="py-8 text-center text-sm text-[#94A3B8]">Nenhum Story encontrado com esses filtros.</p>}
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

      <Dialog open={!!deleteEditStory} onOpenChange={(open) => { if (!open) { setDeleteEditStory(null); setDeleteEditAt(""); } }}>
        <DialogContent className="border-[#2E364D] bg-[#1E2330]" data-testid="story-delete-editor-dialog">
          <DialogHeader>
            <DialogTitle className="text-[#F8FAFC]">Editar exclusão automática</DialogTitle>
            <DialogDescription className="text-[#94A3B8]">
              {deleteEditStory?.caption || "Sem legenda"}. Deixe vazio para remover a exclusão programada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="story-delete-editor-at" className="text-[#94A3B8]">Excluir em</Label>
            <Input id="story-delete-editor-at" type="datetime-local" value={deleteEditAt} onChange={(event) => setDeleteEditAt(event.target.value)} className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { setDeleteEditStory(null); setDeleteEditAt(""); }}>Cancelar</Button>
            <Button type="button" variant="outline" onClick={() => deleteScheduleMutation.mutate({ id: deleteEditStory!.id, deleteAt: null })} disabled={deleteScheduleMutation.isPending || !deleteEditStory?.delete_at} className="border-[#6B5360] text-[#F87171]">Remover exclusão</Button>
            <Button type="button" onClick={() => deleteScheduleMutation.mutate({ id: deleteEditStory!.id, deleteAt: deleteEditAt ? new Date(deleteEditAt).toISOString() : null })} disabled={deleteScheduleMutation.isPending || !deleteEditStory || !deleteEditAt} className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]">Salvar horário</Button>
          </DialogFooter>
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

