"use client";

import { useEffect, useState, useMemo, useActionState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { Turnstile } from '@marsidev/react-turnstile';
// 👇 ATENÇÃO: Ajuste este caminho para onde está o seu arquivo actions.ts do login oficial
import { loginAction, type LoginState } from "@/app/login/actions"; 
import { supabaseBrowser } from "@/lib/supabase/browser";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function isLikelyEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export default function TenantLoginPage() {
  const params = useParams();
  const slug = params.slug as string;

  // --- ESTADOS DO TENANT ---
  const [tenantData, setTenantData] = useState<any>(null);
  const [loadingTenant, setLoadingTenant] = useState(true);

  // --- ESTADOS DE SEGURANÇA E LOGIN (Iguais ao oficial) ---
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0); 
  const [showPassword, setShowPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  const initialState: LoginState = {};
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  // --- CARREGA OS DADOS DO CLIENTE ---
  useEffect(() => {
    async function loadTenantBrand() {
      if (!slug) return;
      
      const { data, error } = await supabaseBrowser
        .from("tenants")
        // ✅ Buscando os novos campos de texto
        .select("id, name, logo_url, primary_color, banner_urls, login_title, login_subtitle")
        .eq("slug", slug)
        .maybeSingle();

      if (data) setTenantData(data);
      setLoadingTenant(false);
    }
    loadTenantBrand();
  }, [slug]);

  // --- MONITORA FALHAS DE LOGIN ---
  useEffect(() => {
    if (!pending && state?.error) {
      setFailedAttempts((prev) => prev + 1);
    }
  }, [pending, state?.error]);

  // ✅ INJETA O TÍTULO E O FAVICON DINAMICAMENTE
  useEffect(() => {
    if (tenantData) {
      // Usa o slug (formatado) se quiser, ou o name
      const displayName = tenantData.name && tenantData.name !== "Academia" ? tenantData.name : slug.toUpperCase();
      document.title = `UniGestor | ${displayName}`;

      // Força a atualização do Favicon removendo os antigos e adicionando o novo
      if (tenantData.logo_url) {
        const links = document.querySelectorAll("link[rel~='icon']");
        links.forEach(link => link.remove()); // Remove favicons existentes
        
        const link = document.createElement('link');
        link.rel = 'icon';
        link.href = tenantData.logo_url;
        document.head.appendChild(link);
      }
    }
  }, [tenantData, slug]);

  const canSubmit = useMemo(() => {
    if (!isLikelyEmail(email)) return false;
    if (mode === "reset") return true;
    if (failedAttempts >= 3) return false;
    return password.length >= 6 && turnstileToken !== null;
  }, [email, password, mode, turnstileToken, failedAttempts]);

  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setIsResetting(true);

    try {
      const safeEmail = email.trim().toLowerCase();
      if (!isLikelyEmail(safeEmail)) {
        setMsg("Informe um e-mail válido.");
        setIsResetting(false);
        return;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(safeEmail, {
        redirectTo: `${location.origin}/reset-password`,
      });
      if (error) throw error;
      setMsg("Se o e-mail existir em nossa base, você receberá um link de redefinição em instantes.");
    } catch (err: unknown) {
      setMsg("Se o e-mail existir em nossa base, você receberá um link de redefinição em instantes.");
    } finally {
      setIsResetting(false);
    }
  }

  // --- TELAS DE CARREGAMENTO / ERRO ---
  if (loadingTenant) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0b1015] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!tenantData) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0b1015] flex flex-col items-center justify-center px-4">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Página não encontrada</h2>
        <p className="text-slate-500 dark:text-zinc-400 text-sm">Verifique o endereço de acesso e tente novamente.</p>
      </div>
    );
  }

  // --- VARIÁVEIS VISUAIS DO CLIENTE ---
  const brandColor = tenantData.primary_color || "#10b981";
  const backgroundMedia = tenantData.banner_urls && tenantData.banner_urls.length > 0 ? tenantData.banner_urls[0] : null;
  const isVideo = backgroundMedia ? (backgroundMedia.includes('.mp4') || backgroundMedia.includes('.webm')) : false;
  
  // Textos customizados ou Fallbacks padrão
  const customTitle = tenantData.login_title || "Supere seus limites.";
  const customSubtitle = tenantData.login_subtitle || "Acesse sua área exclusiva para acompanhar seu progresso e gerenciar sua conta.";

  return (
    <div className="min-h-[100dvh] flex bg-white dark:bg-[#0b1015] selection:text-white" style={{ '--theme-color': brandColor } as React.CSSProperties}>
      
      {/* ==========================================
          LADO ESQUERDO: Mídia Customizada
      ========================================== */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-[#0b1015] overflow-hidden items-end">
        
        {/* Mídia de Fundo */}
        {isVideo && backgroundMedia ? (
          <video autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover opacity-70" src={backgroundMedia} />
        ) : backgroundMedia ? (
          <img src={backgroundMedia} alt={tenantData.name} className="absolute inset-0 w-full h-full object-cover opacity-70" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
             <span className="text-slate-700 text-8xl">🚀</span>
          </div>
        )}

        {/* ✅ A MÁGICA DA LEITURA: Gradiente que escurece apenas a parte de baixo + Blur suave */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b1015] via-[#0b1015]/60 to-transparent" />
        
        <div className="relative z-10 p-16 max-w-2xl text-white">
          <div className="backdrop-blur-sm bg-black/10 p-6 rounded-2xl border border-white/5">
            <h2 className="text-4xl lg:text-5xl font-black mb-4 leading-tight">
              {customTitle}
            </h2>
            <p className="text-lg text-white/80 font-medium">
              {customSubtitle}
            </p>
          </div>
        </div>
      </div>

      {/* ==========================================
          LADO DIREITO: O Formulário Seguro (Com Visual Premium)
      ========================================== */}
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 sm:p-12 relative z-10 bg-slate-50 dark:bg-[#0f141a] overflow-hidden">
        
        {/* Fundo com textura suave e brilho discreto */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Luz superior bem mais suave */}
          <div 
            className="absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full blur-[100px] opacity-[0.06] dark:opacity-[0.05]" 
            style={{ backgroundColor: brandColor }}
          />
          {/* Luz inferior bem mais suave */}
          <div 
            className="absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full blur-[100px] opacity-[0.06] dark:opacity-[0.05]" 
            style={{ backgroundColor: brandColor }}
          />
          {/* Grain leve (padrão do login principal) */}
          <div
            className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.4'/%3E%3C/svg%3E\")",
            }}
          />
        </div>

        {/* ✅ Wrapper do Formulário (Efeito Glassmorphism) */}
        <div className="relative z-10 w-full max-w-[420px] rounded-2xl border border-white/40 bg-white/80 backdrop-blur-2xl shadow-2xl shadow-black/[0.03] dark:bg-[#161b22]/80 dark:border-white/10 p-6 sm:p-8">
          
          {/* Cabeçalho do Form */}
          <div className="flex flex-col items-center mb-6 text-center">
            {tenantData.logo_url ? (
              <img src={tenantData.logo_url} alt={tenantData.name} className="h-20 object-contain mb-5 drop-shadow-md" />
            ) : (
              <div 
                className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-bold text-white mb-5 shadow-lg"
                style={{ backgroundColor: brandColor }}
              >
                {tenantData.name.charAt(0).toUpperCase()}
              </div>
            )}
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {mode === "reset" ? "Redefinir Senha" : "Acesso ao Portal"}
            </h1>
            <p className="text-sm font-bold mt-1 uppercase tracking-widest" style={{ color: brandColor }}>
               {tenantData.name && tenantData.name !== "Academia" ? tenantData.name : slug}
            </p>
          </div>

          {/* Abas Login / Reset */}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-black/20 mb-6">
            <button
              type="button"
              onClick={() => { setMsg(null); setMode("login"); }}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                mode === "login" ? "bg-white shadow text-slate-900 dark:bg-[#0f141a] dark:text-white" : "text-slate-600 hover:text-slate-800 dark:text-white/70 dark:hover:text-white"
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => { setMsg(null); setMode("reset"); }}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                mode === "reset" ? "bg-white shadow text-slate-900 dark:bg-[#0f141a] dark:text-white" : "text-slate-600 hover:text-slate-800 dark:text-white/70 dark:hover:text-white"
              }`}
            >
              Esqueci a senha
            </button>
          </div>

          {/* === FORMULÁRIO === */}
          {mode === "login" ? (
            <form action={formAction} className="space-y-4">
              {/* E-mail */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-white/80 mb-1">
                  E-mail
                </label>
                <input
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocusedInput('email')}
                  onBlur={() => setFocusedInput(null)}
                  placeholder="voce@exemplo.com"
                  autoComplete="email"
                  inputMode="email"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition shadow-sm dark:border-white/10 dark:bg-black/20 dark:text-white dark:placeholder:text-white/40"
                  style={{ 
                    borderColor: focusedInput === 'email' ? brandColor : undefined,
                    boxShadow: focusedInput === 'email' ? `0 0 0 2px ${brandColor}40` : undefined
                  }}
                />
              </div>

              {/* Senha */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-white/80 mb-1">
                  Senha
                </label>
                <div className="relative">
                  <input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocusedInput('password')}
                    onBlur={() => setFocusedInput(null)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-slate-900 outline-none transition shadow-sm dark:border-white/10 dark:bg-black/20 dark:text-white dark:placeholder:text-white/40"
                    style={{ 
                      borderColor: focusedInput === 'password' ? brandColor : undefined,
                      boxShadow: focusedInput === 'password' ? `0 0 0 2px ${brandColor}40` : undefined
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:text-white/40 dark:hover:text-white/80 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Turnstile */}
              <div className="flex justify-center pt-2">
                <Turnstile 
                  siteKey="0x4AAAAAACgrYURZlknhmi-J" 
                  onSuccess={(token) => setTurnstileToken(token)}
                  onError={() => setTurnstileToken(null)}
                  onExpire={() => setTurnstileToken(null)}
                />
                <input type="hidden" name="cf-turnstile-response" value={turnstileToken || ""} />
              </div>

              {/* Botão de Submit Dinâmico */}
              <button
                type="submit"
                disabled={!canSubmit || pending || failedAttempts >= 3}
                className="w-full h-12 mt-2 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none hover:-translate-y-0.5"
                style={{ 
                  backgroundColor: (!canSubmit || pending || failedAttempts >= 3) ? '#94a3b8' : brandColor,
                  boxShadow: (!canSubmit || pending || failedAttempts >= 3) ? 'none' : `0 8px 20px -6px ${brandColor}80`
                }}
              >
                {pending ? "Autenticando..." : failedAttempts >= 3 ? "Acesso Bloqueado" : "Entrar no Portal"}
              </button>

              {/* Erros */}
              {failedAttempts >= 3 ? (
                <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 text-center">
                  <span>Acesso bloqueado por segurança após 3 tentativas inválidas.</span>
                  <button type="button" onClick={() => { setMode("reset"); setFailedAttempts(0); setMsg(null); }} className="font-bold underline hover:opacity-80">
                    Redefinir minha senha
                  </button>
                </div>
              ) : state?.error ? (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400 text-center font-medium">
                  {state.error}
                </div>
              ) : null}
            </form>
          ) : (
            <form onSubmit={onReset} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-white/80 mb-1">
                  E-mail Cadastrado
                </label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocusedInput('reset')}
                  onBlur={() => setFocusedInput(null)}
                  placeholder="voce@exemplo.com"
                  autoComplete="email"
                  inputMode="email"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition shadow-sm dark:border-white/10 dark:bg-black/20 dark:text-white dark:placeholder:text-white/40"
                  style={{ 
                    borderColor: focusedInput === 'reset' ? brandColor : undefined,
                    boxShadow: focusedInput === 'reset' ? `0 0 0 2px ${brandColor}40` : undefined
                  }}
                />
              </div>

              <div className="flex justify-center pt-2">
                <Turnstile siteKey="0x4AAAAAACgrYURZlknhmi-J" onSuccess={setTurnstileToken} onError={() => setTurnstileToken(null)} onExpire={() => setTurnstileToken(null)} />
              </div>

              <button
                type="submit"
                disabled={!canSubmit || isResetting}
                className="w-full h-12 mt-2 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5"
                style={{ 
                  backgroundColor: (!canSubmit || isResetting) ? '#94a3b8' : brandColor,
                  boxShadow: (!canSubmit || isResetting) ? 'none' : `0 8px 20px -6px ${brandColor}80`
                }}
              >
                {isResetting ? "Enviando..." : "Enviar link de recuperação"}
              </button>

              {msg && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-white/80 text-center font-medium">
                  {msg}
                </div>
              )}
            </form>
          )}

          {/* Rodapé Tech (Dentro do Card) */}
          <div className="mt-8 pt-6 border-t border-slate-200/60 dark:border-white/10 text-center flex flex-col items-center justify-center gap-1.5">
            <span className="uppercase tracking-widest font-bold text-[9px] text-slate-400 dark:text-white/30">
              Tecnologia por
            </span>
            <img 
              src="/brand/logo-full-light.png" 
              alt="UniGestor" 
              className="h-5 drop-shadow-sm transition-all hover:scale-105" 
            />
          </div>

        </div> {/* Fim do Wrapper do Formulário */}
        
        {/* Aviso de Segurança Flutuante no Rodapé */}
        <div className="absolute bottom-6 text-center text-[10px] sm:text-xs text-slate-400 dark:text-white/40">
          Acesso protegido • Sistema em conformidade com a LGPD
        </div>

      </div> {/* Fim do Lado Direito */}
    </div>
  );
}