// app/api/client-portal/apps/add/route.ts
// Bloco 3 do portal ("Meus aplicativos") — adiciona um app do catálogo do
// tenant à conta do cliente. Cria a linha client_apps vazia; o cliente
// preenche os campos e chama /configure separadamente (mesmo fluxo em 2
// passos do admin: adicionar → preencher → Configurar).
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeStr(v: unknown) {
  return String(v ?? "").trim();
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);
    const app_id = normalizeStr(body?.app_id);

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    if (!app_id) return jsonError("app_id é obrigatório", 400);

    // Confirma que o cliente ainda não tem esse app instalado
    const { data: existing } = await supabaseAdmin
      .from("client_apps")
      .select("id")
      .eq("client_id", client_id)
      .eq("app_id", app_id)
      .maybeSingle();
    if (existing) return jsonError("Esse aplicativo já está instalado nessa conta.", 409);

    // Confirma que o app pertence ao catálogo do tenant e é compatível com
    // a tecnologia da conta (mesma trava de apps.technology/device_types)
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("technology")
      .eq("id", client_id)
      .single();

    const { data: app, error: appErr } = await supabaseAdmin
      .from("apps")
      .select("id, name, technology")
      .eq("id", app_id)
      .eq("tenant_id", ctx.tenant_id)
      .maybeSingle();

    if (appErr || !app) return jsonError("Aplicativo não encontrado", 404);
    if (client?.technology && app.technology && client.technology !== app.technology) {
      return jsonError("Esse aplicativo não é compatível com a tecnologia dessa conta.", 400);
    }

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("client_apps")
      .insert({ client_id, tenant_id: ctx.tenant_id, app_id, field_values: {} })
      .select("id")
      .single();

    if (insertErr || !inserted) return jsonError("Erro interno", 500);

    return NextResponse.json({ ok: true, data: { id: inserted.id } }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
