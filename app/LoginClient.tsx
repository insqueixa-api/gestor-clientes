"use client";
// app/LoginClient.tsx

import React, { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import type { TurnstileInstance } from "@marsidev/react-turnstile";

// ✅ Code-split o widget do Cloudflare pra fora do bundle principal — ele só
// é montado depois que o link mágico é confirmado válido (ver `whatsapp` mais
// abaixo), então não faz sentido baixar o JS dele já no carregamento inicial
// da página, muito menos num link morto (onde a tela nem chega a mostrar o
// formulário).
const Turnstile = dynamic(
  () => import("@marsidev/react-turnstile").then((m) => m.Turnstile),
  { ssr: false },
);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
      window.history.replaceState(
        {},
        "",
        window.location.pathname + window.location.search,
      );
    }

    setToken(t);
  }, [sp]);

  const [whatsapp, setWhatsapp] = useState("");

  const [msg, setMsg] = useState<Msg | null>(null);

  // ✅ Sem isso, um link mágico já usado/expirado deixava o formulário inteiro
  // visível (campo de WhatsApp, captcha, botão "Acessar" desabilitado) com o
  // aviso real escondido numa linha vermelha pequena embaixo — ninguém lia,
  // e o Márcio recebia print reclamando "não funciona" o tempo todo. Assim
  // que resolveToken() confirma que o link não presta mais (token ausente,
  // RPC com erro, ou falha de rede), troca a tela inteira por uma instrução
  // grande e direta, sem formulário nenhum pra distrair.
  const [linkDead, setLinkDead] = useState(false);

  const [loadingResolve, setLoadingResolve] = useState(false);
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  // Ref pra resetar o widget Turnstile após erro (token é usado uma única vez)
  const turnstileRef = useRef<TurnstileInstance>(null);

  const cleanPhone = useMemo(() => whatsapp.replace(/\D/g, ""), [whatsapp]);

  const canSubmit = useMemo(() => {
    // ✅ PIN não é mais exigido — login depende só do token mágico + captcha
    //
    // ✅ `whatsapp` vem resolvido e confiável do backend (portal_resolve_token
    // já validou o token) — esta checagem é só uma blindagem de sanidade, não
    // a segurança de verdade (essa é o token). Antes exigia >=10 dígitos,
    // travando pra sempre quem tiver `whatsapp_username` como um handle de
    // verdade (ex: "insqueixa", sem dígito nenhum) em vez de telefone — o
    // WhatsApp está migrando pra permitir login por username, ver auditoria
    // de 12/08/2026. Aceita telefone (>=10 dígitos) OU um identificador não
    // vazio com tamanho mínimo razoável (mesma regra mínima que o próprio
    // WhatsApp usa pra username: 3 caracteres).
    const looksLikePhone = cleanPhone.length >= 10;
    const looksLikeIdentity = whatsapp.trim().length >= 3;
    return (
      (token ?? "").length > 10 &&
      (looksLikePhone || looksLikeIdentity) &&
      turnstileToken !== null
    );
  }, [token, cleanPhone, whatsapp, turnstileToken]);

  useEffect(() => {
    let cancelled = false;

    async function resolveToken() {
      setMsg(null);

      // ✅ aguarda hidratar token
      if (token === null) return;

      if (!token) {
        clearStored(KEY_LOGIN_TOKEN);
        setWhatsapp("");
        setLinkDead(true);
        return;
      }

      setLoadingResolve(true);
      try {
        const { data, error } = await supabase.rpc("portal_resolve_token", {
          p_token: token,
        });

        if (cancelled) return;

        if (error) {
          clearStored(KEY_LOGIN_TOKEN);
          setWhatsapp("");
          setLinkDead(true);
          return;
        }

        const row = Array.isArray(data) ? data[0] : null;
        if (!row?.whatsapp_username) {
          clearStored(KEY_LOGIN_TOKEN);
          setWhatsapp("");
          setLinkDead(true);
          return;
        }

        setWhatsapp(String(row.whatsapp_username));
      } catch {
        if (!cancelled) {
          setWhatsapp("");
          setLinkDead(true);
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
      setMsg({ type: "error", text: "Aguarde a verificação e tente novamente." });
      return;
    }

    setLoadingLogin(true);
    try {
      const res = await fetch("/api/client-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, cfToken: turnstileToken }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Reseta o Turnstile (token só vale 1x — sem isso a próxima tentativa trava)
        turnstileRef.current?.reset();
        setTurnstileToken(null);
        setMsg({ type: "error", text: "Não foi possível acessar. Tente novamente." });
        return;
      }

      const sessionToken = data?.session_token;

      if (!sessionToken) {
        turnstileRef.current?.reset();
        setTurnstileToken(null);
        setMsg({
          type: "error",
          text: "Não foi possível iniciar a sessão. Tente novamente.",
        });
        return;
      }

      // ✅ BLINDADO: guarda sessão e vai pro destino SEM querystring
      setStored(KEY_SESSION, String(sessionToken));

      // ✅ remove o login token do storage depois do sucesso
      clearStored(KEY_LOGIN_TOKEN);

      window.location.href = "/renew";
    } catch {
      turnstileRef.current?.reset();
      setTurnstileToken(null);
      setMsg({ type: "error", text: "Erro ao acessar. Tente novamente." });
    } finally {
      setLoadingLogin(false);
    }
  }

  return (
    <div className="min-h-[100dvh] relative overflow-hidden flex items-center sm:items-center justify-center px-3 sm:px-6 pt-6 pb-6 sm:py-10 bg-background">
      {/* ✅ DNS/TLS do Cloudflare já resolvido antes do Turnstile ser
          montado de verdade (quando o link é confirmado válido) — o Next
          hoista <link> renderizado em qualquer lugar da árvore pro <head>. */}
      <link rel="preconnect" href="https://challenges.cloudflare.com" />
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0b2a4a] via-[#0f141a] to-[#0e6b5c] opacity-90 dark:opacity-100" />
        <div className="absolute -top-[10%] -right-[10%] h-[40%] w-[40%] rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-[10%] -left-[10%] h-[40%] w-[40%] rounded-full bg-blue-500/20 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.06] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.4'/%3E%3C/svg%3E\")",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-[420px] sm:max-w-md">
        <div className="rounded-2xl border border-white/20 bg-card/80 backdrop-blur-xl shadow-2xl dark:border-border overflow-hidden">
          {/* Reduzido de pt-4 para pt-5 para a logo ficar mais colada em cima */}
          <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4 text-center">
            <div className="flex items-center justify-center">
              <img
                src="/brand/logo-full-light.png"
                alt="UniGestor"
                className="h-9 sm:h-10 w-auto select-none"
                draggable={false}
              />
            </div>
            {!linkDead && (
              <>
                <h1 className="mt-4 text-xl sm:text-2xl font-semibold text-foreground">
                  Área do Cliente
                </h1>
                <p className="mt-1 text-sm text-foreground/70">
                  Renovação automática da sua assinatura.
                </p>
              </>
            )}
          </div>

          {linkDead ? (
            <div className="px-5 sm:px-6 pb-6 sm:pb-8 pt-1 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-8 w-8 text-emerald-500"
                >
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
                </svg>
              </div>
              <h1 className="text-lg sm:text-xl font-bold text-foreground">
                Esta sessão expirou
              </h1>
              <p className="mt-3 text-base sm:text-lg font-bold text-foreground leading-snug">
                Feche esta janela e clique novamente no link do WhatsApp para
                abrir uma nova sessão.
              </p>
              <p className="mt-3 text-xs text-foreground/60">
                Por segurança, cada link só funciona uma vez.
              </p>
            </div>
          ) : (
          /* pb-4 (celular) / pb-6 (pc) */
          <div className="px-5 sm:px-6 pb-4 sm:pb-6">
            <form
              onSubmit={handleAcesso}
              autoComplete="off"
              className="space-y-3 sm:space-y-4"
            >
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground ml-1">
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
                    className="w-full rounded-xl border border-border bg-card px-4 py-3 text-center font-bold text-base text-foreground outline-none transition
                      focus:ring-2 focus:ring-emerald-500/60
                      dark:border-border dark:bg-black/40 dark:text-white"
                  />
                  {loadingResolve && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                      ...
                    </div>
                  )}
                </div>

                <p className="mt-2 text-[11px] font-semibold text-foreground/70 dark:text-white/50 text-center">
                  Se o número estiver errado, solicite um novo link.
                </p>
              </div>

              {/* === VALIDADOR HUMANO CLOUDFLARE ===
                  ✅ Só monta depois que o link mágico foi confirmado válido
                  (whatsapp resolvido) — antes disso não faz sentido gastar a
                  chamada ao script do Cloudflare, já que a validação do token
                  pode ainda terminar em link morto (nesse caso a branch
                  linkDead nem chega a renderizar este formulário). Evita
                  competir por rede/CPU com a chamada que resolve o token,
                  logo no momento mais importante da página. */}
              <div className="flex justify-center pt-2 min-h-[65px] items-center">
                {whatsapp ? (
                  <Turnstile
                    ref={turnstileRef}
                    siteKey="0x4AAAAAACgrYURZlknhmi-J"
                    onSuccess={(token) => setTurnstileToken(token)}
                    onError={() => setTurnstileToken(null)}
                    onExpire={() => setTurnstileToken(null)}
                  />
                ) : (
                  <div className="text-[11px] text-foreground/50">
                    {loadingResolve ? "Validando link..." : ""}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={!canSubmit || loadingResolve || loadingLogin}
                  className={[
                    "w-full rounded-xl py-3 font-semibold transition",
                    !canSubmit || loadingResolve || loadingLogin
                      ? "bg-card/10 text-foreground/50 cursor-not-allowed"
                      : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
                  ].join(" ")}
                >
                  {loadingLogin ? "Acessando..." : "Acessar Área do Cliente"}
                </button>
              </div>

              {msg && (
                <div
                  className={`mt-2 text-center text-sm font-bold ${msg.type === "error" ? "text-red-500" : "text-emerald-500"}`}
                >
                  {msg.text}
                </div>
              )}
            </form>

            {/* Rodapé mínimo */}
            <div className="mt-4 sm:mt-6 text-center text-[10px] sm:text-xs text-white/70">
              <span className="inline-block rounded-full bg-black/20 px-3 py-1">
                UniGestor © {new Date().getFullYear()}
              </span>
            </div>
          </div>
          )}
        </div>

        {/* Hint embaixo do card */}
        <div className="mt-3 sm:mt-5 text-center text-[10px] sm:text-xs text-white/70">
          Acesso protegido • Renovação automática
        </div>

        <div className="mt-2 text-center text-[10px] text-white/40">
          <Link href="/termos-de-uso" className="hover:text-white/70 hover:underline transition">
            Termos de Uso
          </Link>
          {" "}·{" "}
          <Link href="/politica-de-privacidade" className="hover:text-white/70 hover:underline transition">
            Política de Privacidade
          </Link>
        </div>
      </div>
    </div>
  );
}
