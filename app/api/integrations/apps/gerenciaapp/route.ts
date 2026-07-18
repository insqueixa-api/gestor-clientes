// app/api/integrations/apps/gerenciaapp/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action, base_url, deviceKey, ...payload } = body;

    if (action !== "create" && action !== "delete") {
      return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete" }, { status: 400 });
    }

    // ✅ Credenciais do painel vêm do banco (nunca do front) — o base_url que o
    // modal manda é só informativo/legado, a fonte da verdade é app_integrations.
    const { data: integ, error: integErr } = await supabase
      .from("app_integrations")
      .select("api_url, login_email, login_password")
      .eq("app_name", "GERENCIAAPP")
      .maybeSingle();

    if (integErr || !integ?.api_url || !integ?.login_email || !integ?.login_password) {
      return NextResponse.json({ ok: false, error: "Integração GerenciaApp não configurada." }, { status: 500 });
    }

    const waBaseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
    const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
    if (!waBaseUrl || !waToken) {
      return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
    }

    const res = await fetch(`${waBaseUrl}/gerenciaapp/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${waToken}` },
      body: JSON.stringify({
        action,
        api_url: integ.api_url,
        login_email: integ.login_email,
        login_password: integ.login_password,
        ...payload,
      }),
    });

    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Falha ao acionar GerenciaApp" }, { status: 502 });
  }
}
