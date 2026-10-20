import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiGet } from "@/lib/api";
import { companyKey, useCompanies } from "@/lib/company-context";
import type { ReportSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SourceBadge } from "@/components/connection-bits";

const GOLD = "#C5A46D";
const BLUE = "#818CF8";
const SLATE = "#475569";

function Metric({ label, value, testid }: { label: string; value: string | number; testid: string }) {
  return (
    <Card data-testid={testid} className="border-[#282E40] bg-[#181C26]">
      <CardContent className="p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">{label}</p>
        <p className="mt-2 font-mono text-2xl font-bold text-white">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function Reports() {
  const { activeCompany } = useCompanies();
  const companyId = activeCompany?.id;
  const { data: report } = useQuery({
    queryKey: companyKey(companyId, "reports"),
    queryFn: () => apiGet<ReportSummary>(`/companies/${companyId}/reports`),
    enabled: !!companyId,
  });

  if (!activeCompany) {
    return <div className="rounded-xl border border-[#282E40] bg-[#181C26] p-8 text-center text-[#94A3B8]">Selecione uma empresa primeiro.</div>;
  }

  const totals = report?.totals;
  const series = (report?.series ?? []).map((point) => ({
    ...point,
    label: format(parseISO(point.date), "dd/MM", { locale: ptBR }),
  }));

  function exportCsv() {
    if (!activeCompany || !report) return;
    const rows = [
      ["Relatório", activeCompany.name],
      ["Gerado em", report.generated_at],
      [],
      ["Métrica", "Valor"],
      ["Stories publicados", report.totals.stories_published],
      ["Stories agendados", report.totals.stories_scheduled],
      ["Falhas de publicação", report.totals.stories_failed],
      ["Comentários recebidos", report.totals.comments_received],
      ["Mensagens recebidas", report.totals.messages_received],
      ["Tempo médio de resposta (min)", report.totals.avg_response_minutes],
      ["Atendimentos concluídos", report.totals.atendimentos_concluidos],
      ["Automações executadas", report.totals.automations_executed],
      [],
      ["Data", "Stories publicados", "Comentários", "Mensagens"],
      ...report.series.map((p) => [p.date, p.stories_published, p.comments, p.messages]),
    ];
    const csv = rows.map((row) => row.join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-${activeCompany.name.toLowerCase().replace(/\s+/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Resultados</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#F8FAFC] md:text-3xl">Relatórios — {activeCompany.name}</h1>
          <div className="mt-2 flex items-center gap-2">
            {report && <SourceBadge source={report.demo_mode ? "demo" : "real"} testid="reports-source-badge" />}
            <span className="text-xs text-[#94A3B8]">
              {report?.demo_mode
                ? "Conecte e autorize a conta Meta para começar a receber indicadores oficiais."
                : "Indicadores calculados a partir dos dados sincronizados pela integração Meta."}
            </span>
          </div>
        </div>
        <Button
          data-testid="reports-export-csv"
          variant="outline"
          onClick={exportCsv}
          className="border-[#282E40] bg-[#181C26] text-[#F8FAFC] hover:bg-[#202534]"
        >
          <Download className="h-4 w-4" /> Exportar CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 md:gap-6">
        <Metric label="Publicações realizadas" value={totals?.stories_published ?? "—"} testid="report-metric-published" />
        <Metric label="Stories agendados" value={totals?.stories_scheduled ?? "—"} testid="report-metric-scheduled" />
        <Metric label="Falhas de publicação" value={totals?.stories_failed ?? "—"} testid="report-metric-failures" />
        <Metric label="Comentários recebidos" value={totals?.comments_received ?? "—"} testid="report-metric-comments" />
        <Metric label="Mensagens recebidas" value={totals?.messages_received ?? "—"} testid="report-metric-messages" />
        <Metric label="Tempo médio de resposta" value={totals ? `${totals.avg_response_minutes} min` : "—"} testid="report-metric-response" />
        <Metric label="Atendimentos concluídos" value={totals?.atendimentos_concluidos ?? "—"} testid="report-metric-done" />
        <Metric label="Automações executadas" value={totals?.automations_executed ?? "—"} testid="report-metric-automations" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:gap-6">
        <Card className="border-[#282E40] bg-[#181C26]" data-testid="reports-activity-chart">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">
              Atividade dos últimos 7 dias
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#282E40" />
                  <XAxis dataKey="label" stroke="#94A3B8" fontSize={11} />
                  <YAxis stroke="#94A3B8" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: "#1E2330", border: "1px solid #282E40", borderRadius: 8, color: "#F8FAFC" }} />
                  <Legend wrapperStyle={{ color: "#94A3B8" }} />
                  <Bar dataKey="stories_published" name="Stories publicados" fill={GOLD} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="comments" name="Comentários" fill={BLUE} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="messages" name="Mensagens" fill={SLATE} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
