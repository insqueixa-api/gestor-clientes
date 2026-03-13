"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

// Inicializa o cliente Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Novos estados para validar o link
  const [isValidating, setIsValidating] = useState(true);
  const [hasValidSession, setHasValidSession] = useState(false);
  
  const router = useRouter();

  // Verifica se a URL contém uma sessão válida de recuperação
  useEffect(() => {
    async function checkSession() {
      const { data: { session } } = await supabase.auth.getSession();
      
      // Além da sessão nula, verifica se a URL retornou erro do Supabase (ex: token expirado)
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const hasErrorInUrl = hash.includes("error_code") || hash.includes("error_description");

      if (!session || hasErrorInUrl) {
        setHasValidSession(false);
      } else {
        setHasValidSession(true);
      }
      setIsValidating(false);
    }
    
    checkSession();
  }, []);

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErrorMsg(null);

    if (password.length < 6) {
      setErrorMsg("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) throw error;

setMsg("Senha atualizada com sucesso! Redirecionando para o login...");
      
      setTimeout(() => {
        // Redirecionamento absoluto para o endereço correto
        window.location.href = "https://unigestor.net.br/login";
      }, 2000);
      
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao atualizar a senha.");
    } finally {
      setLoading(false);
    }
  }

  // Tela de carregamento enquanto valida o token
  if (isValidating) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 dark:bg-[#0f141a]">
        <div className="text-slate-500 dark:text-white/60 animate-pulse">Validando link de segurança...</div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] relative overflow-hidden flex items-center sm:items-center justify-center px-3 sm:px-6 pt-6 pb-6 sm:py-10 bg-slate-50 dark:bg-[#0f141a]">
      {/* Fundo com gradiente + glow */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0b2a4a] via-[#0f141a] to-[#0e6b5c] opacity-90 dark:opacity-100" />
        <div className="absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full bg-blue-500/20 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.06] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.4'/%3E%3C/svg%3E\")",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-[420px] sm:max-w-md">
        <div className="rounded-2xl border border-white/20 bg-white/85 backdrop-blur-xl shadow-2xl dark:bg-[#161b22]/80 dark:border-white/10 overflow-hidden">
          
          <div className="px-5 sm:px-8 pt-5 sm:pt-8 pb-3 sm:pb-6 text-center">
            <div className="flex items-center justify-center">
              <img
                src="/brand/logo-full-light.png"
                alt="UniGestor"
                className="h-9 sm:h-10 w-auto select-none"
                draggable={false}
              />
            </div>

            {/* Renderização Condicional baseada na validade do Link */}
            {hasValidSession ? (
              <>
                <h1 className="mt-4 text-xl sm:text-2xl font-semibold text-slate-800 dark:text-white">
                  Nova Senha
                </h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-white/60">
                  Digite a sua nova senha de acesso.
                </p>
              </>
            ) : (
              <>
                <h1 className="mt-4 text-xl sm:text-2xl font-semibold text-red-600 dark:text-red-400">
                  Link Inválido
                </h1>
                <p className="mt-2 text-sm text-slate-500 dark:text-white/60">
                  Este link de recuperação expirou ou já foi utilizado. Por questões de segurança, solicite um novo acesso.
                </p>
              </>
            )}
          </div>

          <div className="px-5 sm:px-8 pt-2 pb-6 sm:pb-8">
            {hasValidSession ? (
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-white/80">
                    Nova Senha
                  </label>
                  <input
                    name="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo de 6 caracteres"
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/60 dark:border-white/10 dark:bg-black/20 dark:text-white dark:placeholder:text-white/40"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || password.length < 6}
                  className={[
                    "w-full rounded-xl py-3 font-semibold transition mt-2",
                    loading || password.length < 6
                      ? "bg-slate-300 text-white cursor-not-allowed dark:bg-white/15"
                      : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
                  ].join(" ")}
                >
                  {loading ? "Atualizando..." : "Salvar nova senha"}
                </button>

                {msg && (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400 text-center font-medium">
                    {msg}
                  </div>
                )}

                {errorMsg && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 text-center font-medium">
                    {errorMsg}
                  </div>
                )}
              </form>
            ) : (
              <button
                onClick={() => window.location.href = "https://unigestor.net.br/login"}
                className="w-full rounded-xl py-3 font-semibold transition bg-slate-800 text-white hover:bg-slate-900 dark:bg-white/10 dark:hover:bg-white/20"
              >
                Voltar ao Login
              </button>
            )}

            <div className="mt-6 text-center text-[10px] sm:text-xs text-white/70">
              <span className="inline-block rounded-full bg-black/20 px-3 py-1">
                UniGestor © {new Date().getFullYear()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}