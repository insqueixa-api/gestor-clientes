"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createBgClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export type LoginState = { error?: string };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

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

async function fetchFx(
  base: "USD" | "EUR",
  to: "BRL",
  origin: string
): Promise<{ rate: number; date: string }> {
  const url = `${origin}/api/fx?base=${encodeURIComponent(
    base
  )}&to=${encodeURIComponent(to)}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FX API falhou (${res.status})`);

  const json: unknown = await res.json();

  if (typeof json !== "object" || json === null) {
    throw new Error("Resposta inválida da API FX");
  }

  const obj = json as Record<string, unknown>;
  const rate = obj["rate"];
  const date = obj["date"];

  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("Resposta inválida da API FX (rate)");
  }

  return {
    rate,
    date: typeof date === "string" && date.length > 0 ? date : todayISO(),
  };
}

async function refreshFxIfNeeded(
  token: string,
  userId: string,
  origin: string
): Promise<void> {
  try {
    // ✅ Usa o client do supabase-js (sem cookies) para evitar crash no Next.js após o redirect
    const supabaseBg = createBgClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
      }
    );

    const { data: member, error: memberErr } = await supabaseBg
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", userId)
      .single();

    if (memberErr || !member) return;

    const tenantId = member.tenant_id;
    const today = todayISO();

    const { data: existingFx, error: fxErr } = await supabaseBg
      .from("tenant_fx_rates")
      .select("as_of_date")
      .eq("tenant_id", tenantId)
      .eq("as_of_date", today)
      .limit(1);

    if (fxErr) return;
    if (existingFx && existingFx.length > 0) return;

    const [usd, eur] = await Promise.all([
      fetchFx("USD", "BRL", origin),
      fetchFx("EUR", "BRL", origin),
    ]);

    const { error: rpcErr } = await supabaseBg.rpc("set_tenant_fx_rates", {
      p_tenant_id: tenantId,
      p_usd_to_brl: usd.rate,
      p_eur_to_brl: eur.rate,
      p_as_of_date: today,
      p_source: "frankfurter",
    });

    if (rpcErr) console.warn("[FX] RPC falhou:", rpcErr.message);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[FX] Refresh falhou (best effort):", msg);
  }
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

    // ✅ Obtém origin, token e userID ANTES do background task e do redirect
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = `${proto}://${host}`;
    
    const token = data.session.access_token;
    const userId = data.user.id;

    // ✅ Dispara o background task sem 'await' (Fire and Forget seguro)
    refreshFxIfNeeded(token, userId, origin).catch((err) =>
      console.warn("[FX BG Error]", err)
    );

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