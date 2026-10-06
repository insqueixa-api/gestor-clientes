// app/api/client-portal/get-prices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
// validatePortalClient já estende a sessão (touchPortalSession via after())
import { validatePortalClient } from "@/lib/client-portal/session";

export const dynamic = "force-dynamic";

function makeSupabaseAdmin() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!supabaseUrl || !serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}


const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

// ✅ Log estruturado — sempre ativo (antes o corpo do "if" era vazio e
// silenciava todo erro desta rota mesmo em produção).
function safeServerLog(...args: any[]) {
  console.error("[get-prices]", ...args);
}

function normalizeStr(v: unknown) {
  return String(v ?? "").trim();
}

function isPlausibleSessionToken(t: string) {
  if (t.length < 16 || t.length > 256) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      safeServerLog("get-prices: Server misconfigured");
      console.error("[get-prices: Server misconfigured]", { kind: "client_portal_error", route: "get-prices" });
      return NextResponse.json(
        { ok: false, error: "Erro interno" },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);


    if (!session_token || !client_id) {
      return jsonError("Parâmetros incompletos", 400);
    }

    if (!isPlausibleSessionToken(session_token)) {
      return jsonError("Sessão inválida", 401);
    }

    if (!isUuid(client_id)) {
      return jsonError("Cliente não encontrado", 404);
    }

    // 1. Validar sessão + "esse client_id é dessa sessão" (titular,
    // secundário ou âncora de telefone — docs/sql/portal_phone_anchor_hybrid_identity.sql)
    // numa ida só ao banco (validatePortalClient → portal_validate_client).
    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) {
      safeServerLog("get-prices: invalid session or client not owned");
      return jsonError("Sessão inválida", 401);
    }
    const tenantId = ctx.tenant_id;

    // ✅ 06/10/2026 (auditoria de performance, pedido do Márcio): eram até 8
    // idas ao banco em sequência. Agora, depois da validação, UMA consulta:
    // o cliente já vem com a tabela DELE (+ itens e preços) e a integração
    // do servidor.
    const PRICE_TREE = "id, tenant_id, is_active, plan_table_items(period, plan_table_item_prices(screens_count, price_amount))";
    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select(
        `screens, plan_label, price_amount, price_currency, plan_table_id, server_id,
         plan_tables(${PRICE_TREE}),
         servers(server_integrations(provider))`,
      )
      .eq("id", client_id)
      .eq("tenant_id", tenantId)
      .single();

    if (clientErr || !client) {
      safeServerLog("get-prices: client not found or not owned");
      return jsonError("Cliente não encontrado", 404);
    }

    // 3. SEMPRE a tabela do próprio cliente (do mesmo tenant e ativa).
    // ✅ 06/10/2026, pedido do Márcio: SEM fallback pra tabela padrão — antes
    // uma tabela inválida/inativa caía em silêncio na padrão BRL e o cliente
    // via (e pagava) preço de outra tabela. Agora recusa e loga.
    const table = (client as any).plan_tables as any;
    const tableValid = !!table && table.tenant_id === tenantId && table.is_active === true;
    if (!tableValid) {
      safeServerLog("get-prices: client price table missing/inactive", { client_id });
      console.error("[get-prices: client price table missing/inactive]", { kind: "client_portal_error", route: "get-prices", tenant_id: tenantId, client_id });
      return jsonError("Tabela de preços da conta não configurada. Fale com o suporte.", 409);
    }

    // 4. Preços da tabela (vieram junto)
    const priceData = Array.isArray((table as any).plan_table_items) ? (table as any).plan_table_items : [];

    // 5. Processar preços (Sem multiplicações)
    const prices = (priceData || [])
      .map((item: any) => {
        let price = 0;

        // Regra 1: Se é o plano atual do cliente e ele tem um preço fixado (Override), usamos ele.
        if (client.price_amount > 0 && PERIOD_LABELS[item.period] === client.plan_label) {
          price = client.price_amount;
        } 
        // Regra 2: Busca ESTRITAMENTE o valor para esta quantidade de telas na tabela
        else {
          const exact = item.plan_table_item_prices?.find(
            (p: any) => p.screens_count === client.screens
          );
          
          if (exact && exact.price_amount != null) {
            price = exact.price_amount;
          }
        }

        return {
          period: item.period,
          price_amount: Number(price),
        };
      })
      // Só devolve para a tela os planos que realmente têm preço configurado
      .filter((p: any) => p.price_amount > 0);

      

// 6. Descobrir se é Elite para aplicar a trava
    // (integração do servidor veio junto com o cliente)
    const isElite =
      String((client as any).servers?.server_integrations?.provider || "").toUpperCase() === "ELITE";

    // 7. Ordenar por período e TRAVAR O ANUAL (SÓ PARA ELITE)
    const ORDER = ["MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];
    prices.sort((a, b) => ORDER.indexOf(a.period) - ORDER.indexOf(b.period));

    // ✅ TRAVA INTELIGENTE: Remove o 'ANNUAL' SÓ se for ELITE
    const safePrices = isElite ? prices.filter((p: any) => p.period !== "ANNUAL") : prices;

    return NextResponse.json(
      {
        ok: true,
        data: safePrices, 
        currency: client.price_currency || "BRL",
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err: any) {
    safeServerLog("get-prices: unexpected error", err?.message);
    console.error("[client_portal_error:get-prices]", { message: err?.message, kind: "client_portal_error", route: "get-prices" });
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
