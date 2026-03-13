"use client";

import { useMemo, useState, useActionState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { loginAction, type LoginState } from "./actions";
import { Turnstile } from '@marsidev/react-turnstile';

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
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  
  // ✅ Aqui estão as variáveis que estavam causando erro
  const [failedAttempts, setFailedAttempts] = useState(0); 
  const [showPassword, setShowPassword] = useState(false);

  const initialState: LoginState = {};
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  // ✅ Monitora erros de login para incrementar as tentativas
  useEffect(() => {
    if (state?.error) {
      setFailedAttempts((prev) => prev + 1);
    }
  }, [state]);

  const canSubmit = useMemo(() => {
    if (!isLikelyEmail(email)) return false;
    if (mode === "reset") return true;
    if (failedAttempts >= 3) return false;
    return password.length >= 6 && turnstileToken !== null;
  }, [email, password, mode, turnstileToken, failedAttempts]);

  async function onReset(e: React.FormEvent) {

    e.preventDefault();
    setMsg(null);
    setIsResetting(true); // ✅ Inicia o loading

    try {
      const safeEmail = email.trim().toLowerCase();
      if (!isLikelyEmail(safeEmail)) {
        setMsg("Informe um e-mail válido.");
        setIsResetting(false); // ✅ Remove o loading se falhar na validação
        return;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(safeEmail, {
        redirectTo: `${location.origin}/reset-password`,
      });

if (error) throw error;

      setMsg("Se o e-mail existir em nossa base, você receberá um link de redefinição em instantes.");
    } catch (err: unknown) {
      // ✅ Mascaramos o erro para garantir a mesma mensagem de segurança
      setMsg("Se o e-mail existir em nossa base, você receberá um link de redefinição em instantes.");
    } finally {
      setIsResetting(false); // ✅ Garante que o loading termine, dando certo ou errado
    }
  }

  const title = mode === "reset" ? "Redefinir senha" : "Bem-vindo";
  const subtitle =
    mode === "reset"
      ? "Informe seu e-mail para receber o link."
      : "Acesse o painel gerenciador.";

  return (
    <div className="min-h-[100dvh] relative overflow-hidden flex items-center sm:items-center justify-center px-3 sm:px-6 pt-6 pb-6 sm:py-10 bg-slate-50 dark:bg-[#0f141a]">
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
      {/* ✅ Reduzido o max-width no mobile para ficar mais elegante */}
      <div className="relative z-10 w-full max-w-[420px] sm:max-w-md">
        <div className="rounded-2xl border border-white/20 bg-white/85 backdrop-blur-xl shadow-2xl dark:bg-[#161b22]/80 dark:border-white/10 overflow-hidden">
          {/* Header */}
          {/* ✅ Ajuste do pt-5 para a logo ficar mais próxima do topo no mobile */}
          <div className="px-5 sm:px-8 pt-5 sm:pt-8 pb-3 sm:pb-6 text-center">
            <div className="flex items-center justify-center">
              {/* ✅ Logo levemente menor no mobile (h-9) */}
              <img
                src="/brand/logo-full-light.png"
                alt="UniGestor"
                className="h-9 sm:h-10 w-auto select-none"
                draggable={false}
              />
            </div>

            <h1 className="mt-4 text-xl sm:text-2xl font-semibold text-slate-800 dark:text-white">
              {title}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-white/60">
              {subtitle}
            </p>
          </div>

        {/* Tabs */}
          <div className="px-5 sm:px-8">
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
          <div className="px-5 sm:px-8 pt-4 sm:pt-5 pb-4 sm:pb-6">
            {mode === "login" ? (
              <form action={formAction} className="space-y-3 sm:space-y-3">
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
                  <div className="relative mt-1">
                    <input
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      /* ✅ pr-12 adicionado para o texto não ficar por baixo do ícone */
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/60 dark:border-white/10 dark:bg-black/20 dark:text-white dark:placeholder:text-white/40"
                    />
                    
                    {/* Botão do Olho com SVG Inline */}
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:text-white/40 dark:hover:text-white/80 transition-colors"
                      tabIndex={-1} // Impede que o 'Tab' pare no olho, indo direto para o Entrar
                    >
                      {showPassword ? (
                        /* Ícone de olho riscado (Ocultar) */
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        /* Ícone de olho aberto (Mostrar) */
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* === VALIDADOR HUMANO CLOUDFLARE === */}
                <div className="flex justify-center pt-2">
                  <Turnstile 
                    siteKey="0x4AAAAAACgrYURZlknhmi-J" 
                    onSuccess={(token) => setTurnstileToken(token)}
                    onError={() => setTurnstileToken(null)}
                    onExpire={() => setTurnstileToken(null)}
                  />
                  {/* O input oculto envia o token para a Server Action capturar com formData.get('cf-turnstile-response') */}
                  <input type="hidden" name="cf-turnstile-response" value={turnstileToken || ""} />
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit || pending || failedAttempts >= 3}
                  className={[
                    "w-full rounded-xl py-3 font-semibold transition",
                    !canSubmit || pending || failedAttempts >= 3
                      ? "bg-slate-300 text-white cursor-not-allowed dark:bg-white/15"
                      : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
                  ].join(" ")}
                >
                  {pending ? "Aguarde..." : failedAttempts >= 3 ? "Acesso Bloqueado" : "Entrar"}
                </button>

                {/* Mensagem de Erro ou Bloqueio */}
                {failedAttempts >= 3 ? (
                  <div className="mt-2 flex flex-col items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 text-center">
                    <span>Acesso bloqueado por segurança após 3 tentativas inválidas.</span>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("reset");
                        setFailedAttempts(0); // Zera as tentativas para dar uma nova chance se ele voltar
                        setMsg(null);
                      }}
                      className="font-semibold underline hover:text-red-900 dark:hover:text-red-300 transition-colors"
                    >
                      Redefinir minha senha
                    </button>
                  </div>
                ) : state?.error ? (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:border-white/10 dark:bg-black/20 dark:text-white/80">
                    {state.error}
                  </div>
                ) : null}
              </form>
            ) : (
              <form onSubmit={onReset} className="space-y-3">
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

                {/* === VALIDADOR HUMANO CLOUDFLARE === */}
                <div className="flex justify-center pt-2">
                  <Turnstile 
                    siteKey="0x4AAAAAACgrYURZlknhmi-J" 
                    onSuccess={(token) => setTurnstileToken(token)}
                    onError={() => setTurnstileToken(null)}
                    onExpire={() => setTurnstileToken(null)}
                  />
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit || isResetting}
                  className={[
                    "w-full rounded-xl py-3 font-semibold transition",
                    !canSubmit || isResetting
                      ? "bg-slate-300 text-white cursor-not-allowed dark:bg-white/15"
                      : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
                  ].join(" ")}
                >
                  {isResetting ? "Enviando..." : "Enviar link"}
                </button>

                {msg && (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:border-white/10 dark:bg-black/20 dark:text-white/80">
                    {msg}
                  </div>
                )}
              </form>
            )}

            {/* Rodapé mínimo */}
            {/* ✅ Subiu um pouco no celular */}
            <div className="mt-4 sm:mt-6 text-center text-[10px] sm:text-xs text-white/70">
              <span className="inline-block rounded-full bg-black/20 px-3 py-1">
                UniGestor © {new Date().getFullYear()}
              </span>
            </div>
          </div>
        </div>

        {/* Hint de segurança */}
        {/* ✅ Subiu e ficou um pouco mais discreto */}
        <div className="mt-3 sm:mt-5 text-center text-[10px] sm:text-xs text-white/70">
          Acesso protegido • Use seu e-mail cadastrado
        </div>
      </div>
    </div>
  );
}
