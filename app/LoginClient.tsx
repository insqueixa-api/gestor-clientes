"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Msg = { text: string; type: "error" | "success" };

function formatWhatsApp(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  
  if (digits.startsWith('55') && digits.length >= 12) {
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

export default function LoginClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const token = useMemo(() => (sp.get("t") ?? "").trim(), [sp]);

  const [whatsapp, setWhatsapp] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<Msg | null>(null);

  const [loadingResolve, setLoadingResolve] = useState(false);
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);

  const cleanPhone = useMemo(() => whatsapp.replace(/\D/g, ""), [whatsapp]);

  const canSubmit = useMemo(() => {
    return token.length > 10 && cleanPhone.length >= 10 && pin.length === 4;
  }, [token, cleanPhone, pin]);

  useEffect(() => {
    let cancelled = false;

    async function resolveToken() {
      setMsg(null);

      if (!token) {
        setWhatsapp("");
        setMsg({ type: "error", text: "Link inválido. Solicite um novo link ao suporte." });
        return;
      }

      setLoadingResolve(true);
      try {
        const { data, error } = await supabase.rpc("portal_resolve_token", { p_token: token });

        if (cancelled) return;

        if (error) {
          setMsg({ type: "error", text: "Link inválido ou expirado. Solicite um novo link." });
          setWhatsapp("");
          return;
        }

        const row = Array.isArray(data) ? data[0] : null;
        if (!row?.whatsapp_username) {
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
      const { data, error } = await supabase.rpc("portal_start_session", {
        p_token: token,
        p_pin: pin,
      });

      if (error) {
        setMsg({ type: "error", text: "PIN incorreto. Tente novamente." });
        return;
      }

      const row = Array.isArray(data) ? data[0] : null;
      const sessionToken = row?.session_token;

      if (!sessionToken) {
        setMsg({ type: "error", text: "Não foi possível iniciar a sessão. Tente novamente." });
        return;
      }

      // ✅ REDIRECIONA PARA /renew APÓS LOGIN
      router.push(`/renew?session=${encodeURIComponent(sessionToken)}`);
    } catch {
      setMsg({ type: "error", text: "Erro ao acessar. Tente novamente." });
    } finally {
      setLoadingLogin(false);
    }
  }

  async function handleEsqueciPin() {
    setMsg(null);

    if (!token) {
      setMsg({ type: "error", text: "Link inválido. Solicite um novo link ao suporte." });
      return;
    }

    setLoadingReset(true);
    try {
      await supabase.rpc("portal_request_pin_reset", { p_token: token });

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
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4 sm:px-6 py-10 bg-slate-50 dark:bg-[#0f141a]">
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

      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-3xl border border-white/20 bg-white/85 backdrop-blur-xl shadow-2xl dark:bg-[#161b22]/80 dark:border-white/10 overflow-hidden">
          <div className="px-6 sm:px-8 pt-9 pb-6 text-center">
            <div className="flex items-center justify-center">
              <img src="/brand/logo-full-light.png" alt="UniGestor" className="h-11 w-auto select-none" />
            </div>
            <h1 className="mt-6 text-2xl font-bold text-slate-800 dark:text-white uppercase tracking-tight">
              Área do Cliente
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-white/60">
              Acesse seus dados e renove seus planos com segurança.
            </p>
          </div>

          <div className="px-6 sm:px-8 pb-10">
            <form onSubmit={handleAcesso} className="space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 ml-1">
                  Seu WhatsApp
                </label>

                <div className="mt-1 relative">
                  <input
                    type="text"
                    value={formatWhatsApp(whatsapp)}
                    readOnly
                    placeholder={loadingResolve ? "Validando link..." : "—"}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-center font-bold text-lg text-slate-900 outline-none transition
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
                  Esse número vem do link. Se estiver errado, solicite um novo link.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 ml-1">
                  PIN (4 dígitos)
                </label>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  type="password"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-center text-2xl tracking-[0.5em]
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

              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={!canSubmit || loadingResolve || loadingLogin}
                  className={`w-full rounded-2xl py-4 font-bold text-lg transition shadow-lg ${
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
                  disabled={loadingReset || loadingResolve || !token}
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

            <div className="mt-8 text-center">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-white/30 bg-black/10 dark:bg-white/5 px-4 py-1.5 rounded-full border border-white/5">
                Conexão Criptografada
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}