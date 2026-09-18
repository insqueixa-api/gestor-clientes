"use client";
// app/reset-password/page.tsx

import { useState, useEffect } from "react";
import { supabaseBrowser as supabase } from "@/lib/supabase/browser";

// ✅ Usa o MESMO client (supabaseBrowser, @supabase/ssr) que a tela de login
// usa pra pedir o reset (resetPasswordForEmail). Antes esta página criava um
// client @supabase/supabase-js "puro" à parte, com flowType padrão
// "implicit" — só que o link de recuperação gerado pelo supabaseBrowser é
// PKCE (createBrowserClient fixa flowType:"pkce"), chegando aqui como
// `?code=...`. Um client em modo implicit não sabe processar esse formato:
// a troca do código pela sessão nunca acontecia, e a página sempre mostrava
// "Link Inválido" mesmo num link recém-clicado (achado em 11/08/2026).
// Com o mesmo client (PKCE + detectSessionInUrl, ambos default no
// createBrowserClient), a troca do `?code=` pela sessão acontece sozinha
// durante a inicialização, antes do primeiro getSession() resolver — não
// precisa chamar exchangeCodeForSession manualmente.

// ✅ 18/09/2026, pedido do Márcio (auditoria de segurança): mínimo 8
// caracteres + maiúscula + minúscula + número + caractere especial — mesma
// política já configurada no lado do Supabase (password_min_length/
// password_required_characters). Mostrado aqui como checklist que vai
// ficando verde enquanto a pessoa digita, pra não descobrir só depois de
// tentar salvar.
const PASSWORD_RULES: { label: string; test: (pw: string) => boolean }[] = [
  { label: "Pelo menos 8 caracteres", test: (pw) => pw.length >= 8 },
  { label: "1 letra maiúscula", test: (pw) => /[A-Z]/.test(pw) },
  { label: "1 letra minúscula", test: (pw) => /[a-z]/.test(pw) },
  { label: "1 número", test: (pw) => /[0-9]/.test(pw) },
  { label: "1 caractere especial (!@#$%...)", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const passwordChecks = PASSWORD_RULES.map((rule) => ({ ...rule, ok: rule.test(password) }));
  const passwordValid = passwordChecks.every((c) => c.ok);
  const passwordsMatch = passwordConfirm.length > 0 && password === passwordConfirm;

  // Estados de validação do link
  const [isValidating, setIsValidating] = useState(true);
  const [hasValidSession, setHasValidSession] = useState(false);

  // 🔴 18/09/2026: quem tem MFA ativado precisa de sessão aal2 pra trocar a
  // senha (o próprio Supabase recusa com "AAL2 session is required..." se
  // não tiver) — o link de recuperação por e-mail só dá aal1. Antes de
  // mostrar o formulário de nova senha, checa se falta esse 2º fator e, se
  // faltar, pede o código do app autenticador aqui mesmo (com a mesma
  // opção de recuperação via WhatsApp/e-mail do login, pro caso de ter
  // perdido o acesso ao autenticador também).
  const [needsMfa, setNeedsMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

  const [showRecovery, setShowRecovery] = useState(false);
  const [recoverySent, setRecoverySent] = useState<"whatsapp" | "email" | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryMsg, setRecoveryMsg] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryDone, setRecoveryDone] = useState(false);

  // Verifica se a URL contém uma sessão válida de recuperação + se falta MFA
  useEffect(() => {
    async function checkSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      // Além da sessão nula, verifica se a URL retornou erro do Supabase (ex: token expirado)
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const hasErrorInUrl =
        hash.includes("error_code") || hash.includes("error_description");

      if (!session || hasErrorInUrl) {
        setHasValidSession(false);
        setIsValidating(false);
        return;
      }

      setHasValidSession(true);

      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        setNeedsMfa(true);
      }

      setIsValidating(false);
    }

    checkSession();
  }, []);

  async function handleVerifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (mfaCode.length !== 6) return;
    setMfaBusy(true);
    setMfaError(null);
    try {
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const factor = factorsData?.totp?.[0];
      if (!factor) throw new Error("Nenhum fator MFA encontrado.");

      const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challengeErr) throw challengeErr;

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code: mfaCode,
      });
      if (verifyErr) throw verifyErr;

      // ✅ Sessão atual acabou de subir pra aal2 — segue direto pro
      // formulário de nova senha, sem precisar de outro link/redirect.
      setNeedsMfa(false);
    } catch {
      setMfaError("Código inválido. Confira o app autenticador e tente de novo.");
      setMfaCode("");
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleRequestRecovery(channel: "whatsapp" | "email") {
    setMfaBusy(true);
    setRecoveryError(null);
    setRecoveryMsg(null);
    try {
      const res = await fetch("/api/auth/mfa-recovery/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json?.error === "rate_limited") setRecoveryError("Aguarde 1 minuto antes de pedir outro código.");
        else if (json?.error === "whatsapp_unavailable") setRecoveryError("Não consegui enviar pelo WhatsApp agora. Tente por e-mail.");
        else setRecoveryError("Não consegui enviar o código. Tente de novo em instantes.");
        return;
      }
      setRecoverySent(channel);
      setRecoveryMsg(channel === "whatsapp" ? "Código enviado pro seu WhatsApp." : "Código enviado pro seu e-mail.");
    } catch {
      setRecoveryError("Falha de conexão. Tente de novo.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleVerifyRecovery(e: React.FormEvent) {
    e.preventDefault();
    if (recoveryCode.length !== 6) return;
    setMfaBusy(true);
    setRecoveryError(null);
    try {
      const res = await fetch("/api/auth/mfa-recovery/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: recoveryCode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json?.error === "expired_or_missing") setRecoveryError("Código expirado. Peça um novo.");
        else if (json?.error === "too_many_attempts") setRecoveryError("Muitas tentativas erradas. Peça um novo código.");
        else setRecoveryError("Código incorreto.");
        return;
      }
      // ✅ Apagar o fator MFA derruba TODAS as sessões, inclusive esta
      // sessão de recuperação que este próprio link criou — não dá pra
      // seguir direto pro formulário de senha, precisa de um link novo.
      setRecoveryDone(true);
    } catch {
      setRecoveryError("Falha de conexão. Tente de novo.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErrorMsg(null);

    if (!passwordValid) {
      setErrorMsg("A senha ainda não atende todos os critérios abaixo.");
      return;
    }
    if (!passwordsMatch) {
      setErrorMsg("As senhas digitadas não são iguais.");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) throw error;

      // ✅ 18/09/2026, pedido do Márcio: trocar a senha precisa derrubar
      // qualquer outra sessão ativa (outro navegador/dispositivo já
      // logado) — sem isso, quem trocou a senha por suspeita de acesso
      // indevido continuaria exposto em qualquer sessão que já estivesse
      // aberta em outro lugar. scope:"global" invalida TODOS os refresh
      // tokens do usuário no servidor (inclusive este aqui, mas já vamos
      // redirecionar pro login de qualquer forma). Best-effort: a senha já
      // foi trocada com sucesso, não desfaz isso se o signOut falhar.
      try {
        await supabase.auth.signOut({ scope: "global" });
      } catch {
        // não bloqueia a mensagem de sucesso por causa disso
      }

      setMsg("Senha atualizada com sucesso! Todas as outras sessões foram encerradas. Redirecionando para o login...");

      setTimeout(() => {
        // Redirecionamento absoluto para o endereço correto
        window.location.href = `${window.location.origin}/login`;
      }, 2000);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Erro ao atualizar a senha.",
      );
    } finally {
      setLoading(false);
    }
  }

  // Tela de carregamento enquanto valida o token
  if (isValidating) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="text-muted-foreground animate-pulse">
          Validando link de segurança...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] relative overflow-hidden flex items-center sm:items-center justify-center px-3 sm:px-6 pt-6 pb-6 sm:py-10 bg-background">
      {/* Fundo com gradiente + glow */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0b2a4a] via-[#0f141a] to-[#0e6b5c] opacity-90 dark:opacity-100" />
<div className="absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full bg-sky-500/20 blur-3xl" />
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
          <div className="px-5 sm:px-8 pt-5 sm:pt-8 pb-3 sm:pb-6 text-center">
            <div className="flex items-center justify-center">
              <img
                src="/brand/logo-full-light.png"
                alt="UniGestor"
                className="h-9 sm:h-10 w-auto select-none"
                draggable={false}
              />
            </div>

            {!hasValidSession ? (
              <>
                <h1 className="mt-4 text-xl sm:text-2xl font-semibold text-rose-500">
                  Link Inválido
                </h1>
                <p className="mt-2 text-sm text-foreground/70">
                  Este link de recuperação expirou ou já foi utilizado. Por
                  questões de segurança, solicite um novo acesso.
                </p>
              </>
            ) : recoveryDone ? (
              <>
                <h1 className="mt-4 text-xl sm:text-2xl font-semibold text-foreground">
                  MFA desativado
                </h1>
                <p className="mt-2 text-sm text-foreground/70">
                  Esse link de recuperação não vale mais. Solicite um novo pra definir a nova senha.
                </p>
              </>
            ) : needsMfa ? (
              <>
                <h1 className="mt-4 text-xl sm:text-2xl font-semibold text-foreground">
                  Verificação em 2 etapas
                </h1>
                <p className="mt-1 text-sm text-foreground/70">
                  Sua conta tem MFA ativado — confirme o código antes de trocar a senha.
                </p>
              </>
            ) : (
              <>
                <h1 className="mt-4 text-xl sm:text-2xl font-semibold text-foreground">
                  Nova Senha
                </h1>
                <p className="mt-1 text-sm text-foreground/70">
                  Digite a sua nova senha de acesso.
                </p>
              </>
            )}
          </div>

          <div className="px-5 sm:px-8 pt-2 pb-6 sm:pb-8">
            {!hasValidSession ? (
              <button
                onClick={() =>
                  (window.location.href = `${window.location.origin}/login`)
                }
                className="w-full rounded-xl py-3 font-semibold transition bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Voltar ao Login
              </button>
            ) : recoveryDone ? (
              <button
                onClick={() =>
                  (window.location.href = `${window.location.origin}/login`)
                }
                className="w-full rounded-xl py-3 font-semibold transition bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Voltar ao Login
              </button>
            ) : needsMfa ? (
              !showRecovery ? (
                <>
                  <form onSubmit={handleVerifyMfa} className="space-y-3">
                    <input
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      inputMode="numeric"
                      autoFocus
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-center text-2xl tracking-[0.5em] text-foreground outline-none focus:ring-2 focus:ring-emerald-500/60 dark:bg-black/20 dark:text-white"
                    />
                    <button
                      type="submit"
                      disabled={mfaCode.length !== 6 || mfaBusy}
                      className={[
                        "w-full rounded-xl py-3 font-semibold transition",
                        mfaCode.length !== 6 || mfaBusy
                          ? "bg-muted text-muted-foreground cursor-not-allowed"
                          : "bg-emerald-600 text-white hover:bg-emerald-700",
                      ].join(" ")}
                    >
                      {mfaBusy ? "Verificando..." : "Verificar"}
                    </button>
                    {mfaError && (
                      <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-500 text-center">
                        {mfaError}
                      </div>
                    )}
                  </form>

                  <button
                    onClick={() => setShowRecovery(true)}
                    className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Perdi o acesso ao app autenticador
                  </button>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-foreground/80 text-center">
                    Vamos mandar um código alternativo pro seu contato já cadastrado — isso vai <strong>desativar o MFA</strong> depois de confirmado.
                  </p>

                  {!recoverySent ? (
                    <div className="flex gap-2">
                      <button
                        disabled={mfaBusy}
                        onClick={() => handleRequestRecovery("whatsapp")}
                        className="flex-1 rounded-xl border border-border bg-card py-2.5 text-sm font-medium text-foreground hover:bg-muted transition dark:bg-black/20 dark:text-white disabled:opacity-50"
                      >
                        📱 WhatsApp
                      </button>
                      <button
                        disabled={mfaBusy}
                        onClick={() => handleRequestRecovery("email")}
                        className="flex-1 rounded-xl border border-border bg-card py-2.5 text-sm font-medium text-foreground hover:bg-muted transition dark:bg-black/20 dark:text-white disabled:opacity-50"
                      >
                        ✉️ E-mail
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleVerifyRecovery} className="space-y-3">
                      <input
                        value={recoveryCode}
                        onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="000000"
                        inputMode="numeric"
                        autoFocus
                        className="w-full rounded-xl border border-border bg-card px-4 py-3 text-center text-2xl tracking-[0.5em] text-foreground outline-none focus:ring-2 focus:ring-emerald-500/60 dark:bg-black/20 dark:text-white"
                      />
                      <button
                        type="submit"
                        disabled={recoveryCode.length !== 6 || mfaBusy}
                        className={[
                          "w-full rounded-xl py-3 font-semibold transition",
                          recoveryCode.length !== 6 || mfaBusy
                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                            : "bg-rose-600 text-white hover:bg-rose-700",
                        ].join(" ")}
                      >
                        {mfaBusy ? "Confirmando..." : "Confirmar e desativar MFA"}
                      </button>
                    </form>
                  )}

                  {recoveryMsg && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500 text-center">
                      {recoveryMsg}
                    </div>
                  )}
                  {recoveryError && (
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-500 text-center">
                      {recoveryError}
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setShowRecovery(false);
                      setRecoverySent(null);
                      setRecoveryMsg(null);
                      setRecoveryError(null);
                      setRecoveryCode("");
                    }}
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Voltar
                  </button>
                </div>
              )
            ) : (
<form onSubmit={handleUpdatePassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground">
                    Nova Senha
                  </label>
                  <input
                    name="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Digite a nova senha"
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-xl border border-border bg-card px-4 py-3 text-foreground outline-none transition focus:ring-2 focus:ring-emerald-500/60 dark:border-border dark:bg-black/20 dark:text-white dark:placeholder:text-white/40"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground">
                    Confirmar Senha
                  </label>
                  <input
                    name="passwordConfirm"
                    type="password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    placeholder="Digite a nova senha de novo"
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-xl border border-border bg-card px-4 py-3 text-foreground outline-none transition focus:ring-2 focus:ring-emerald-500/60 dark:border-border dark:bg-black/20 dark:text-white dark:placeholder:text-white/40"
                  />
                  {passwordConfirm.length > 0 && !passwordsMatch && (
                    <p className="mt-1 text-xs text-rose-500">As senhas não coincidem.</p>
                  )}
                </div>

                {/* ✅ Checklist ao vivo — cada critério fica verde assim que a
                    senha digitada o atende, sem esperar tentar salvar. */}
                <ul className="space-y-1.5">
                  {passwordChecks.map((check) => (
                    <li
                      key={check.label}
                      className={[
                        "flex items-center gap-2 text-xs transition-colors",
                        check.ok ? "text-emerald-500" : "text-muted-foreground dark:text-white/50",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]",
                          check.ok
                            ? "border-emerald-500 bg-emerald-500/20 text-emerald-500"
                            : "border-muted-foreground/30 dark:border-white/20",
                        ].join(" ")}
                      >
                        {check.ok ? "✓" : ""}
                      </span>
                      {check.label}
                    </li>
                  ))}
                </ul>

                <button
                  type="submit"
                  disabled={loading || !passwordValid || !passwordsMatch}
                  className={[
                    "w-full rounded-xl py-3 font-semibold transition mt-2",
                    loading || !passwordValid || !passwordsMatch
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
                  ].join(" ")}
                >
                  {loading ? "Atualizando..." : "Salvar nova senha"}
                </button>

                {msg && (
                  <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500 text-center font-medium">
                    {msg}
                  </div>
                )}

                {errorMsg && (
                  <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-500 text-center font-medium">
                    {errorMsg}
                  </div>
                )}
              </form>
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
