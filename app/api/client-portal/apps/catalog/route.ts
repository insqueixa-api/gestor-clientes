// app/api/client-portal/apps/catalog/route.ts
// Lista de apps do catálogo do tenant que o cliente ainda PODE adicionar —
// filtrado por tecnologia da conta (IPTV/P2P). Alimenta o picker "+
// Adicionar aplicativo" do Bloco 3. Mesmo app pode ser adicionado mais de
// uma vez (2 TVs, 2 celulares...) — não exclui os já instalados.
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";

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

    // ✅ Descontinuado (is_active=false) continua na lista de propósito
    // (pedido do Marcio, 25/07/2026) — sumir faria quem já usa não achar o
    // app pra saber que precisa trocar. O aviso aparece só ao tentar
    // adicionar (bloqueado em /apps/add, defesa em profundidade).
    let query = supabaseAdmin
      .from("apps")
      .select("id, name, icon_url, technology, device_types, integration_type, cost_type, license_price, license_period, is_active, discontinued_replacement_name")
      .eq("tenant_id", ctx.tenant_id)
      .order("name", { ascending: true });

    if (client?.technology) query = query.eq("technology", client.technology);

    const { data: apps, error: appsErr } = await query;
    if (appsErr) return jsonError("Erro interno", 500);

    // ✅ Não oferece pra adicionar um app cuja integração está com
    // useApi:false (ex: IBOSOL, bloqueio Cloudflare) — cliente adicionaria
    // esperando automação e o "Reconfigurar" sempre falharia. Apps sem
    // nenhuma integração (integration_type null) continuam disponíveis —
    // esses nunca prometeram automação.
    // ✅ Preço da licença exposto aqui de propósito (achado: cliente só
    // descobria que o app era pago DEPOIS de já ter adicionado e
    // configurado — o catálogo nunca mandava cost_type/license_price).
    const available = (apps || [])
      .filter((a: any) => {
        if (!a.integration_type) return true;
        const handler = getIntegrationHandler(a.integration_type);
        return !!handler && (handler as any).useApi;
      })
      .map(({ integration_type, cost_type, license_price, license_period, ...rest }: any) => ({
        ...rest,
        license_price: cost_type === "paid" && Number(license_price) > 0 ? Number(license_price) : null,
        license_period: cost_type === "paid" ? license_period || null : null,
      }));

    return NextResponse.json({ ok: true, data: available }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
