import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CheckCircle2,
  CircleAlert,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { companyKey, useCompanies } from "@/lib/company-context";
import type { ConnectionState, ConnectionStatus, PendingOut } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  CONNECTION_STATE_META,
  ConnectDialog,
  ConnectionBadge,
  ConnectionErrorPanel,
  SCOPE_LABELS,
  SourceBadge,
} from "@/components/connection-bits";

const ALL_STATES: ConnectionState[] = [
  "not_connected",
  "awaiting_auth",
  "connecting",
  "connected",
  "partially_connected",
  "insufficient_permissions",
  "session_expired",
  "connection_error",
];

function actionButton(state: ConnectionState): { label: string; testid: string } | null {
  switch (state) {
    case "not_connected":
      return { label: "Conectar Instagram", testid: "connection-action-connect" };
    case "awaiting_auth":
      return { label: "Continuar no Meta", testid: "connection-action-continue" };
    case "connecting":
      return null;
    case "connected":
      return { label: "Verificar conexão", testid: "connection-action-verify" };
    case "partially_connected":
      return { label: "Concluir Permissões", testid: "connection-action-complete" };
    case "insufficient_permissions":
      return { label: "Revisar Permissões", testid: "connection-action-review" };
    case "session_expired":
      return { label: "Reconectar Conta", testid: "connection-action-reconnect" };
    case "connection_error":
      return { label: "Diagnosticar e Tentar Novamente", testid: "connection-action-diagnose" };
  }
}

export default function ConnectionPage() {
  const queryClient = useQueryClient();
  const { activeCompany } = useCompanies();
  const companyId = activeCompany?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingId, setPendingId] = useState("");

  const { data: status, isLoading } = useQuery({
    queryKey: companyKey(companyId, "connection"),
    queryFn: () => apiGet<ConnectionStatus>(`/companies/${companyId}/connection`),
    enabled: !!companyId,
  });

  useEffect(() => {
    const connect = searchParams.get("connect");
    const pick = searchParams.get("pick");
    if (connect === "1") setDialogOpen(true);
    else if (connect === "connected") toast.success("Instagram conectado com sucesso!");
    else if (connect === "partially_connected") toast.warning("Conectado parcialmente — veja as permissões ausentes.");
    else if (connect === "insufficient_permissions") toast.error("Autorização sem permissões funcionais.");
    else if (connect === "connection_error") toast.error("A conexão falhou — veja o diagnóstico abaixo.");
    if (pick) setPendingId(pick);
    if (connect || pick) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const { data: pending } = useQuery({
    queryKey: companyKey(companyId, "pending", pendingId),
    queryFn: () => apiGet<PendingOut>(`/companies/${companyId}/connection/connect/pending/${pendingId}`),
    enabled: !!companyId && !!pendingId,
    retry: false,
  });

  const selectMutation = useMutation({
    mutationFn: (pageId: string) =>
      apiPost<ConnectionStatus>(`/companies/${companyId}/connection/connect/select`, { pending_id: pendingId, page_id: pageId }),
    onSuccess: (data) => {
      setPendingId("");
      queryClient.invalidateQueries({ queryKey: companyKey(companyId, "connection") });
      toast.success(`Conta conectada: ${CONNECTION_STATE_META[data.connection?.state ?? "not_connected"].label}`);
    },
    onError: (error) => {
      const detail = error instanceof ApiError ? (error.body as { detail?: string } | null)?.detail : undefined;
      toast.error(detail ?? "Não foi possível concluir a seleção.");
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "connection") });
  }

  function errorToast(error: unknown) {
    const detail = error instanceof ApiError ? (error.body as { detail?: string } | null)?.detail : undefined;
    if (typeof detail === "string") {
      toast.error(detail);
    } else {
      toast.error("Não foi possível concluir a operação.");
    }
  }

  const verifyMutation = useMutation({
    mutationFn: () => apiPost<ConnectionStatus>(`/companies/${companyId}/connection/verify`),
    onSuccess: (data) => {
      invalidate();
      toast.success(`Conexão verificada: ${CONNECTION_STATE_META[data.connection?.state ?? "not_connected"].label}`);
    },
    onError: errorToast,
  });
  const syncMutation = useMutation({
    mutationFn: () => apiPost<ConnectionStatus>(`/companies/${companyId}/connection/sync`),
    onSuccess: () => {
      invalidate();
      toast.success("Sincronização concluída.");
    },
    onError: errorToast,
  });
  const disconnectMutation = useMutation({
    mutationFn: () => apiPost<ConnectionStatus>(`/companies/${companyId}/connection/disconnect`),
    onSuccess: () => {
      invalidate();
      toast.success("Conexão removida desta empresa.");
    },
    onError: errorToast,
  });
  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-xl bg-[#181C26]" />;
  }
  if (!activeCompany) {
    return (
      <Card className="border-[#282E40] bg-[#181C26]">
        <CardContent className="p-8 text-center text-[#94A3B8]">Selecione uma empresa primeiro.</CardContent>
      </Card>
    );
  }

  const connection = status?.connection ?? null;
  const state: ConnectionState = connection?.state ?? "not_connected";
  const required = status?.required_scopes ?? [];
  const granted = connection?.granted_scopes ?? [];
  const primaryAction = actionButton(state);
  const isConnectedState = state === "connected" || state === "partially_connected";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Integração Meta</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#F8FAFC] md:text-3xl">
          Conexão Instagram — {activeCompany.name}
        </h1>
        <p className="mt-1 text-sm text-[#94A3B8]">
          Fluxo oficial Instagram API with Instagram Login. Nenhum token ou segredo trafega pelo navegador.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 md:gap-6">
        {/* State card */}
        <Card className="border-[#282E40] bg-[#181C26] lg:col-span-2" data-testid="connection-state-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">
              Status da conexão
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <ConnectionBadge state={state} testid="connection-current-state" />
              {connection && connection.source && (
                <SourceBadge source={connection.source} testid="connection-source-badge" />
              )}
            </div>
            <p className="text-sm text-[#94A3B8]">{CONNECTION_STATE_META[state].hint}</p>

            {connection?.last_error && (
              <ConnectionErrorPanel error={connection.last_error} hint={connection.error_hint} />
            )}

            {connection && connection.username && (
              <div className="grid grid-cols-1 gap-4 rounded-xl border border-[#282E40] bg-[#10131B] p-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-[#94A3B8]">Perfil</p>
                  <p className="font-medium text-[#F8FAFC]" data-testid="connection-username">@{connection.username}</p>
                </div>
                <div>
                  <p className="text-xs text-[#94A3B8]">Identificador da conta</p>
                  <p className="font-mono text-sm text-[#F8FAFC]" data-testid="connection-ig-id">{connection.ig_user_id}</p>
                </div>
                <div>
                  <p className="text-xs text-[#94A3B8]">Última sincronização</p>
                  <p className="text-sm text-[#F8FAFC]" data-testid="connection-last-sync">
                    {connection.last_synced_at
                      ? format(new Date(connection.last_synced_at), "dd 'de' MMM 'às' HH:mm", { locale: ptBR })
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#94A3B8]">Validade do token</p>
                  <p className="text-sm text-[#F8FAFC]" data-testid="connection-token-expiry">
                    {connection.token_expires_at
                      ? format(new Date(connection.token_expires_at), "dd 'de' MMM 'de' yyyy", { locale: ptBR })
                      : "sem expiração registrada"}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {primaryAction && (
                <Button
                  data-testid={primaryAction.testid}
                  onClick={() => {
                    if (state === "connected") verifyMutation.mutate();
                    else if (state === "connection_error") verifyMutation.mutate();
                    else setDialogOpen(true);
                  }}
                  className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"
                >
                  <ShieldCheck className="h-4 w-4" /> {primaryAction.label}
                </Button>
              )}
              {isConnectedState && (
                <>
                  <Button
                    data-testid="connection-action-sync"
                    variant="outline"
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending}
                    className="border-[#282E40] bg-[#10131B] text-[#F8FAFC] hover:border-[#C5A46D]/40 hover:bg-[#202534]"
                  >
                    <RefreshCw className="h-4 w-4" /> Sincronizar
                  </Button>
                  <Button
                    data-testid="connection-action-verify-secondary"
                    variant="outline"
                    onClick={() => verifyMutation.mutate()}
                    disabled={verifyMutation.isPending}
                    className="border-[#282E40] bg-[#10131B] text-[#F8FAFC] hover:border-[#C5A46D]/40 hover:bg-[#202534]"
                  >
                    <RefreshCw className="h-4 w-4" /> Verificar
                  </Button>
                </>
              )}
              {connection && connection.source && (
                <Button
                  data-testid="connection-action-disconnect"
                  variant="outline"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  className="border-[#F87171]/40 bg-transparent text-[#F87171] hover:bg-[#221318]"
                >
                  <XCircle className="h-4 w-4" /> Desconectar
                </Button>
              )}
              {state === "awaiting_auth" && (
                <Button
                  data-testid="connection-action-cancel-auth"
                  variant="ghost"
                  onClick={() =>
                    apiPost(`/companies/${companyId}/connection/connect/cancel`).then(() => {
                      invalidate();
                      toast.success("Autorização cancelada.");
                    })
                  }
                  className="text-[#94A3B8]"
                >
                  Cancelar autorização
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Scopes/features card */}
        <Card className="border-[#282E40] bg-[#181C26]" data-testid="connection-scopes-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">
              Recursos habilitados
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {required.map((scope) => {
              const ok = granted.includes(scope);
              return (
                <div key={scope} className="flex items-start gap-2" data-testid={`connection-scope-${scope}`}>
                  {ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#4ADE80]" />
                  ) : (
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#94A3B8]" />
                  )}
                  <div>
                    <p className="text-sm text-[#F8FAFC]">{SCOPE_LABELS[scope] ?? scope}</p>
                    <p className="font-mono text-[10px] text-[#94A3B8]">{scope}</p>
                  </div>
                </div>
              );
            })}
            {!connection && <p className="text-sm text-[#94A3B8]">Nenhuma permissão concedida ainda.</p>}
            {connection && (
              <div className="border-t border-[#282E40] pt-3">
                <p className="text-xs text-[#94A3B8]">Webhooks</p>
                <p className="text-sm text-[#F8FAFC]" data-testid="connection-webhooks">
                  comentários: {connection.webhooks?.comments ? "assinado" : "não assinado"} · mensagens:{" "}
                  {connection.webhooks?.messages ? "assinado" : "não assinado"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Legend */}
      <Card className="border-[#282E40] bg-[#181C26]" data-testid="connection-legend">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">
            Estados possíveis da conexão
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {ALL_STATES.map((s) => (
            <ConnectionBadge key={s} state={s} testid={`connection-legend-${s}`} />
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!pendingId} onOpenChange={(open) => !open && setPendingId("")}>
        <DialogContent role="dialog" data-testid="pick-account-dialog" className="max-h-[92svh] overflow-y-auto border-[#2E364D] bg-[#1E2330]">
          <DialogHeader>
            <DialogTitle className="text-[#F8FAFC]">Escolha a conta do Instagram</DialogTitle>
            <DialogDescription className="text-[#94A3B8]">
              Você administra várias Páginas com Instagram profissional vinculado. Selecione a de {activeCompany.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(pending?.accounts ?? []).map((acc) => (
              <button
                key={acc.page_id}
                type="button"
                data-testid={`pick-account-${acc.page_id}`}
                disabled={selectMutation.isPending}
                onClick={() => selectMutation.mutate(acc.page_id)}
                className="flex w-full items-center gap-3 rounded-lg border border-[#282E40] bg-[#181C26] p-3 text-left transition-colors hover:border-[#C5A46D]/60"
              >
                {acc.profile_pic ? (
                  <img src={acc.profile_pic} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#202534] text-xs font-bold text-[#C5A46D]">
                    {(acc.username || acc.page_name).slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[#F8FAFC]">@{acc.username || acc.ig_user_id}</span>
                  <span className="block truncate text-xs text-[#94A3B8]">Página: {acc.page_name}</span>
                </span>
              </button>
            ))}
            {!pending && <p className="text-sm text-[#94A3B8]">Carregando contas…</p>}
          </div>
        </DialogContent>
      </Dialog>

      <ConnectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={activeCompany.id}
        companyName={activeCompany.name}
        status={status}
        onConnected={() => invalidate()}
      />

      <p className="flex items-center gap-2 text-xs text-[#94A3B8]">
        <RotateCcw className="h-3 w-3" />
        Renovação de credenciais: tokens de longa duração do Instagram duram ~60 dias; a plataforma
        monitora a validade e avisa quando uma nova autorização for necessária.
      </p>
    </div>
  );
}
