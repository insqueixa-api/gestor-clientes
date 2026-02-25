"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { Turnstile } from '@marsidev/react-turnstile';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Msg = { text: string; type: "error" | "success" };

function formatWhatsApp(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  if (digits.startsWith("55") && digits.length >= 12) {
    const country = digits.slice(0, 2);
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);

    if (rest.length === 9) {
      return `+${country} (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    }
    if (rest.length === 8) {
      return `+${country} (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    }
  }

  return phone;
}

// ========= BLINDAGEM (SEM TOKEN NA URL) =========
const KEY_LOGIN_TOKEN = "cp_login_token";
const KEY_SESSION = "cp_session";

function getStored(key: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function setStored(key: string, v: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, v);
  } catch {}
}
function clearStored(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {}
}

function removeParamFromUrl(param: string) {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.has(param)) {
      u.searchParams.delete(param);
      window.history.replaceState({}, "", u.pathname + u.search + u.hash);
    }
  } catch {}
}

export default function LoginClient() {
  const router = useRouter();
  const sp = useSearchParams();

  // ✅ token vem da URL OU do sessionStorage, e removemos da URL depois
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
  const fromQuery = (sp.get("t") ?? "").trim();

  // ✅ suporta link mais seguro no futuro: /#t=TOKEN (hash não vai pro servidor)
  let fromHash = "";
  if (typeof window !== "undefined") {
    const h = window.location.hash || "";
    const m = h.match(/(?:^#|[&#])t=([^&]+)/);
    if (m?.[1]) {
      try {
        fromHash = decodeURIComponent(m[1]);
      } catch {
        fromHash = m[1];
      }
    }
  }

  const stored = getStored(KEY_LOGIN_TOKEN);

  const t = fromQuery || fromHash || stored || "";
  if (t) setStored(KEY_LOGIN_TOKEN, t);

  // ✅ remove token da querystring
  if (fromQuery) removeParamFromUrl("t");

  // ✅ remove o hash inteiro (evita token ficar na URL)
  if (fromHash && typeof window !== "undefined") {
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
  }

  setToken(t);
}, [sp]);


  const [whatsapp, setWhatsapp] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<Msg | null>(null);

  const [loadingResolve, setLoadingResolve] = useState(false);
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [loadingReset, setLoadingReset] = useState(false);

  const cleanPhone = useMemo(() => whatsapp.replace(/\D/g, ""), [whatsapp]);

const canSubmit = useMemo(() => {
    // ✅ Agora ele só libera o botão se tiver o token do Cloudflare também
    return (token ?? "").length > 10 && cleanPhone.length >= 10 && pin.length === 4 && turnstileToken !== null;
  }, [token, cleanPhone, pin, turnstileToken]);

  useEffect(() => {
    let cancelled = false;

    async function resolveToken() {
      setMsg(null);

      // ✅ aguarda hidratar token
      if (token === null) return;

      if (!token) {
        clearStored(KEY_LOGIN_TOKEN);
        setWhatsapp("");
        setMsg({ type: "error", text: "Link inválido. Solicite um novo link ao suporte." });
        return;
      }

      setLoadingResolve(true);
      try {
        const { data, error } = await supabase.rpc("portal_resolve_token", { p_token: token });

        if (cancelled) return;

        if (error) {
          clearStored(KEY_LOGIN_TOKEN);
          setMsg({ type: "error", text: "Link inválido ou expirado. Solicite um novo link." });
          setWhatsapp("");
          return;
        }

        const row = Array.isArray(data) ? data[0] : null;
        if (!row?.whatsapp_username) {
          clearStored(KEY_LOGIN_TOKEN);
          setMsg({ type: "error", text: "Link inválido ou expirado. Solicite um novo link." });
          setWhatsapp("");
          return;
        }

        setWhatsapp(String(row.whatsapp_username));
      } catch {
        if (!cancelled) {
          setMsg({ type: "error", text: "Falha ao validar o link. Tente novamente." });
          setWhatsapp("");
        }
      } finally {
        if (!cancelled) setLoadingResolve(false);
      }
    }

    resolveToken();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAcesso(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!canSubmit) {
      setMsg({ type: "error", text: "Preencha o PIN corretamente." });
      return;
    }

    setLoadingLogin(true);
    try {
      const res = await fetch("/api/client-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin, cfToken: turnstileToken }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMsg({ type: "error", text: "PIN incorreto. Tente novamente." });
        return;
      }

      const sessionToken = data?.session_token;

      if (!sessionToken) {
        setMsg({ type: "error", text: "Não foi possível iniciar a sessão. Tente novamente." });
        return;
      }

      // ✅ BLINDADO: guarda sessão e vai pra /renew SEM querystring
      setStored(KEY_SESSION, String(sessionToken));

      // ✅ remove o login token do storage depois do sucesso
      clearStored(KEY_LOGIN_TOKEN);

      router.push(`/renew`);
    } catch {
      setMsg({ type: "error", text: "Erro ao acessar. Tente novamente." });
    } finally {
      setLoadingLogin(false);
    }
  }

  async function handleEsqueciPin() {
    setMsg(null);

    if (token === null) return;

    if (!token) {
      setMsg({ type: "error", text: "Link inválido. Solicite um novo link ao suporte." });
      return;
    }

    setLoadingReset(true);
    try {
      await fetch("/api/client-portal/send-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });


      setMsg({
        type: "success",
        text: "Se este número estiver cadastrado, enviaremos um link de redefinição no WhatsApp.",
      });
    } catch {
      setMsg({
        type: "success",
        text: "Se este número estiver cadastrado, enviaremos um link de redefinição no WhatsApp.",
      });
    } finally {
      setLoadingReset(false);
    }
  }

  const pinHint = useMemo(() => {
    const d = cleanPhone;
    if (d.length >= 4) return d.slice(-4);
    return "";
  }, [cleanPhone]);

  return (
    <div className="min-h-[100dvh] relative overflow-hidden flex items-center sm:items-center justify-center px-3 sm:px-6 pt-6 pb-6 sm:py-10 bg-slate-50">
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
          {/* Reduzido de pt-4 para pt-5 para a logo ficar mais colada em cima */}
          <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4 text-center">
            <div className="flex items-center justify-center">
              <img src="/brand/logo-full-light.png" alt="UniGestor" className="h-9 w-auto select-none" />
            </div>
            <h1 className="mt-4 text-xl font-bold text-slate-800 dark:text-white uppercase tracking-tight">
              Área do Cliente
            </h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-white/60">
              Renovação automática da sua assinatura!
            </p>
          </div>

{/* pb-4 (celular) / pb-6 (pc) */}
          <div className="px-5 sm:px-6 pb-4 sm:pb-6">
            <form onSubmit={handleAcesso} autoComplete="off" className="space-y-3 sm:space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 ml-1">
                  Seu WhatsApp
                </label>

                <div className="mt-1 relative">
                  <input
                    type="text"
                    value={formatWhatsApp(whatsapp)}
                    readOnly
                    autoComplete="off"
                    data-1p-ignore="true" 
                    data-lpignore="true"
                    placeholder={loadingResolve ? "Validando link..." : "—"}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center font-bold text-base text-slate-900 outline-none transition
                      focus:ring-2 focus:ring-emerald-500/60
                      dark:border-white/10 dark:bg-black/40 dark:text-white"
                  />
                  {loadingResolve && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-white/50">
                      ...
                    </div>
                  )}
                </div>

                <p className="mt-2 text-[11px] font-semibold text-slate-500 dark:text-white/50 text-center">
                  Se o número estiver errado, solicite um novo link.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 ml-1">
                  PIN (4 dígitos)
                </label>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  type="tel"
                  autoComplete="off"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  style={{ WebkitTextSecurity: "disc" } as any}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-xl tracking-[0.5em]
                    text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/60
                    dark:border-white/10 dark:bg-black/40 dark:text-white"
                />

                {!!pinHint && (
                  <p className="mt-2 text-[11px] font-semibold text-slate-500 dark:text-white/50 text-center">
                    Dica: PIN inicial costuma ser os últimos 4 dígitos do WhatsApp:{" "}
                    <span className="font-extrabold">{pinHint}</span>
                  </p>
                )}
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


              <div className="space-y-3">
                
<button
                  type="submit"
                  disabled={!canSubmit || loadingResolve || loadingLogin}
                  className={`w-full rounded-xl py-3 font-bold text-base transition shadow-lg ${
                    !canSubmit || loadingResolve || loadingLogin
                      ? "bg-slate-300 text-white cursor-not-allowed dark:bg-white/10"
                      : "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 shadow-emerald-500/20"
                  }`}
                >
                  {loadingLogin ? "Acessando..." : "Acessar Área do Cliente"}
                </button>

                <button
                  type="button"
                  onClick={handleEsqueciPin}
                  disabled={loadingReset || loadingResolve || !(token ?? "")}
                  className="w-full text-xs font-bold text-slate-500 dark:text-emerald-500/70 hover:text-emerald-500 uppercase tracking-widest transition-colors py-2 disabled:opacity-60"
                >
                  {loadingReset ? "Solicitando..." : "Esqueci meu PIN"}
                </button>
              </div>

              {msg && (
                <div className={`mt-2 text-center text-sm font-bold ${msg.type === "error" ? "text-red-500" : "text-emerald-500"}`}>
                  {msg.text}
                </div>
              )}
            </form>

{/* Otimizado o espaço no rodapé */}
            <div className="mt-4 sm:mt-6 text-center">
              <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-white/30 bg-black/10 dark:bg-white/5 px-4 py-1 sm:py-1.5 rounded-full border border-white/5">
                Conexão Criptografada
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
