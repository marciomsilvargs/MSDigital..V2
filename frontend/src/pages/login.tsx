import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CalendarClock, Loader2, Lock, MessageCircle, Workflow } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { getCurrentUser, isSupabaseConfigured, requireSupabase } from "@/lib/supabase";
import { beginSession } from "@/lib/session";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const HIGHLIGHTS = [
  { icon: CalendarClock, title: "Stories agendados no piloto automático", text: "Estúdio 9:16 com calendário semanal e mensal." },
  { icon: MessageCircle, title: "Direct e comentários em um só lugar", text: "Atendimento humano + respostas rápidas." },
  { icon: Workflow, title: "Automações que respeitam as regras da Meta", text: "Gatilhos, condições e ações visuais." },
];

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const { isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
    retry: false,
    staleTime: 60_000,
    enabled: isSupabaseConfigured,
  });

  const loginMutation = useMutation({
    mutationFn: async (): Promise<User> => {
      const client = requireSupabase();
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return getCurrentUser();
    },
    onSuccess: async () => {
      await beginSession();
      navigate("/dashboard", { replace: true });
    },
    onError: (error) => {
      if (!isSupabaseConfigured) {
        toast.error("Supabase ainda não está configurado. Preencha frontend/.env.local e reinicie o app.");
        return;
      }
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (error instanceof ApiError && error.status === 401 || message.includes("invalid login credentials")) {
        toast.error("E-mail ou senha inválidos. Confirme se essa conta já foi criada no Supabase Auth.");
      } else if (message.includes("email not confirmed")) {
        toast.error("Confirme o e-mail cadastrado antes de entrar.");
      } else {
        toast.error("Não foi possível entrar. Verifique a conexão e os dados da conta no Supabase.");
      }
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-[#10131B]">
        <Loader2 className="h-6 w-6 animate-spin text-[#C5A46D]" />
      </div>
    );
  }

  return (
    <div className="grid min-h-svh grid-cols-1 bg-[#10131B] lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden lg:block">
        <img
          src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?crop=entropy&cs=srgb&fm=jpg&q=85"
          alt="Equipe de marketing da agência colaborando"
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#10131B] via-[#10131B]/70 to-transparent" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative flex h-full flex-col justify-end gap-6 p-12"
        >
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#C5A46D] text-lg font-bold text-[#10131B]">
                MS
              </div>
              <p className="text-sm font-semibold uppercase tracking-widest text-[#C5A46D]">MS Studio Digital</p>
            </div>
            <h1 className="mt-6 max-w-lg text-4xl font-bold leading-tight tracking-tight text-[#F8FAFC]">
              A central da sua agência para o Instagram de cada cliente.
            </h1>
            <p className="mt-3 max-w-md text-[#94A3B8]">
              Conexão em um clique com a Meta, agendamento de Stories, atendimento e automações — com
              isolamento total por empresa.
            </p>
          </div>
          <div className="space-y-4">
            {HIGHLIGHTS.map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-[#181C26]">
                  <item.icon className="h-4 w-4 text-[#C5A46D]" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[#F8FAFC]">{item.title}</p>
                  <p className="text-xs text-[#94A3B8]">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Login form */}
      <div className="flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#C5A46D] font-bold text-[#10131B]">
              MS
            </div>
            <p className="font-bold text-[#F8FAFC]">MS Studio Digital</p>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[#F8FAFC]">Acessar painel da agência</h2>
          <p className="mt-1 text-sm text-[#94A3B8]">Entre com o acesso administrativo da agência.</p>
          {!isSupabaseConfigured && (
            <p role="status" className="mt-4 rounded-lg border border-[#C5A46D]/30 bg-[#C5A46D]/10 p-3 text-sm text-[#D8B77E]">
              Para habilitar o login, configure a URL e a chave publishable do Supabase em <code>frontend/.env.local</code>.
            </p>
          )}

          <form
            className="mt-8 space-y-4"
            data-testid="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              loginMutation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="email" className="text-[#94A3B8]">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@agencia.com"
                data-testid="login-email-input"
                className="border-[#282E40] bg-[#181C26] text-[#F8FAFC] placeholder:text-[#94A3B8]/60"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-[#94A3B8]">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                data-testid="login-password-input"
                className="border-[#282E40] bg-[#181C26] text-[#F8FAFC] placeholder:text-[#94A3B8]/60"
              />
            </div>
            <Button
              type="submit"
              disabled={loginMutation.isPending}
              data-testid="login-submit-button"
              className="w-full bg-[#C5A46D] font-semibold text-[#10131B] hover:bg-[#D8B77E] active:scale-95"
            >
              {loginMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Entrar
            </Button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
