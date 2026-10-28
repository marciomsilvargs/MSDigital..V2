import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Facebook, Instagram, XCircle } from "lucide-react";
import { apiPost, ApiError } from "@/lib/api";
import type { ConnectionStatus, ConnectionState, ConnectStartOut } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const CONNECTION_STATE_META: Record<ConnectionState, { label: string; badge: string; hint: string }> = {
  not_connected: {
    label: "Não conectado",
    badge: "bg-slate-800 text-slate-300 border-slate-700",
    hint: "Nenhuma conta do Instagram está vinculada a esta empresa.",
  },
  awaiting_auth: {
    label: "Aguardando autorização",
    badge: "bg-amber-950/60 text-amber-300 border-amber-800",
    hint: "A janela de autorização da Meta foi aberta — conclua o fluxo para continuar.",
  },
  connecting: {
    label: "Conectando…",
    badge: "bg-blue-950/60 text-blue-300 border-blue-800 animate-pulse",
    hint: "Validando a autorização junto à Meta e identificando as contas profissionais.",
  },
  connected: {
    label: "Conectado",
    badge: "bg-emerald-950/60 text-emerald-300 border-emerald-800",
    hint: "Todos os módulos autorizados estão habilitados.",
  },
  partially_connected: {
    label: "Conectado parcialmente",
    badge: "bg-yellow-950/60 text-yellow-300 border-yellow-800",
    hint: "Algumas permissões não foram concedidas — os módulos correspondentes ficam bloqueados.",
  },
  insufficient_permissions: {
    label: "Permissões insuficientes",
    badge: "bg-orange-950/60 text-orange-300 border-orange-800",
    hint: "A autorização foi concluída sem nenhuma permissão funcional.",
  },
  session_expired: {
    label: "Sessão expirada",
    badge: "bg-rose-950/60 text-rose-300 border-rose-800",
    hint: "O token de longa duração expirou — uma nova autorização é necessária.",
  },
  connection_error: {
    label: "Erro de conexão",
    badge: "bg-red-950/60 text-red-300 border-red-800",
    hint: "Algo falhou durante a conexão — veja o diagnóstico abaixo.",
  },
};

export const SCOPE_LABELS: Record<string, string> = {
  instagram_business_basic: "Identidade, perfil e mídia da conta",
  instagram_business_content_publish: "Publicar Stories no horário programado",
  instagram_business_manage_insights: "Consultar alcance e visualizações dos Stories",
  instagram_business_manage_comments: "Ler e responder comentários",
  instagram_business_manage_messages: "Ler e responder mensagens (Direct)",
  instagram_basic: "Identidade, perfil e mídia da conta",
  instagram_content_publish: "Publicar Stories no horário programado",
  instagram_manage_insights: "Consultar alcance e visualizações dos Stories",
  instagram_manage_comments: "Ler e responder comentários",
  instagram_manage_messages: "Ler e responder mensagens (Direct)",
  pages_show_list: "Listar as Páginas do Facebook que você administra",
  pages_read_engagement: "Ler a Página vinculada ao Instagram",
  pages_manage_metadata: "Assinar eventos (webhooks) da Página",
};

export function ConnectionBadge({ state, testid }: { state: ConnectionState; testid?: string }) {
  const meta = CONNECTION_STATE_META[state] ?? CONNECTION_STATE_META.not_connected;
  return (
    <Badge data-testid={testid ?? "connection-state-badge"} className={cn("rounded-full border px-3", meta.badge)}>
      {meta.label}
    </Badge>
  );
}

export function SourceBadge({ source, testid }: { source: string; testid?: string }) {
  if (source === "real") {
    return (
      <Badge data-testid={testid ?? "source-real-badge"} className="rounded-full border-[#4ADE80]/40 bg-[#142A20] text-[#86EFAC]">
        DADOS REAIS
      </Badge>
    );
  }
  return (
    <Badge data-testid={testid ?? "source-pending-badge"} className="rounded-full border-[#F59E0B]/40 bg-[#2A2317] text-[#FCD34D]">
      NÃO SINCRONIZADO
    </Badge>
  );
}

export function LockBanner({ onConnect, testid }: { onConnect: () => void; testid?: string }) {
  return (
    <div
      data-testid={testid ?? "connection-lock-banner"}
      className="flex flex-col items-start justify-between gap-3 rounded-xl border border-[#C5A46D]/40 bg-[#181C26] p-5 sm:flex-row sm:items-center"
    >
      <div className="max-w-xl">
        <p className="font-semibold text-[#F8FAFC]">
          Conecte o Instagram desta empresa para habilitar as funcionalidades.
        </p>
        <p className="mt-1 text-sm text-[#94A3B8]">
          Publicação, agendamento real, Direct, respostas a comentários e automações ficam bloqueados até a
          conexão ser autorizada. Rascunhos continuam disponíveis.
        </p>
      </div>
      <Button
        data-testid="lock-banner-connect-button"
        onClick={onConnect}
        className="shrink-0 bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"
      >
        Conectar agora
      </Button>
    </div>
  );
}

interface ConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  companyName: string;
  status: ConnectionStatus | undefined;
  onConnected: () => void;
}

export function ConnectDialog({ open, onOpenChange, companyId, companyName, status }: ConnectDialogProps) {
  const startMutation = useMutation({
    mutationFn: (flow: "instagram_login" | "facebook_login") =>
      apiPost<ConnectStartOut>(`/companies/${companyId}/connection/connect/start`, { flow }),
  });

  function handleRealConnect(flow: "instagram_login" | "facebook_login") {
    startMutation.mutate(flow, {
      onSuccess: (data) => {
        // The backend returns the official Meta authorization URL (secret never leaves the server).
        if (data.authorization_url) {
          window.location.assign(data.authorization_url);
          return;
        }
        toast.error("Não foi possível iniciar o fluxo OAuth da Meta.");
      },
      onError: (error) => {
        const detail = error instanceof ApiError ? (error.body as { detail?: string } | null)?.detail : undefined;
        toast.error(detail ?? "Não foi possível iniciar a conexão.");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        role="dialog"
        data-testid="connect-dialog"
        className="max-h-[92svh] max-w-lg overflow-y-auto border-[#2E364D] bg-[#1E2330] p-0"
      >
        <>
            <DialogHeader className="px-6 pb-4 pt-6">
              <DialogTitle className="text-[#F8FAFC]">Conectar o Instagram de {companyName}</DialogTitle>
              <DialogDescription className="mt-2 text-sm text-[#94A3B8]">
                Escolha como autorizar. Você será levado à janela oficial da Meta — nenhum token ou
                segredo trafega pelo navegador.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 px-6">
              <button
                type="button"
                data-testid="connect-dialog-continue-facebook"
                disabled={startMutation.isPending || !status?.facebook_login_available}
                onClick={() => handleRealConnect("facebook_login")}
                className="w-full rounded-xl border border-[#282E40] bg-[#181C26] p-4 text-left transition-colors hover:border-[#1877F2]/60 disabled:opacity-50"
              >
                <span className="flex items-center gap-2 font-semibold text-[#F8FAFC]">
                  <Facebook className="h-4 w-4 text-[#1877F2]" /> Continuar com Facebook
                </span>
                <span className="mt-1 block text-xs text-[#94A3B8]">
                  Para quem administra a Página do Facebook da empresa. A conta profissional do Instagram
                  precisa estar vinculada à Página.
                </span>
              </button>
              <button
                type="button"
                data-testid="connect-dialog-continue-instagram"
                disabled={startMutation.isPending || !status?.instagram_login_available}
                onClick={() => handleRealConnect("instagram_login")}
                className="w-full rounded-xl border border-[#282E40] bg-[#181C26] p-4 text-left transition-colors hover:border-[#C5A46D]/60 disabled:opacity-50"
              >
                <span className="flex items-center gap-2 font-semibold text-[#F8FAFC]">
                  <Instagram className="h-4 w-4 text-[#C5A46D]" /> Continuar com Instagram
                </span>
                <span className="mt-1 block text-xs text-[#94A3B8]">
                  {status?.instagram_login_available
                    ? "Entre direto com a conta profissional do Instagram."
                    : "Indisponível: falta configurar o ID do app do Instagram no servidor."}
                </span>
              </button>
            </div>
            <div className="flex justify-end gap-3 px-6 py-5">
              <Button variant="ghost" data-testid="connect-dialog-cancel-real" onClick={() => onOpenChange(false)}>Cancelar</Button>
            </div>
          </>
      </DialogContent>
    </Dialog>
  );
}

export function ConnectionErrorPanel({ error, hint }: { error: string; hint: string | null }) {
  return (
    <div data-testid="connection-error-panel" className="rounded-xl border border-[#F87171]/30 bg-[#221318] p-5">
      <p className="flex items-center gap-2 font-semibold text-[#F87171]">
        <XCircle className="h-4 w-4" /> Diagnóstico do erro
      </p>
      <p className="mt-2 text-sm text-[#F8FAFC]">{error}</p>
      {hint && <p className="mt-1 text-sm text-[#94A3B8]">{hint}</p>}
    </div>
  );
}

