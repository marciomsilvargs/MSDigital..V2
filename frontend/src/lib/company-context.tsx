import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { Company } from "@/lib/types";

interface CompanyContextValue {
  companies: Company[];
  activeCompany: Company | null;
  setActiveCompanyId: (id: string) => void;
  isLoading: boolean;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

const STORAGE_KEY = "ms_active_company";

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const {
    data,
    isLoading,
  } = useQuery({
    queryKey: ["companies"],
    queryFn: () => apiGet<Company[]>("/companies"),
    staleTime: 15_000,
  });
  const [activeId, setActiveId] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? "");

  const companies = data ?? [];
  const activeCompany = companies.find((c) => c.id === activeId) ?? companies[0] ?? null;

  useEffect(() => {
    if (activeCompany) localStorage.setItem(STORAGE_KEY, activeCompany.id);
  }, [activeCompany?.id]);

  return (
    <CompanyContext.Provider
      value={{ companies, activeCompany, setActiveCompanyId: setActiveId, isLoading }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompanies(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompanies must be used inside CompanyProvider");
  return ctx;
}

// Every company-scoped query key starts here — switching companies just changes the key.
export function companyKey(companyId: string | undefined, ...rest: unknown[]): unknown[] {
  return ["company", companyId, ...rest];
}
