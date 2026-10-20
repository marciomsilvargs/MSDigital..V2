import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  BarChart3,
  Building2,
  Clapperboard,
  Instagram,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquare,
  Plus,
  Workflow,
} from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import { apiGet } from "@/lib/api";
import { endSession } from "@/lib/session";
import { CompanyProvider, companyKey, useCompanies } from "@/lib/company-context";
import type { ConnectionStatus, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/companies", label: "Empresas", icon: Building2, testid: "nav-companies" },
  { to: "/connection", label: "Conexão Instagram", icon: Instagram, testid: "nav-connection" },
  { to: "/stories", label: "Stories", icon: Clapperboard, testid: "nav-stories" },
  { to: "/inbox", label: "Direct", icon: MessageCircle, testid: "nav-inbox" },
  { to: "/comments", label: "Comentários", icon: MessageSquare, testid: "nav-comments" },
  { to: "/automations", label: "Automações", icon: Workflow, testid: "nav-automations" },
  { to: "/reports", label: "Relatórios", icon: BarChart3, testid: "nav-reports" },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-3" data-testid="sidebar-nav">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          data-testid={item.testid}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-150",
              isActive
                ? "bg-[#1F1A12] font-semibold text-[#C5A46D]"
                : "text-[#94A3B8] hover:bg-[#141824] hover:text-[#F8FAFC]"
            )
          }
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <Link to="/dashboard" className="flex items-center gap-3 px-6 py-6" data-testid="sidebar-brand">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#C5A46D] font-bold text-[#10131B]">
          MS
        </div>
        <div>
          <p className="text-sm font-bold tracking-tight text-[#F8FAFC]">MS Studio Digital</p>
          <p className="text-[11px] uppercase tracking-widest text-[#C5A46D]">Gestão para agências</p>
        </div>
      </Link>
      <NavLinks onNavigate={onNavigate} />
      <div className="mt-auto px-6 py-5 text-[11px] leading-relaxed text-[#94A3B8]">
        <p className="font-semibold text-[#94A3B8]">MS Studio Digital V2</p>
        <p>Instagram API com Instagram Login</p>
      </div>
    </div>
  );
}

function CompanySelector() {
  const { companies, activeCompany, setActiveCompanyId } = useCompanies();
  const navigate = useNavigate();
  return (
    <Select
      value={activeCompany?.id ?? ""}
      onValueChange={(value: string) => {
        if (value === "__new") {
          navigate("/companies");
          return;
        }
        setActiveCompanyId(value);
      }}
    >
      <SelectTrigger
        data-testid="company-selector"
        aria-label="Seletor global de empresas"
        className="w-[210px] border-[#282E40] bg-[#181C26] text-sm sm:w-[240px]"
      >
        <SelectValue>
          {(value: string) => companies.find((c) => c.id === value)?.name ?? "Selecione a empresa"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="border-[#282E40] bg-[#1E2330]">
        {companies.map((c) => (
          <SelectItem key={c.id} value={c.id} data-testid={`company-option-${c.id}`}>
            {c.name}
          </SelectItem>
        ))}
        <SelectItem value="__new" data-testid="company-option-new" className="text-[#C5A46D]">
          <span className="flex items-center gap-2">
            <Plus className="h-3.5 w-3.5" /> Nova empresa
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

function ShellLayout() {
  const { activeCompany } = useCompanies();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getCurrentUser });
  const { data: connStatus } = useQuery({
    queryKey: companyKey(activeCompany?.id, "connection"),
    queryFn: () => apiGet<ConnectionStatus>(`/companies/${activeCompany!.id}/connection`),
    enabled: !!activeCompany,
  });
  const metaConfigured = !(connStatus?.demo_mode ?? true);

  async function handleLogout() {
    await endSession();
    navigate("/", { replace: true });
  }

  const initials = String(me?.name ?? "MS")
    .split(" ")
    .map((part: string) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-svh bg-[#10131B] text-[#F8FAFC]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-[#1E2433] bg-[#0D1017] lg:flex lg:flex-col">
        <SidebarContent />
      </aside>

      <header
        data-testid="app-header"
        className="fixed inset-x-0 top-0 z-30 flex h-16 items-center gap-3 border-b border-[#282E40] bg-[#10131B]/85 px-4 backdrop-blur-xl lg:pl-[272px]"
      >
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Abrir menu"
          data-testid="mobile-menu-button"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <CompanySelector />
        <div className="ml-auto flex items-center gap-3">
          {metaConfigured ? (
            <Badge data-testid="real-mode-badge" className="hidden border-[#4ADE80]/40 bg-[#142A20] text-[#86EFAC] sm:inline-flex">
              INTEGRAÇÃO ATIVA
            </Badge>
          ) : (
            <Badge data-testid="meta-pending-badge" className="hidden border-[#F59E0B]/40 bg-[#2A2317] text-[#FCD34D] sm:inline-flex">
              META PENDENTE
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  data-testid="user-menu-button"
                  className="flex items-center gap-2 px-2"
                  aria-label="Menu do usuário"
                />
              }
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#202534] text-xs font-bold text-[#C5A46D]">
                {initials}
              </span>
              <span className="hidden text-sm text-[#F8FAFC] md:inline">{me?.name ?? ""}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-[#282E40] bg-[#1E2330]">
              <DropdownMenuLabel className="text-[#94A3B8]">{me?.email ?? ""}</DropdownMenuLabel>
              <DropdownMenuItem
                data-testid="logout-button"
                onClick={() => void handleLogout()}
                className="text-[#F87171]"
              >
                <LogOut className="h-4 w-4" /> Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 border-[#1E2433] bg-[#0D1017] p-0">
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="pt-16 lg:pl-64">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mx-auto max-w-[1440px] p-4 md:p-6"
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}

// One provider for the whole authed area — every page reads the active company from here.
export default function AppShell() {
  return (
    <CompanyProvider>
      <ShellLayout />
    </CompanyProvider>
  );
}
