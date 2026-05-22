"use client";

import { useState, useActionState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { loginAction, type LoginState } from "./actions";
import { Turnstile } from '@marsidev/react-turnstile';

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);
  const [errorReset, setErrorReset] = useState("");
  const [success, setSuccess] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const initialState: LoginState = {};
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setErrorReset("");
    setSuccess("");
    setLoadingReset(true);

    const { error: resetError } = await supabaseBrowser.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/reset-password` }
    );

    setLoadingReset(false);

    if (resetError) {
      setErrorReset(resetError.message);
      return;
    }

    setSuccess("Link de recuperação enviado! Verifique sua caixa de entrada.");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a1118] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-800 via-[#0a1118] to-black p-4 relative overflow-hidden">
      
      {/* Luzes de fundo para o efeito premium */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        
        {/* Card Cinza Claro (Alinhado com o Client) */}
        <div className="bg-[#eef2f6] dark:bg-[#161b22] border border-white/50 dark:border-white/10 rounded-2xl shadow-2xl p-8">

          {/* Logo Interna */}
          <div className="text-center mb-6">
            <img
              src="/brand/logo-gestor.png"
              alt="Logo"
              className="h-10 mx-auto object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>

          {/* === LOGIN === */}
          {mode === "login" && (
            <form action={formAction} className="space-y-4">
              <div className="text-center mb-6">
                <h1 className="text-lg font-black text-slate-800 dark:text-white tracking-tight uppercase">Área do Administrador</h1>
                <p className="text-[11px] text-slate-500 dark:text-white/50 mt-1 font-medium">Acesso restrito ao painel de gestão</p>
              </div>

              {/* Email */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">E-mail</label>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full h-12 px-4 bg-white dark:bg-black/40 border border-transparent dark:border-white/10 rounded-xl text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all text-slate-800 dark:text-white placeholder:text-slate-400 shadow-sm"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Senha</label>
                <div className="relative">
                  <input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-12 px-4 pr-11 bg-white dark:bg-black/40 border border-transparent dark:border-white/10 rounded-xl text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all text-slate-800 dark:text-white placeholder:text-slate-400 shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
                  >
                    {showPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Turnstile Oculto ou Visível */}
              <div className="flex justify-center pt-2">
                <Turnstile 
                  siteKey="0x4AAAAAACgrYURZlknhmi-J" 
                  onSuccess={(token) => setTurnstileToken(token)}
                  onError={() => setTurnstileToken(null)}
                  onExpire={() => setTurnstileToken(null)}
                />
                <input type="hidden" name="cf-turnstile-response" value={turnstileToken || ""} />
              </div>

              {/* Error da Action */}
              {state?.error && (
                <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs font-medium p-3 rounded-lg flex items-start gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 mt-0.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{state.error}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={pending || !turnstileToken}
                className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-emerald-900/20 transition-all inline-flex items-center justify-center gap-2 mt-2"
              >
                {pending ? (
                  <>
                    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                    </svg>
                    Entrando...
                  </>
                ) : "Entrar"}
              </button>

              {/* Esqueci senha */}
              <button
                type="button"
                onClick={() => { setMode("reset"); setErrorReset(""); setSuccess(""); setPassword(""); }}
                className="block w-full text-center text-[11px] font-bold text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors pt-2"
              >
                Esqueci minha senha
              </button>
            </form>
          )}

          {/* === RESET PASSWORD === */}
          {mode === "reset" && (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="text-center mb-6">
                <h1 className="text-lg font-black text-slate-800 dark:text-white tracking-tight uppercase">Recuperar senha</h1>
                <p className="text-[11px] text-slate-500 dark:text-white/50 mt-1 font-medium">Enviaremos um link de redefinição</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">E-mail</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full h-12 px-4 bg-white dark:bg-black/40 border border-transparent dark:border-white/10 rounded-xl text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all text-slate-800 dark:text-white placeholder:text-slate-400 shadow-sm"
                />
              </div>

              {errorReset && (
                <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs font-medium p-3 rounded-lg flex items-start gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 mt-0.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{errorReset}</span>
                </div>
              )}

              {success && (
                <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-medium p-3 rounded-lg flex items-start gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 mt-0.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{success}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loadingReset}
                className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-emerald-900/20 transition-all inline-flex items-center justify-center gap-2 mt-2"
              >
                {loadingReset ? "Enviando..." : "Enviar link"}
              </button>

              <button
                type="button"
                onClick={() => { setMode("login"); setErrorReset(""); setSuccess(""); }}
                className="block w-full text-center text-[11px] font-bold text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors pt-2"
              >
                ← Voltar para login
              </button>
            </form>
          )}

          {/* Footer Interno (Tecnologia) */}
          <div className="mt-8 pt-5 border-t border-slate-200 dark:border-white/10 text-center">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Tecnologia por</p>
            <img src="/brand/logo-gestor.png" alt="UniGestor" className="h-4 mx-auto object-contain opacity-50 grayscale" />
          </div>

        </div>

        {/* Footer Externo */}
        <p className="text-center text-[10px] text-white/30 mt-6 uppercase tracking-widest font-bold">
          © {new Date().getFullYear()} • Todos os direitos reservados
        </p>

      </div>
    </div>
  );
}