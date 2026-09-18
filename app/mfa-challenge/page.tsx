"use client";
// app/mfa-challenge/page.tsx
//
// 🔴 18/09/2026: passo 2 do login quando o admin tem MFA (TOTP) ativado —
// só chega aqui depois de email+senha corretos (sessão aal1 já existe).
// Pede o código do app autenticador; se não tiver mais acesso a ele, o
// bloco "Perdi o acesso" manda um código alternativo por WhatsApp/e-mail
// (sempre pro contato JÁ cadastrado) que desativa o MFA — ver
// app/api/auth/mfa-recovery/{request,verify}/route.ts.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function MfaChallengePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showRecovery, setShowRecovery] = useState(false);
  const [recoverySent, setRecoverySent] = useState<"whatsapp" | "email" | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryMsg, setRecoveryMsg] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      const { data } = await supabaseBrowser.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!data) {
        router.replace("/login");
        return;
      }
      // Já em aal2 (ou sem MFA nenhum) — não tem o que desafiar aqui.
      if (data.nextLevel !== "aal2" || data.currentLevel === "aal2") {
        router.replace("/admin");
        return;
      }
      setChecking(false);
    }
    check();
  }, [router]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const { data: factorsData } = await supabaseBrowser.auth.mfa.listFactors();
      const factor = factorsData?.totp?.[0];
      if (!factor) throw new Error("Nenhum fator MFA encontrado.");

      const { data: challenge, error: challengeErr } = await supabaseBrowser.auth.mfa.challenge({ factorId: factor.id });
      if (challengeErr) throw challengeErr;

      const { error: verifyErr } = await supabaseBrowser.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code,
      });
      if (verifyErr) throw verifyErr;

      router.replace("/admin");
    } catch (err: any) {
      setError("Código inválido. Confira o app autenticador e tente de novo.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestRecovery(channel: "whatsapp" | "email") {
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function handleVerifyRecovery(e: React.FormEvent) {
    e.preventDefault();
    if (recoveryCode.length !== 6) return;
    setBusy(true);
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
      // ✅ deleteFactor derruba todas as sessões — precisa logar de novo.
      await supabaseBrowser.auth.signOut().catch(() => {});
      window.location.href = "/login?mfa_disabled=1";
    } catch {
      setRecoveryError("Falha de conexão. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="text-muted-foreground animate-pulse">Verificando sessão...</div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] relative overflow-hidden flex items-center justify-center px-3 sm:px-6 py-10 bg-background">
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0b2a4a] via-[#0f141a] to-[#0e6b5c] opacity-90 dark:opacity-100" />
        <div className="absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full bg-sky-500/20 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-[420px]">
        <div className="rounded-2xl border border-white/20 bg-card/80 backdrop-blur-xl shadow-2xl overflow-hidden">
          <div className="px-6 pt-6 pb-3 text-center">
            <h1 className="text-xl font-semibold text-foreground">Verificação em 2 etapas</h1>
            <p className="mt-1 text-sm text-foreground/70">Digite o código do seu app autenticador.</p>
          </div>

          <div className="px-6 pb-6">
            {!showRecovery ? (
              <>
                <form onSubmit={handleVerify} className="space-y-3">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                    autoFocus
                    className="w-full rounded-xl border border-border bg-card px-4 py-3 text-center text-2xl tracking-[0.5em] text-foreground outline-none focus:ring-2 focus:ring-emerald-500/60 dark:bg-black/20 dark:text-white"
                  />
                  <button
                    type="submit"
                    disabled={code.length !== 6 || busy}
                    className={[
                      "w-full rounded-xl py-3 font-semibold transition",
                      code.length !== 6 || busy
                        ? "bg-muted text-muted-foreground cursor-not-allowed"
                        : "bg-emerald-600 text-white hover:bg-emerald-700",
                    ].join(" ")}
                  >
                    {busy ? "Verificando..." : "Verificar"}
                  </button>
                  {error && (
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-500 text-center">
                      {error}
                    </div>
                  )}
                </form>

                <button
                  onClick={() => setShowRecovery(true)}
                  className="mt-4 w-full text-center text-xs text-white/60 hover:text-white/90 underline"
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
                      disabled={busy}
                      onClick={() => handleRequestRecovery("whatsapp")}
                      className="flex-1 rounded-xl border border-border bg-card py-2.5 text-sm font-medium text-foreground hover:bg-muted transition dark:bg-black/20 dark:text-white disabled:opacity-50"
                    >
                      📱 WhatsApp
                    </button>
                    <button
                      disabled={busy}
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
                      disabled={recoveryCode.length !== 6 || busy}
                      className={[
                        "w-full rounded-xl py-3 font-semibold transition",
                        recoveryCode.length !== 6 || busy
                          ? "bg-muted text-muted-foreground cursor-not-allowed"
                          : "bg-rose-600 text-white hover:bg-rose-700",
                      ].join(" ")}
                    >
                      {busy ? "Confirmando..." : "Confirmar e desativar MFA"}
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
                  className="w-full text-center text-xs text-white/60 hover:text-white/90 underline"
                >
                  Voltar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
