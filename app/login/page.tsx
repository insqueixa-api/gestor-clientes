"use client";

import { useMemo, useState, useActionState } from "react";
import { createClient } from "@supabase/supabase-js";
import { loginAction, type LoginState } from "./actions";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function isLikelyEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [msg, setMsg] = useState<string | null>(null);

  const initialState: LoginState = {};
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  const canSubmit = useMemo(() => {
    if (!isLikelyEmail(email)) return false;
    if (mode === "reset") return true;
    return password.length >= 6;
  }, [email, password, mode]);

  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    try {
      const safeEmail = email.trim().toLowerCase();
      if (!isLikelyEmail(safeEmail)) {
        setMsg("Informe um e-mail válido.");
        return;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(safeEmail, {
        redirectTo: `${location.origin}/reset-password`,
      });

      if (error) throw error;

      setMsg("Enviei um link de redefinição para seu e-mail.");
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : "Erro ao enviar link.");
    }
  }

  const title = mode === "reset" ? "Redefinir senha" : "Bem-vindo";
  const subtitle =
    mode === "reset"
      ? "Informe seu e-mail para receber o link."
      : "Acesse o painel gerenciador.";

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-6 py-10 bg-slate-50 dark:bg-[#0f141a]">
      {/* Fundo com gradiente + glow */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0b2a4a] via-[#0f141a] to-[#0e6b5c] opacity-90 dark:opacity-100" />
        <div className="absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full bg-blue-500/20 blur-3xl" />

        {/* grain leve */}
        <div
          className="absolute inset-0 opacity-[0.06] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.4'/%3E%3C/svg%3E\")",
          }}
        />
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-2xl border border-white/20 bg-white/85 backdrop-blur-xl shadow-2xl dark:bg-[#161b22]/80 dark:border-white/10">
          {/* Header */}
          <div className="px-8 pt-8 pb-6 text-center">
            <div className="flex items-center justify-center">
              <img
                src="/brand/logo-full-light.png"
                alt="UniGestor"
                className="h-12 w-auto select-none"
                draggable={false}
              />
            </div>

            <h1 className="mt-5 text-2xl font-semibold text-slate-800 dark:text-white">
              {title}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-white/60">
              {subtitle}
            </p>
          </div>

          {/* Tabs */}
          <div className="px-8">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-black/20">
              <button
                type="button"
                onClick={() => {
                  setMsg(null);
                  setMode("login");
                }}
                className={[
                  "rounded-lg px-3 py-2 text-sm font-medium transition",
                  mode === "login"
                    ? "bg-white shadow text-slate-900 dark:bg-[#0f141a] dark:text-white"
                    : "text-slate-600 hover:text-slate-800 dark:text-white/70 dark:hover:text-white",
                ].join(" ")}
              >
                Login
              </button>

              <button
                type="button"
                onClick={() => {
                  setMsg(null);
                  setMode("reset");
                }}
                className={[
                  "rounded-lg px-3 py-2 text-sm font-medium transition",
                  mode === "reset"
                    ? "bg-white shadow text-slate-900 dark:bg-[#0f141a] dark:text-white"
                    : "text-slate-600 hover:text-slate-800 dark:text-white/70 dark:hover:text-white",
                ].join(" ")}
              >
                Esqueci a senha
              </button>
            </div>
          </div>

          {/* Form */}
          <div className="px-8 pt-6 pb-8">
            {mode === "login" ? (
              <form action={formAction} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-white/80">
                    E-mail
                  </label>
                  <input
                    name="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@exemplo.com"
                    autoComplete="email"
                    inputMode="email"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/60 dark:border-white/10 dark:bg-black/20 dark:text-white dark:placeholder:text-white/40"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-white/80">
                    Senha
                  </label>
                  <input
                    name="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/60 dark:border-white/10 dark:bg-black/20 dark:text-white dark:placeholder:text-white/40"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit || pending}
                  className={[
                    "w-full rounded-xl py-3 font-semibold transition",
                    !canSubmit || pending
                      ? "bg-slate-300 text-white cursor-not-allowed dark:bg-white/15"
                      : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
                  ].join(" ")}
                >
                  {pending ? "Aguarde..." : "Entrar"}
                </button>

                {/* Erro vindo da Server Action */}
                {state?.error && (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:border-white/10 dark:bg-black/20 dark:text-white/80">
                    {state.error}
                  </div>
                )}
              </form>
            ) : (
              <form onSubmit={onReset} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-white/80">
                    E-mail
                  </label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@exemplo.com"
                    autoComplete="email"
                    inputMode="email"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/60 dark:border-white/10 dark:bg-black/20 dark:text-white dark:placeholder:text-white/40"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={[
                    "w-full rounded-xl py-3 font-semibold transition",
                    !canSubmit
                      ? "bg-slate-300 text-white cursor-not-allowed dark:bg-white/15"
                      : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
                  ].join(" ")}
                >
                  Enviar link
                </button>

                {msg && (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:border-white/10 dark:bg-black/20 dark:text-white/80">
                    {msg}
                  </div>
                )}
              </form>
            )}

            {/* Rodapé mínimo */}
            <div className="mt-6 text-center text-xs text-white/70">
              <span className="inline-block rounded-full bg-black/20 px-3 py-1">
                UniGestor © {new Date().getFullYear()}
              </span>
            </div>
          </div>
        </div>

        {/* Hint de segurança */}
        <div className="mt-5 text-center text-xs text-white/70">
          Acesso protegido • Use seu e-mail cadastrado
        </div>
      </div>
    </div>
  );
}
