import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Instagram, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiPatch, apiPost } from "@/lib/api";
import { useCompanies } from "@/lib/company-context";
import type { Company } from "@/lib/types";
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

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Companies() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { companies, activeCompany, setActiveCompanyId, isLoading } = useCompanies();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSegment, setNewSegment] = useState("");

  const [editing, setEditing] = useState<Company | null>(null);
  const [editName, setEditName] = useState("");
  const [editSegment, setEditSegment] = useState("");

  const [deleting, setDeleting] = useState<Company | null>(null);
  const [staffingFor, setStaffingFor] = useState<Company | null>(null);
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState("atendente");
  const [staffEmail, setStaffEmail] = useState("");

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["companies"] });
  }

  const createMutation = useMutation({
    mutationFn: () => apiPost<Company>("/companies", { name: newName, segment: newSegment }),
    onSuccess: (company) => {
      refresh();
      setCreateOpen(false);
      setNewName("");
      setNewSegment("");
      setActiveCompanyId(company.id);
      toast.success("Empresa criada com sucesso!");
    },
    onError: (error) => toast.error("Não foi possível criar a empresa.", {
      description: error instanceof Error ? error.message : "Confira a conexão e as permissões do Supabase.",
    }),
  });

  const editMutation = useMutation({
    mutationFn: () => apiPatch<Company>(`/companies/${editing!.id}`, { name: editName, segment: editSegment }),
    onSuccess: () => {
      refresh();
      setEditing(null);
      toast.success("Empresa atualizada!");
    },
    onError: () => toast.error("Não foi possível atualizar a empresa."),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDelete<void>(`/companies/${deleting!.id}`),
    onSuccess: () => {
      refresh();
      setDeleting(null);
      toast.success("Empresa removida junto com todos os seus dados.");
    },
    onError: () => toast.error("Não foi possível remover a empresa."),
  });

  const staffMutation = useMutation({
    mutationFn: () =>
      apiPost<Company>(`/companies/${staffingFor!.id}/employees`, {
        name: staffName,
        role: staffRole,
        email: staffEmail,
      }),
    onSuccess: () => {
      refresh();
      setStaffName("");
      setStaffEmail("");
      setStaffRole("atendente");
      toast.success("Funcionário adicionado!");
    },
    onError: () => toast.error("Não foi possível adicionar o funcionário."),
  });

  const removeStaffMutation = useMutation({
    mutationFn: ({ companyId, employeeId }: { companyId: string; employeeId: string }) =>
      apiDelete<Company>(`/companies/${companyId}/employees/${employeeId}`),
    onSuccess: () => {
      refresh();
      toast.success("Funcionário removido.");
    },
    onError: () => toast.error("Não foi possível remover o funcionário."),
  });

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-xl bg-[#181C26]" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C5A46D]">Cadastro multiempresa</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#F8FAFC] md:text-3xl">Empresas</h1>
          <p className="text-sm text-[#94A3B8]">
            Cada empresa tem dados, mídias, conversas e automações completamente isolados.
          </p>
        </div>
        <Button
          data-testid="create-company-button"
          onClick={() => setCreateOpen(true)}
          className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"
        >
          <Plus className="h-4 w-4" /> Nova empresa
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 md:gap-6">
        {companies.map((company) => (
          <div
            key={company.id}
            data-testid={`company-card-${company.id}`}
            className={`rounded-xl border bg-[#181C26] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#C5A46D]/40 hover:shadow-lg hover:shadow-black/40 ${
              activeCompany?.id === company.id ? "border-[#C5A46D]" : "border-[#282E40]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#202534] text-sm font-bold text-[#C5A46D]">
                  {initials(company.name)}
                </span>
                <div>
                  <p className="font-semibold text-[#F8FAFC]" data-testid={`company-name-${company.id}`}>{company.name}</p>
                  <Badge variant="secondary" className="mt-1 bg-[#222838] text-[#94A3B8]">
                    {company.segment || "Sem segmento"}
                  </Badge>
                </div>
              </div>
              {activeCompany?.id === company.id && (
                <Badge className="bg-[#2A2317] text-[#E9D2A8]">Ativa</Badge>
              )}
            </div>

            <div className="mt-4 space-y-1.5">
              {company.employees.map((employee) => (
                <div key={employee.id} className="flex items-center justify-between rounded-lg bg-[#10131B] px-3 py-2" data-testid={`company-employee-${employee.id}`}>
                  <span className="text-sm text-[#F8FAFC]">
                    {employee.name} <span className="text-xs text-[#94A3B8]">· {employee.role}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remover ${employee.name}`}
                    data-testid={`company-employee-remove-${employee.id}`}
                    onClick={() => removeStaffMutation.mutate({ companyId: company.id, employeeId: employee.id })}
                    className="text-[#94A3B8] transition-colors hover:text-[#F87171]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {company.employees.length === 0 && (
                <p className="text-xs text-[#94A3B8]">Nenhum funcionário vinculado.</p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                data-testid={`company-select-${company.id}`}
                onClick={() => {
                  setActiveCompanyId(company.id);
                  navigate("/dashboard");
                }}
                className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"
              >
                Selecionar
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid={`company-connect-${company.id}`}
                onClick={() => {
                  setActiveCompanyId(company.id);
                  navigate("/connection?connect=1");
                }}
                className="border-[#282E40] bg-transparent text-[#F8FAFC] hover:border-[#C5A46D]/40 hover:bg-[#202534]"
              >
                <Instagram className="h-3.5 w-3.5 text-[#C5A46D]" /> Conectar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid={`company-staff-${company.id}`}
                onClick={() => setStaffingFor(company)}
                className="text-[#94A3B8] hover:text-[#F8FAFC]"
              >
                <UserPlus className="h-3.5 w-3.5" /> Funcionários
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid={`company-edit-${company.id}`}
                onClick={() => {
                  setEditing(company);
                  setEditName(company.name);
                  setEditSegment(company.segment);
                }}
                aria-label={`Editar ${company.name}`}
                className="text-[#94A3B8] hover:text-[#F8FAFC]"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid={`company-delete-${company.id}`}
                onClick={() => setDeleting(company)}
                aria-label={`Excluir ${company.name}`}
                className="text-[#94A3B8] hover:text-[#F87171]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}

        {companies.length === 0 && (
          <div className="col-span-full flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#282E40] p-12 text-center">
            <Building2 className="h-10 w-10 text-[#C5A46D]" />
            <p className="text-[#F8FAFC]">Nenhuma empresa cadastrada</p>
            <p className="text-sm text-[#94A3B8]">Crie a primeira empresa para começar.</p>
          </div>
        )}
      </div>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent role="dialog" className="border-[#2E364D] bg-[#1E2330]" data-testid="create-company-dialog">
          <DialogHeader>
            <DialogTitle className="text-[#F8FAFC]">Nova empresa</DialogTitle>
            <DialogDescription className="text-[#94A3B8]">
              Cadastre um cliente da agência. O isolamento de dados é aplicado no servidor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company-name" className="text-[#94A3B8]">Nome</Label>
              <Input
                id="company-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nome da empresa"
                data-testid="create-company-name-input"
                className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-segment" className="text-[#94A3B8]">Segmento</Label>
              <Input
                id="company-segment"
                value={newSegment}
                onChange={(e) => setNewSegment(e.target.value)}
                placeholder="Ex.: Alimentação, Beleza, Fitness…"
                data-testid="create-company-segment-input"
                className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" data-testid="create-company-cancel" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              data-testid="create-company-submit"
              disabled={!newName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"
            >
              Criar empresa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent role="dialog" className="border-[#2E364D] bg-[#1E2330]" data-testid="edit-company-dialog">
          <DialogHeader>
            <DialogTitle className="text-[#F8FAFC]">Editar empresa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-company-name" className="text-[#94A3B8]">Nome</Label>
              <Input
                id="edit-company-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                data-testid="edit-company-name-input"
                className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-company-segment" className="text-[#94A3B8]">Segmento</Label>
              <Input
                id="edit-company-segment"
                value={editSegment}
                onChange={(e) => setEditSegment(e.target.value)}
                data-testid="edit-company-segment-input"
                className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button
              data-testid="edit-company-submit"
              disabled={editMutation.isPending}
              onClick={() => editMutation.mutate()}
              className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent role="dialog" className="border-[#2E364D] bg-[#1E2330]" data-testid="delete-company-dialog">
          <DialogHeader>
            <DialogTitle className="text-[#F8FAFC]">Excluir {deleting?.name}?</DialogTitle>
            <DialogDescription className="text-[#94A3B8]">
              Todas as mídias, stories, conversas, comentários, automações e a conexão Instagram desta
              empresa serão removidos permanentemente. Os dados das outras empresas permanecem intactos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" data-testid="delete-company-cancel" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button
              data-testid="delete-company-confirm"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Excluir definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Staffing */}
      <Dialog open={!!staffingFor} onOpenChange={(open) => !open && setStaffingFor(null)}>
        <DialogContent role="dialog" className="border-[#2E364D] bg-[#1E2330]" data-testid="staff-dialog">
          <DialogHeader>
            <DialogTitle className="text-[#F8FAFC]">Funcionários de {staffingFor?.name}</DialogTitle>
            <DialogDescription className="text-[#94A3B8]">
              Funcionários podem ser atribuídos aos atendimentos no Direct e nos comentários.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-3">
              <Label htmlFor="staff-name" className="text-[#94A3B8]">Nome</Label>
              <Input
                id="staff-name"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder="Nome do funcionário"
                data-testid="staff-name-input"
                className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-role" className="text-[#94A3B8]">Função</Label>
              <Input
                id="staff-role"
                value={staffRole}
                onChange={(e) => setStaffRole(e.target.value)}
                placeholder="atendente / gerente"
                data-testid="staff-role-input"
                className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="staff-email" className="text-[#94A3B8]">E-mail</Label>
              <Input
                id="staff-email"
                type="email"
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                placeholder="contato@empresa.com"
                data-testid="staff-email-input"
                className="border-[#282E40] bg-[#181C26] text-[#F8FAFC]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              data-testid="staff-submit"
              disabled={!staffName.trim() || staffMutation.isPending}
              onClick={() => staffMutation.mutate()}
              className="bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E]"
            >
              <UserPlus className="h-4 w-4" /> Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
