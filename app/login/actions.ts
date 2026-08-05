// app/login/actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminTenantContext } from "@/lib/api/auth-server";
import { redirect } from "next/navigation";

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

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  try {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    if (!email) return { error: "Informe o e-mail." };
    if (!password || password.length < 6) return { error: "Informe uma senha válida." };

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
      return { error: error?.message || "Erro de autenticação" };
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