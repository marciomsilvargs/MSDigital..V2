import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle2, Circle, Plus, Save, Trash2, Workflow, Zap } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { companyKey, useCompanies } from "@/lib/company-context";
import type { Automation, AutomationRun, FlowNodeData, Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LockBanner } from "@/components/connection-bits";

type MSNode = Node<FlowNodeData>;

const SUBTYPE_OPTIONS = {
  trigger: [
    { value: "comment_received", label: "Comentário em post" },
    { value: "message_received", label: "Mensagem recebida" },
  ],
  condition: [
    { value: "keyword", label: "Palavra-chave" },
    { value: "business_hours", label: "Horário comercial" },
    { value: "has_tag", label: "Etiqueta da conversa" },
  ],
  action: [
    { value: "reply_comment", label: "Responder comentário" },
    { value: "send_message", label: "Enviar mensagem autorizada" },
    { value: "apply_tag", label: "Aplicar etiqueta" },
    { value: "create_task", label: "Criar tarefa" },
    { value: "assign", label: "Atribuir atendente" },
    { value: "end", label: "Encerrar automação" },
  ],
} as const;

function NodeCard({ data, accent, kindLabel, testid }: { data: FlowNodeData; accent: string; kindLabel: string; testid: string }) {
  return (
    <div className="w-48 rounded-xl border-2 bg-[#181C26] p-3 shadow-lg shadow-black/40" style={{ borderColor: accent }} data-testid={testid}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" style={{ background: accent }} />
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>
        {kindLabel}
      </p>
      <p className="mt-1 text-xs font-semibold text-[#F8FAFC]">{data.label}</p>
      {data.keyword && <p className="mt-1 truncate rounded bg-[#2A2317] px-1.5 py-0.5 text-[10px] text-[#E9D2A8]">“{data.keyword}”</p>}
      {data.tag && <p className="mt-1 truncate rounded bg-[#2A2317] px-1.5 py-0.5 text-[10px] text-[#E9D2A8]">etiqueta: {data.tag}</p>}
      {data.assignee && <p className="mt-1 truncate rounded bg-[#2A2317] px-1.5 py-0.5 text-[10px] text-[#E9D2A8]">atendente: {data.assignee}</p>}
      {data.text && <p className="mt-1 line-clamp-2 text-[10px] text-[#94A3B8]">{data.text}</p>}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" style={{ background: accent }} />
    </div>
  );
}

// Module-level node types — never defined inside the component (re-created per render).
function TriggerNode({ data }: NodeProps) {
  return <NodeCard data={data as FlowNodeData} accent="#C5A46D" kindLabel="Gatilho" testid="flow-node-trigger" />;
}
function ConditionNode({ data }: NodeProps) {
  return <NodeCard data={data as FlowNodeData} accent="#818CF8" kindLabel="Condição" testid="flow-node-condition" />;
}
function ActionNode({ data }: NodeProps) {
  return <NodeCard data={data as FlowNodeData} accent="#4ADE80" kindLabel="Ação" testid="flow-node-action" />;
}
const nodeTypes = { msTrigger: TriggerNode, msCondition: ConditionNode, msAction: ActionNode };

function defaultData(kind: FlowNodeData["kind"]): FlowNodeData {
  if (kind === "trigger") return { kind, subtype: "comment_received", label: "Comentário em post", keyword: "" };
  if (kind === "condition") return { kind, subtype: "keyword", label: "Palavra-chave", keyword: "" };
  return { kind, subtype: "create_task", label: "Criar tarefa", text: "Dar seguimento ao atendimento." };
}

export default function Automations() {
  const queryClient = useQueryClient();
  const { activeCompany } = useCompanies();
  const companyId = activeCompany?.id;

  const [selectedId, setSelectedId] = useState("");
  const [nodes, setNodes] = useState<MSNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const { data: automations = [] } = useQuery({
    queryKey: companyKey(companyId, "automations"),
    queryFn: () => apiGet<Automation[]>(`/companies/${companyId}/automations`),
    enabled: !!companyId,
  });
  const { data: runs = [] } = useQuery({
    queryKey: companyKey(companyId, "runs"),
    queryFn: () => apiGet<AutomationRun[]>(`/companies/${companyId}/automation-runs`),
    enabled: !!companyId,
  });
  const { data: tasks = [] } = useQuery({
    queryKey: companyKey(companyId, "tasks"),
    queryFn: () => apiGet<Task[]>(`/companies/${companyId}/tasks`),
    enabled: !!companyId,
  });
  const { data: connStatus } = useQuery({
    queryKey: companyKey(companyId, "connection"),
    queryFn: () => apiGet<import("@/lib/types").ConnectionStatus>(`/companies/${companyId}/connection`),
    enabled: !!companyId,
  });

  const automation = automations.find((a) => a.id === selectedId) ?? automations[0] ?? null;
  const connected = connStatus?.connection?.state === "connected" || connStatus?.connection?.state === "partially_connected";

  useEffect(() => {
    if (automation && automation.id !== selectedId) setSelectedId(automation.id);
  }, [automation, selectedId]);

  useEffect(() => {
    if (automation) {
      setNodes(automation.nodes.map((n) => ({ ...n, selected: false })) as MSNode[]);
      setEdges(automation.edges ?? []);
    }
    // Reload the canvas only when switching automations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automation?.id]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "automations") });
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "runs") });
    queryClient.invalidateQueries({ queryKey: companyKey(companyId, "tasks") });
  }

  function errorToast(error: unknown) {
    const detail = error instanceof ApiError ? (error.body as { detail?: string } | null)?.detail : undefined;
    if (typeof detail === "string") toast.error(detail);
    else toast.error("Operação não concluída.");
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPatch<Automation>(`/companies/${companyId}/automations/${automation!.id}`, {
        nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label })),
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Automação salva!");
    },
    onError: errorToast,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ enabled, automationId }: { enabled: boolean; automationId: string }) => apiPatch<Automation>(`/companies/${companyId}/automations/${automationId}`, { enabled }),
    onSuccess: (_data, { enabled }) => {
      invalidate();
      toast.success(enabled ? "Automação ativada!" : "Automação pausada.");
    },
    onError: errorToast,
  });

  function toggleAutomation(target: Automation, enabled: boolean) {
    if (enabled) {
      const commentTrigger = target.nodes.find((node) => {
        const data = node.data as FlowNodeData;
        return data.kind === "trigger" && data.subtype === "comment_received";
      });
      if (commentTrigger && !(commentTrigger.data as FlowNodeData).keyword?.split(",").some((word) => word.trim())) {
        toast.error("Adicione ao menos uma palavra-chave ao gatilho de comentário antes de ativar.");
        return;
      }
    }
    toggleMutation.mutate({ enabled, automationId: target.id });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<Automation>(`/companies/${companyId}/automations`, {
        name: newName,
        description: newDescription,
        enabled: false,
        nodes: [
          { id: "t1", type: "msTrigger", position: { x: 40, y: 160 }, data: { kind: "trigger", subtype: "comment_received", label: "Comentário em post", keyword: "" } },
          { id: "c1", type: "msCondition", position: { x: 340, y: 160 }, data: { kind: "condition", subtype: "keyword", label: "Palavra-chave", keyword: "" } },
          { id: "a1", type: "msAction", position: { x: 640, y: 160 }, data: { kind: "action", subtype: "reply_comment", label: "Responder comentário", text: "Olá! Obrigado pelo interesse — nossa equipe vai te chamar no direct." } },
        ],
        edges: [
          { id: "e1", source: "t1", target: "c1" },
          { id: "e2", source: "c1", target: "a1" },
        ],
      }),
    onSuccess: (created) => {
      invalidate();
      setSelectedId(created.id);
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      toast.success("Automação criada — configure os blocos e ative.");
    },
    onError: errorToast,
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDelete<void>(`/companies/${companyId}/automations/${automation!.id}`),
    onSuccess: () => {
      invalidate();
      setSelectedId("");
      toast.success("Automação excluída.");
    },
    onError: errorToast,
  });

  const taskMutation = useMutation({
    mutationFn: (task: Task) => apiPatch<Task>(`/companies/${companyId}/tasks/${task.id}`, { done: !task.done }),
    onSuccess: () => invalidate(),
    onError: errorToast,
  });

  if (!activeCompany) {
    return <div className="rounded-xl border border-[#282E40] bg-[#181C26] p-8 text-center text-[#94A3B8]">Selecione uma empresa primeiro.</div>;
  }

  const selectedNode = nodes.find((n) => n.selected) ?? null;
  const nodeData = selectedNode ? (selectedNode.data as FlowNodeData) : null;

  function updateNodeData(id: string, updates: Partial<FlowNodeData>) {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...updates } } : n)));
  }

  function keywordFields(value?: string) {
    return value === undefined || value === "" ? [""] : value.split(",").map((keyword) => keyword.trim());
  }

  function updateKeywordField(nodeId: string, index: number, value: string) {
    const fields = keywordFields((nodes.find((node) => node.id === nodeId)?.data as FlowNodeData | undefined)?.keyword);
    fields[index] = value;
    updateNodeData(nodeId, { keyword: fields.join(", ") });
  }

  function addKeywordField(nodeId: string) {
    const fields = keywordFields((nodes.find((node) => node.id === nodeId)?.data as FlowNodeData | undefined)?.keyword);
    fields.push("");
    updateNodeData(nodeId, { keyword: fields.join(", ") });
  }

  function removeKeywordField(nodeId: string, index: number) {
    const fields = keywordFields((nodes.find((node) => node.id === nodeId)?.data as FlowNodeData | undefined)?.keyword);
    fields.splice(index, 1);
    updateNodeData(nodeId, { keyword: fields.join(", ") });
  }

  function addNode(kind: FlowNodeData["kind"]) {
    const id = `n${Date.now()}`;
    const node: MSNode = {
      id,
      type: kind === "trigger" ? "msTrigger" : kind === "condition" ? "msCondition" : "msAction",
      position: { x: 120 + nodes.length * 30, y: 80 + nodes.length * 70 },
      data: defaultData(kind),
    };
    setNodes((nds) => [...nds, node]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Editor visual</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#F8FAFC] md:text-3xl">Automações & Follow-ups</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Gatilhos, condições e ações dentro das regras da Meta — nada de disparos em massa.
          </p>
        </div>
        <Button
          data-testid="automation-create-button"
          onClick={() => setCreateOpen(true)}
          className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"
        >
          <Plus className="h-4 w-4" /> Nova automação
        </Button>
      </div>

      {!connected && <LockBanner onConnect={() => (window.location.href = "/connection?connect=1")} testid="automations-lock-banner" />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 md:gap-6">
        {/* List */}
        <div className="space-y-3 lg:col-span-3">
          {automations.map((a) => (
            <div
              key={a.id}
              data-testid={`automation-card-${a.id}`}
              className={cn(
                "rounded-xl border p-4 transition-colors",
                a.id === automation?.id ? "border-[#C5A46D] bg-[#181C26]" : "border-[#282E40] bg-[#181C26] hover:border-[#C5A46D]/40"
              )}
            >
              <button type="button" className="w-full text-left" data-testid={`automation-select-${a.id}`} onClick={() => setSelectedId(a.id)}>
                <p className="text-sm font-semibold text-[#F8FAFC]">{a.name}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-[#94A3B8]">{a.description || "Sem descrição"}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Badge className="rounded-full bg-[#2A2317] text-[#E9D2A8]">{a.runs} execuções</Badge>
                  {a.last_run_at && (
                    <span className="text-[10px] text-[#94A3B8]">
                      última: {format(parseISO(a.last_run_at), "dd/MM HH:mm", { locale: ptBR })}
                    </span>
                  )}
                </div>
              </button>
              <div className="mt-3 flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[#94A3B8]">
                  <input
                    type="checkbox"
                    checked={a.enabled}
                    data-testid={`automation-toggle-${a.id}`}
                    onChange={(e) => {
                      setSelectedId(a.id);
                      toggleAutomation(a, e.target.checked);
                    }}
                    className="h-3.5 w-3.5 accent-[#C5A46D]"
                  />
                  {a.enabled ? "Ativa" : "Pausada"}
                </label>
                <button
                  type="button"
                  aria-label={`Excluir ${a.name}`}
                  data-testid={`automation-delete-${a.id}`}
                  onClick={() => {
                    setSelectedId(a.id);
                    deleteMutation.mutate();
                  }}
                  className="text-[#94A3B8] transition-colors hover:text-[#F87171]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          {automations.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#282E40] p-6 text-center">
              <Workflow className="mx-auto h-8 w-8 text-[#C5A46D]" />
              <p className="mt-2 text-sm text-[#94A3B8]">Nenhuma automação ainda.</p>
            </div>
          )}
        </div>

        {/* Canvas + inspector */}
        <div className="lg:col-span-9">
          <div className="overflow-hidden rounded-xl border border-[#282E40]" data-testid="automation-canvas">
            {automation ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#282E40] bg-[#181C26] px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" data-testid="add-trigger-node" onClick={() => addNode("trigger")} className="border-[#C5A46D]/40 text-[#C5A46D] hover:bg-[#2A2317]">
                      + Gatilho
                    </Button>
                    <Button size="sm" variant="outline" data-testid="add-condition-node" onClick={() => addNode("condition")} className="border-[#818CF8]/40 text-[#818CF8] hover:bg-[#222538]">
                      + Condição
                    </Button>
                    <Button size="sm" variant="outline" data-testid="add-action-node" onClick={() => addNode("action")} className="border-[#4ADE80]/40 text-[#4ADE80] hover:bg-[#142A20]">
                      + Ação
                    </Button>
                  </div>
                  <Button size="sm" data-testid="automation-save-button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()} className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]">
                    <Save className="h-3.5 w-3.5" /> Salvar fluxo
                  </Button>
                </div>
                <div className="h-[440px] bg-[#10131B]">
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onNodesChange={(changes: NodeChange<MSNode>[]) => setNodes((nds) => applyNodeChanges<MSNode>(changes, nds))}
                    onEdgesChange={(changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds))}
                    onConnect={(connection: Connection) =>
                      setEdges((eds) => addEdge({ ...connection, markerEnd: { type: MarkerType.ArrowClosed, color: "#3A4258" } }, eds))
                    }
                    defaultEdgeOptions={{ style: { stroke: "#3A4258" }, markerEnd: { type: MarkerType.ArrowClosed, color: "#3A4258" } }}
                    fitView
                    data-testid="automation-reactflow"
                  >
                    <Background gap={16} color="#1E2433" />
                    <Controls className="!bg-[#181C26] !border-[#282E40]" />
                  </ReactFlow>
                </div>
                {/* Inspector */}
                <div className="border-t border-[#282E40] bg-[#181C26] p-4" data-testid="automation-inspector">
                  {nodeData ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-widest text-[#C5A46D]">Bloco</Label>
                        <Select
                          value={nodeData.subtype}
                          onValueChange={(value: string) => {
                            const label = SUBTYPE_OPTIONS[nodeData.kind].find((o) => o.value === value)?.label ?? nodeData.label;
                            updateNodeData(selectedNode!.id, { subtype: value, label });
                          }}
                        >
                          <SelectTrigger data-testid="inspector-subtype-select" size="sm" className="w-full border-[#282E40] bg-[#10131B] text-xs text-[#F8FAFC]">
                            <SelectValue>{(v: string) => SUBTYPE_OPTIONS[nodeData.kind].find((o) => o.value === v)?.label ?? v}</SelectValue>
                          </SelectTrigger>
                          <SelectContent className="border-[#282E40] bg-[#1E2330]">
                            {SUBTYPE_OPTIONS[nodeData.kind].map((o) => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {(nodeData.subtype === "keyword" || (nodeData.kind === "trigger" && nodeData.subtype === "comment_received")) && (
                        <div className="space-y-2 sm:col-span-2">
                          <Label className="text-[10px] uppercase tracking-widest text-[#C5A46D]">Palavras-chave individuais</Label>
                          {keywordFields(nodeData.keyword).map((keyword, index) => (
                            <div key={`${selectedNode!.id}-keyword-${index}`} className="flex items-center gap-2">
                              <Input
                                value={keyword}
                                onChange={(e) => updateKeywordField(selectedNode!.id, index, e.target.value)}
                                data-testid={`inspector-keyword-input-${index}`}
                                aria-label={`Palavra-chave ${index + 1}`}
                                placeholder={index === 0 ? "Ex.: LINK" : "Outra variação"}
                                className="border-[#282E40] bg-[#10131B] text-xs text-[#F8FAFC]"
                              />
                              {keywordFields(nodeData.keyword).length > 1 && (
                                <Button type="button" size="sm" variant="outline" aria-label={`Remover palavra-chave ${index + 1}`} onClick={() => removeKeywordField(selectedNode!.id, index)} className="border-[#282E40] text-[#F87171]">×</Button>
                              )}
                            </div>
                          ))}
                          <Button type="button" size="sm" variant="outline" data-testid="add-keyword-field" onClick={() => addKeywordField(selectedNode!.id)} className="border-[#282E40] text-[#C5A46D]">+ Adicionar palavra-chave</Button>
                          <p className="text-[10px] text-[#94A3B8]">
                            {nodeData.kind === "trigger" ? "O fluxo será ativado quando o comentário contiver qualquer uma delas." : "O texto precisa conter pelo menos uma delas para continuar."}
                          </p>
                        </div>
                      )}
                      {nodeData.subtype === "has_tag" && (
                        <div className="space-y-1.5">
                          <Label className="text-[10px] uppercase tracking-widest text-[#C5A46D]">Etiqueta</Label>
                          <Input
                            value={nodeData.tag ?? ""}
                            onChange={(e) => updateNodeData(selectedNode!.id, { tag: e.target.value })}
                            data-testid="inspector-tag-input"
                            className="border-[#282E40] bg-[#10131B] text-xs text-[#F8FAFC]"
                          />
                        </div>
                      )}
                      {nodeData.subtype === "assign" && (
                        <div className="space-y-1.5">
                          <Label className="text-[10px] uppercase tracking-widest text-[#C5A46D]">Atribuir a</Label>
                          <Input
                            value={nodeData.assignee ?? ""}
                            onChange={(e) => updateNodeData(selectedNode!.id, { assignee: e.target.value })}
                            data-testid="inspector-assignee-input"
                            className="border-[#282E40] bg-[#10131B] text-xs text-[#F8FAFC]"
                          />
                        </div>
                      )}
                      {["reply_comment", "send_message", "create_task"].includes(nodeData.subtype) && (
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-[10px] uppercase tracking-widest text-[#C5A46D]">Conteúdo</Label>
                          <Input
                            value={nodeData.text ?? ""}
                            onChange={(e) => updateNodeData(selectedNode!.id, { text: e.target.value })}
                            data-testid="inspector-text-input"
                            className="border-[#282E40] bg-[#10131B] text-xs text-[#F8FAFC]"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-[#94A3B8]">Selecione um bloco no canvas para configurar. Arraste das alças douradas para conectar blocos.</p>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-[420px] flex-col items-center justify-center gap-2 bg-[#10131B] text-center">
                <Workflow className="h-10 w-10 text-[#C5A46D]" />
                <p className="text-sm text-[#94A3B8]">Crie sua primeira automação para começar.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 md:gap-6">
        <div className="rounded-xl border border-[#282E40] bg-[#181C26] p-5" data-testid="automation-runs-panel">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Execuções recentes</p>
          <div className="mt-3 space-y-2">
            {runs.slice(0, 6).map((run) => (
              <div key={run.id} data-testid="automation-run-item" className="rounded-lg border border-[#282E40] bg-[#10131B] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-[#F8FAFC]">{run.automation_name}</p>
                  <Badge
                    className={cn(
                      "rounded-full border",
                      run.result === "executed"
                        ? "border-[#4ADE80]/40 bg-[#142A20] text-[#4ADE80]"
                        : run.result === "blocked"
                          ? "border-[#FBBF24]/40 bg-[#2A1D17] text-[#FBBF24]"
                          : "border-[#818CF8]/40 bg-[#222538] text-[#818CF8]"
                    )}
                  >
                    {run.result === "executed" ? "executada" : run.result === "blocked" ? "bloqueada" : "encerrada"}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-[#94A3B8]">{run.detail}</p>
              </div>
            ))}
            {runs.length === 0 && <p className="text-sm text-[#94A3B8]">Nenhuma execução ainda.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-[#282E40] bg-[#181C26] p-5" data-testid="automation-tasks-panel">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Tarefas internas criadas</p>
          <div className="mt-3 space-y-2">
            {tasks.slice(0, 6).map((task) => (
              <button
                key={task.id}
                type="button"
                data-testid={`automation-task-${task.id}`}
                onClick={() => taskMutation.mutate(task)}
                className="flex w-full items-start gap-2.5 rounded-lg border border-[#282E40] bg-[#10131B] p-3 text-left transition-colors hover:border-[#C5A46D]/40"
              >
                {task.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#4ADE80]" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[#94A3B8]" />}
                <span className={cn("text-sm text-[#F8FAFC]", task.done && "line-through opacity-60")}>{task.title}</span>
              </button>
            ))}
            {tasks.length === 0 && <p className="text-sm text-[#94A3B8]">Nenhuma tarefa pendente.</p>}
          </div>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent role="dialog" className="border-[#2E364D] bg-[#1E2330]" data-testid="automation-create-dialog">
          <DialogHeader>
            <DialogTitle className="text-[#F8FAFC]">Nova automação</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="automation-name" className="text-[#94A3B8]">Nome</Label>
              <Input
                id="automation-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex.: Palavra-chave QUERO"
                data-testid="automation-name-input"
                className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="automation-description" className="text-[#94A3B8]">Descrição</Label>
              <Input
                id="automation-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="O que essa automação faz"
                data-testid="automation-description-input"
                className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" data-testid="automation-create-cancel" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              data-testid="automation-create-submit"
              disabled={!newName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"
            >
              <Zap className="h-4 w-4" /> Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
