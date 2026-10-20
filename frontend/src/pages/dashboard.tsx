import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Instagram,
  MessageCircle,
  MessageSquare,
  Plus,
  Users,
  Workflow,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { companyKey, useCompanies } from "@/lib/company-context";
import type { AutomationRun, ConnectionStatus, ReportSummary, Task } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConnectionBadge, LockBanner } from "@/components/connection-bits";

function MetricCard({ label, value, icon: Icon, testid }: { label: string; value: string | number; icon: typeof Instagram; testid: string }) {
  return (
    <Card
      data-testid={testid}
      className="border-[#282E40] bg-[#181C26] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#C5A46D]/40 hover:shadow-lg hover:shadow-black/40"
    >
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">{label}</p>
          <p className="mt-2 font-mono text-2xl font-bold text-white">{value}</p>
        </div>
        <Icon className="h-8 w-8 text-[#94A3B8]/50" />
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { activeCompany, isLoading: companiesLoading } = useCompanies();
  const companyId = activeCompany?.id;

  const { data: connStatus } = useQuery({
    queryKey: companyKey(companyId, "connection"),
    queryFn: () => apiGet<ConnectionStatus>(`/companies/${companyId}/connection`),
    enabled: !!companyId,
  });
  const { data: report } = useQuery({
    queryKey: companyKey(companyId, "reports"),
    queryFn: () => apiGet<ReportSummary>(`/companies/${companyId}/reports`),
    enabled: !!companyId,
  });
  const { data: runs } = useQuery({
    queryKey: companyKey(companyId, "runs"),
    queryFn: () => apiGet<AutomationRun[]>(`/companies/${companyId}/automation-runs`),
    enabled: !!companyId,
  });
  const { data: tasks } = useQuery({
    queryKey: companyKey(companyId, "tasks"),
    queryFn: () => apiGet<Task[]>(`/companies/${companyId}/tasks`),
    enabled: !!companyId,
  });

  if (companiesLoading) {
    return <div className="h-40 animate-pulse rounded-xl bg-[#181C26]" />;
  }

  if (!activeCompany) {
    return (
      <Card className="border-[#282E40] bg-[#181C26]">
        <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
          <Users className="h-10 w-10 text-[#C5A46D]" />
          <div>
            <p className="text-lg font-semibold text-[#F8FAFC]">Nenhuma empresa cadastrada</p>
            <p className="text-sm text-[#94A3B8]">Cadastre a primeira empresa para começar a gerenciar o Instagram dos seus clientes.</p>
          </div>
          <Link to="/companies">
            <Button data-testid="dashboard-create-company-cta" className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]">
              <Plus className="h-4 w-4" /> Cadastrar empresa
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const connection = connStatus?.connection ?? null;
  const state = connection?.state ?? "not_connected";
  const totals = report?.totals;
  const connected = state === "connected" || state === "partially_connected";

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Painel da agência</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#F8FAFC] md:text-3xl" data-testid="dashboard-title">
            {activeCompany.name}
          </h1>
          <p className="text-sm text-[#94A3B8]">{activeCompany.segment || "Sem segmento definido"}</p>
        </div>
        <Link to="/connection">
          <Button
            data-testid="dashboard-connection-button"
            variant="outline"
            className="border-[#282E40] bg-[#181C26] text-[#F8FAFC] hover:border-[#C5A46D]/40 hover:bg-[#202534]"
          >
            <Instagram className="h-4 w-4 text-[#C5A46D]" /> Central de conexão
          </Button>
        </Link>
      </div>

      {!connected && (
        <LockBanner
          testid="dashboard-lock-banner"
          onConnect={() => {
            window.location.href = "/connection?connect=1";
          }}
        />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 md:gap-6">
        <Card data-testid="dashboard-connection-card" className="border-[#282E40] bg-[#181C26] md:col-span-2 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">
              Status da conexão Instagram
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ConnectionBadge state={state} testid="dashboard-connection-state" />
            {connected && connection ? (
              <p className="text-sm text-[#94A3B8]" data-testid="dashboard-connection-account">
                @{connection.username} · conta {connection.account_type.toLowerCase()} · módulos:{" "}
                {connection.enabled_features.length ? connection.enabled_features.join(", ") : "nenhum"}
              </p>
            ) : (
              <p className="text-sm text-[#94A3B8]">Conecte a conta para habilitar publicação, Direct e comentários.</p>
            )}
          </CardContent>
        </Card>
        <MetricCard label="Stories publicados" value={totals?.stories_published ?? "—"} icon={CheckCircle2} testid="metric-stories-published" />
        <MetricCard label="Stories agendados" value={totals?.stories_scheduled ?? "—"} icon={CalendarClock} testid="metric-stories-scheduled" />
        <MetricCard label="Comentários recebidos" value={totals?.comments_received ?? "—"} icon={MessageSquare} testid="metric-comments-received" />
        <MetricCard label="Mensagens recebidas" value={totals?.messages_received ?? "—"} icon={MessageCircle} testid="metric-messages-received" />
        <MetricCard label="Tempo médio de resposta" value={totals ? `${totals.avg_response_minutes} min` : "—"} icon={Clock} testid="metric-avg-response" />
        <MetricCard label="Atendimentos concluídos" value={totals?.atendimentos_concluidos ?? "—"} icon={Users} testid="metric-attendances-done" />
        <MetricCard label="Automações executadas" value={totals?.automations_executed ?? "—"} icon={Zap} testid="metric-automations" />
        <MetricCard label="Falhas de publicação" value={totals?.stories_failed ?? "—"} icon={AlertTriangle} testid="metric-publish-failures" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 md:gap-6">
        <Card data-testid="dashboard-runs-card" className="border-[#282E40] bg-[#181C26]">
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">
              Atividade recente das automações
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(runs ?? []).slice(0, 5).map((run) => (
              <div key={run.id} className="flex items-start gap-3 rounded-lg border border-[#282E40] bg-[#10131B] p-3" data-testid="dashboard-run-item">
                <span
                  className={
                    run.result === "executed"
                      ? "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#142A20] text-[#4ADE80]"
                      : run.result === "blocked"
                        ? "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2A1D17] text-[#FBBF24]"
                        : "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#222538] text-[#818CF8]"
                  }
                >
                  {run.result === "executed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#F8FAFC]">{run.automation_name}</p>
                  <p className="truncate text-xs text-[#94A3B8]">{run.detail || run.result}</p>
                </div>
              </div>
            ))}
            {runs && runs.length === 0 && (
              <p className="text-sm text-[#94A3B8]">Nenhuma automação executada ainda.</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="dashboard-tasks-card" className="border-[#282E40] bg-[#181C26]">
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">
              Tarefas internas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(tasks ?? []).slice(0, 5).map((task) => (
              <div key={task.id} className="flex items-start gap-3 rounded-lg border border-[#282E40] bg-[#10131B] p-3" data-testid="dashboard-task-item">
                <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${task.done ? "text-[#4ADE80]" : "text-[#94A3B8]"}`} />
                <p className="text-sm text-[#F8FAFC]">{task.title}</p>
              </div>
            ))}
            {tasks && tasks.length === 0 && (
              <p className="text-sm text-[#94A3B8]">Nenhuma tarefa pendente.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
