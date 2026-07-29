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

    // ✅ Paralelizado (pedido do Márcio, 26/07/2026, lentidão sentida ao
    // adicionar app) — client e apps são independentes (o filtro por
    // technology, que dependia do client, virou filtro em JS logo abaixo em
    // vez de condição no .eq() — troca 2 round-trips sequenciais por 1).
    const [{ data: client }, { data: apps, error: appsErr }] = await Promise.all([
      supabaseAdmin.from("clients").select("technology, server_id").eq("id", client_id).single(),
      // ✅ Descontinuado (is_active=false) continua na lista de propósito
      // (pedido do Marcio, 25/07/2026) — sumir faria quem já usa não achar o
      // app pra saber que precisa trocar. O aviso aparece só ao tentar
      // adicionar (bloqueado em /apps/add, defesa em profundidade).
      supabaseAdmin
        .from("apps")
        .select("id, name, icon_url, technology, device_types, integration_type, cost_type, partner_server_id, license_price, license_period, is_active, discontinued_replacement_name")
        .eq("tenant_id", ctx.tenant_id)
        .order("name", { ascending: true }),
    ]);
    if (appsErr) return jsonError("Erro interno", 500);

    // ✅ Voltado atrás em 26/07/2026 (pedido do Márcio, achado em teste real):
    // apps com integração useApi:false (ex: IBOSOL, bloqueio Cloudflare)
    // eram excluídos DAQUI inteiros ("IBO Player" sumia do catálogo, mesmo
    // sendo um app pago normal) — mas isso é desnecessário, porque
    // has_integration (list/route.ts) já reflete useApi corretamente e faz o
    // card cair pra "Solicitar configuração" em vez de prometer automação.
    // Bloquear aqui só escondia um app válido sem nenhum ganho real.
    // ✅ Preço da licença exposto aqui de propósito (achado: cliente só
    // descobria que o app era pago DEPOIS de já ter adicionado e
    // configurado — o catálogo nunca mandava cost_type/license_price).
    const available = (apps || [])
      .filter((a: any) => !client?.technology || a.technology === client.technology)
      // ✅ App "parceria" só aparece pro cliente do SERVIDOR parceiro certo
      // (pedido do Marcio, 26/07/2026) — o custo já vem embutido no plano
      // DAQUELE servidor específico; oferecer pra cliente de outro servidor
      // mostraria um app "grátis" que na prática ele não tem direito a usar.
      .filter((a: any) => a.cost_type !== "partnership" || (a.partner_server_id && a.partner_server_id === client?.server_id))
      .map(({ integration_type, partner_server_id, cost_type, license_price, license_period, ...rest }: any) => {
        // ✅ Mesmo cálculo do has_integration em list/route.ts — sinaliza no
        // picker (ícone ⚡, pedido do Márcio 26/07/2026) quais apps ativam
        // sozinhos vs. precisam de configuração manual pelo suporte.
        const handler = integration_type ? getIntegrationHandler(integration_type) : null;
        return {
          ...rest,
          cost_type: cost_type || null,
          license_price: cost_type === "paid" && Number(license_price) > 0 ? Number(license_price) : null,
          license_period: cost_type === "paid" ? license_period || null : null,
          has_integration: !!handler && (handler as any).useApi,
        };
      });

    return NextResponse.json({ ok: true, data: available }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
