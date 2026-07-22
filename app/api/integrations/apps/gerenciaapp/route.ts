// app/api/integrations/apps/gerenciaapp/route.ts
// Ponte fina: autentica o usuário, busca as credenciais do painel (app_integrations)
// e repassa pra VM, que executa o login+create/delete de verdade saindo pelo
// proxy residencial (GERENCIAAPP_PROXY_URL, configurado só na VM). Migrado da
// extensão de navegador — mesma lógica, mesmos endpoints do gerenciaapp.top.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (hasBadInternalHeader(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const internal = isInternalRequest(req);

    let supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdmin>;
    if (internal) {
      supabase = createAdmin(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
    } else {
      supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const { action, base_url } = body;

    if (!action || (action !== "create" && action !== "delete" && action !== "check")) {
      return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete | check" }, { status: 400 });
    }
    if (!base_url) {
      return NextResponse.json({ ok: false, error: "base_url é obrigatório." }, { status: 400 });
    }

    const { data: integ, error: integErr } = await supabase
      .from("app_integrations")
      .select("login_email, login_password")
      .eq("app_name", "GERENCIAAPP")
      .eq("is_active", true)
      .maybeSingle();

    if (integErr || !integ?.login_email || !integ?.login_password) {
      return NextResponse.json(
        { ok: false, error: "Credenciais do GerenciaApp não configuradas (Configurações → Integrações)." },
        { status: 400 }
      );
    }

    const waBaseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
    const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
    if (!waBaseUrl || !waToken) {
      return NextResponse.json({ ok: false, error: "Server misconfigured (VM)." }, { status: 500 });
    }

    const vmPath =
      action === "create" ? "/gerenciaapp/create" : action === "check" ? "/gerenciaapp/check" : "/gerenciaapp/delete";
    const vmBody =
      action === "create"
        ? {
            baseUrl: base_url,
            email: integ.login_email,
            password: integ.login_password,
            payload: body, // já vem no formato esperado (mac_device, server_name, username_login, ...)
          }
        : {
            baseUrl: base_url,
            email: integ.login_email,
            password: integ.login_password,
            searchName: body.username,
            macDevice: body.macValue,
          };

    const vmRes = await fetch(`${waBaseUrl}${vmPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${waToken}`,
      },
      body: JSON.stringify(vmBody),
    });
    const vmJson = await vmRes.json().catch(() => ({}));
    return NextResponse.json(vmJson, { status: vmRes.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno." }, { status: 500 });
  }
}
