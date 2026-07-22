// app/api/client-portal/apps/catalog/route.ts
// Lista de apps do catálogo do tenant que o cliente ainda PODE adicionar —
// filtrado por tecnologia da conta (IPTV/P2P) e excluindo os já instalados.
// Alimenta o picker "+ Adicionar aplicativo" do Bloco 3.
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

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("technology")
      .eq("id", client_id)
      .single();

    const { data: installed } = await supabaseAdmin
      .from("client_apps")
      .select("app_id")
      .eq("client_id", client_id);
    const installedIds = new Set((installed || []).map((r: any) => r.app_id));

    let query = supabaseAdmin
      .from("apps")
      .select("id, name, icon_url, technology, device_types")
      .eq("tenant_id", ctx.tenant_id)
      .order("name", { ascending: true });

    if (client?.technology) query = query.eq("technology", client.technology);

    const { data: apps, error: appsErr } = await query;
    if (appsErr) return jsonError("Erro interno", 500);

    const available = (apps || []).filter((a: any) => !installedIds.has(a.id));

    return NextResponse.json({ ok: true, data: available }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
