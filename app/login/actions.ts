// app/login/actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getAdminTenantContext } from "@/lib/api/auth-server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export type LoginState = { error?: string };

function isNextRedirectError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;

  const obj = err as Record<string, unknown>;
  const digest = obj["digest"];
  const message = obj["message"];

  return (
    (typeof digest === "string" && digest.includes("NEXT_REDIRECT")) ||
    (typeof message === "string" && message.includes("NEXT_REDIRECT"))
  );
}

// 🔴 18/09/2026, pedido do Márcio (auditoria de segurança): bloqueia o IP
// por um tempo depois de várias senhas erradas seguidas — antes só existia
// o Turnstile (freia bot automatizado), nada travava alguém insistindo com
// senhas erradas manualmente ou por script já "humanizado". Tabela própria
// (admin_login_attempts) porque a Vercel roda em serverless — não dá pra
// guardar contador em memória entre invocações.
const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutos

function adminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function getClientIp(): Promise<string> {
  const hdrs = await headers();
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  try {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    if (!email) return { error: "Informe o e-mail." };
    if (!password || password.length < 6) return { error: "Informe uma senha válida." };

    const ip = await getClientIp();
    const supabaseAdmin = adminSupabase();

    const { data: attemptRow } = await supabaseAdmin
      .from("admin_login_attempts")
      .select("failed_count, blocked_until")
      .eq("ip", ip)
      .maybeSingle();

    if (attemptRow?.blocked_until && new Date(attemptRow.blocked_until).getTime() > Date.now()) {
      return { error: "Muitas tentativas de login sem sucesso. Tente novamente em alguns minutos." };
    }

    // ✅ Validar Turnstile server-side
    const cfToken = String(formData.get("cf-turnstile-response") ?? "").trim();
    if (!cfToken) return { error: "Verificação de segurança necessária." };

    const turnstileSecret = String(process.env.TURNSTILE_SECRET_KEY ?? "").trim();
    if (turnstileSecret) {
      const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: turnstileSecret, response: cfToken }).toString(),
      });
      const verifyJson = await verifyRes.json().catch(() => ({} as any));
      if (!verifyJson?.success) return { error: "Verificação de segurança falhou. Tente novamente." };
    }

    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user || !data.session) {
      // ✅ Registra a falha — ao bater MAX_FAILED_ATTEMPTS, bloqueia o IP
      // por BLOCK_DURATION_MS e zera a contagem (próxima janela começa do
      // zero depois que o bloqueio expirar). Best-effort: nunca deixa uma
      // falha aqui esconder o erro de autenticação real do usuário.
      try {
        const newCount = (attemptRow?.failed_count || 0) + 1;
        const shouldBlock = newCount >= MAX_FAILED_ATTEMPTS;
        await supabaseAdmin.from("admin_login_attempts").upsert(
          {
            ip,
            failed_count: shouldBlock ? 0 : newCount,
            blocked_until: shouldBlock ? new Date(Date.now() + BLOCK_DURATION_MS).toISOString() : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "ip" },
        );
      } catch (e: any) {
        console.error("[login] falha ao registrar tentativa", e?.message);
      }
      return { error: error?.message || "Erro de autenticação" };
    }

    // ✅ Login certo — zera a contagem desse IP (best-effort).
    try {
      await supabaseAdmin.from("admin_login_attempts").delete().eq("ip", ip);
    } catch {
      // não bloqueia o login por causa disso
    }

    // 🔴 18/09/2026: MFA (TOTP) opcional — email+senha corretos só dão
    // sessão aal1. Quem tem um fator MFA verificado precisa completar o
    // 2º passo em /mfa-challenge antes de ver o /admin (o proxy.ts também
    // reforça isso pra quem tentar pular direto pra uma URL /admin).
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      redirect("/mfa-challenge");
    }

    // ✅ Resolve e cacheia o contexto admin (tenant/role/nomes) num cookie
    // agora — o layout do admin só vai LER esse cookie depois, sem bater
    // em tenant_members/tenants/profiles em toda navegação (ver
    // lib/api/auth-server.ts). Não bloqueia o login se falhar por algum
    // motivo: o layout recai pra consultar o banco normalmente nesse caso.
    await getAdminTenantContext();

    // ✅ Atualização de tenant_fx_rates saiu daqui — agora é a rota de cron
    // app/api/fx/sync (1x de madrugada), não mais disparada a cada login.
    // ✅ Redireciona imediatamente
    redirect("/admin");
  } catch (err: unknown) {
    // ✅ Se for redirect, re-lança para o Next finalizar a navegação
    if (isNextRedirectError(err)) {
      throw err;
    }

    const msg = err instanceof Error ? err.message : "Falha inesperada no servidor.";
    return { error: msg };
  }
}