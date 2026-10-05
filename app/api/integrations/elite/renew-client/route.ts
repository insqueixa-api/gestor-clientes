// app/api/integrations/elite/renew-client/route.ts
// ✅ 05/10/2026: renovação IPTV/P2P pela API oficial do Elite — substitui
// ELITE_RENEW da extensão e libera a renovação automática no portal (antes
// o fulfillment caía em notifyManual pro Elite). Mesmo contrato das rotas
// NaTV/Fast: entra { integration_id, username, external_user_id, technology,
// months }, sai { ok, data: { exp_date_iso, external_user_id } }.
//
// Travas de dinheiro (debita crédito):
// - max_cost = meses × conexões (IPTV) | meses (P2P): se o Elite calcular
//   mais que isso, NADA é cobrado (409) — nunca paga a mais por engano;
// - Idempotency-Key estável por pedido (idempotency_key do chamador, ex: id
//   do pagamento do portal) → repetir a chamada NÃO renova 2x;
// - 202 (needs_review) = Elite não confirmou: volta erro "em conferência",
//   sem tentar de novo com outra chave;
// - API aceita 1–6 meses por vez: 12 meses = 2 renovações de 6 (P2P pede
//   acknowledged_renewal na 2ª dentro de 10 min — tratado abaixo).
//
// ID do cliente: os clientes antigos têm external_user_id do painel velho
// (adminx). O ID certo vem da busca pelo login (exato); se mudou, devolve o
// novo em data.external_user_id e já grava em clients quando client_id vem.
import { NextResponse } from "next/server";
import { resolveEliteCaller } from "@/lib/integrations/elite-auth";
import {
  EliteApiError,
  EliteIntegration,
  EliteTech,
  eliteExpiry,
  eliteFindClientByUsername,
  eliteIdempotencyKey,
  eliteRequest,
  eliteTechOf,
  eliteUnwrap,
  loadEliteIntegration,
} from "@/lib/integrations/elite-api";
import { adminSupabase } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MONTHS_PER_CALL = 6;

function connectionsOf(client: any): number | null {
  const c = eliteUnwrap(client) || {};
  const v = c.connections ?? c.max_connections ?? c.screens ?? c.max_screens ?? null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Acha o cliente no Elite: login exato primeiro, depois o ID salvo. */
async function resolveClient(integ: EliteIntegration, tech: EliteTech, username: string, savedId: string) {
  if (username) {
    const found = await eliteFindClientByUsername(integ, tech, username);
    if (found) return found;
  }
  if (savedId && /^\d+$/.test(savedId)) {
    try {
      const det = await eliteRequest(integ, "GET", `/${tech}/clients/${savedId}`);
      const d = eliteUnwrap(det.data);
      if (d && (d.id ?? d.client_id) != null) return d;
    } catch (e) {
      if (!(e instanceof EliteApiError) || e.status !== 404) throw e;
    }
  }
  return null;
}

function ackIdFrom(data: any): string | number | null {
  const d = data || {};
  return (
    d.acknowledged_renewal ??
    d.renewal_id ??
    d.recent_renewal_id ??
    d.details?.renewal_id ??
    d.details?.acknowledged_renewal ??
    d.error?.renewal_id ??
    d.error?.details?.renewal_id ??
    null
  );
}

async function renewOnce(
  integ: EliteIntegration,
  tech: EliteTech,
  clientId: string,
  months: number,
  maxCost: number,
  idemKey: string,
) {
  const path = `/${tech}/clients/${encodeURIComponent(clientId)}/renew`;
  try {
    return await eliteRequest(integ, "POST", path, {
      body: { months, max_cost: maxCost },
      idempotencyKey: idemKey,
    });
  } catch (e) {
    // P2P: 2ª renovação em < 10 min precisa confirmar com o ID da anterior
    if (tech === "p2p" && e instanceof EliteApiError && e.status === 409) {
      const ack = ackIdFrom(e.data);
      if (ack !== null) {
        return await eliteRequest(integ, "POST", path, {
          body: { months, max_cost: maxCost, acknowledged_renewal: ack },
          idempotencyKey: `${idemKey}-ack`.slice(0, 64),
        });
      }
    }
    throw e;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const integration_id = String(body?.integration_id ?? "").trim();
    if (!integration_id) {
      return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });
    }
    const caller = await resolveEliteCaller(req, body);
    if (!caller) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const months = Math.floor(Number(body?.months));
    if (!Number.isFinite(months) || months < 1 || months > 24) {
      return NextResponse.json({ ok: false, error: "Quantidade de meses inválida." }, { status: 400 });
    }

    const integ = await loadEliteIntegration(integration_id, caller.tenantId);
    const tech = eliteTechOf(body?.technology);
    const username = String(body?.username ?? "").trim();
    const savedId = String(body?.external_user_id ?? "").trim();

    const client = await resolveClient(integ, tech, username, savedId);
    if (!client) {
      throw new EliteApiError(
        `Cliente "${username || savedId}" não encontrado no Elite (${tech.toUpperCase()}). Confira o usuário e a tecnologia do cadastro.`,
        404,
        null,
        null,
      );
    }
    const eliteId = String(client.id ?? client.client_id);

    // Custo máximo autorizado: IPTV = meses × conexões; P2P = 1/mês
    let perMonth = 1;
    if (tech === "iptv") {
      perMonth = connectionsOf(client) ?? Number(body?.screens) ?? 1;
      if (!Number.isFinite(perMonth) || perMonth < 1) perMonth = 1;
    }

    // Chave estável: o chamador manda (portal: id do pagamento) → retry não
    // duplica; sem ela, uma por chamada (admin: o clique é a operação).
    const baseKey = String(body?.idempotency_key ?? "").replace(/[^A-Za-z0-9_-]/g, "");
    const opKey = baseKey.length >= 8 ? `renew-${baseKey}`.slice(0, 56) : eliteIdempotencyKey(`renew-${tech}`).slice(0, 56);

    let remaining = months;
    let part = 0;
    let last: any = null;
    const operationIds: string[] = [];
    while (remaining > 0) {
      const m = Math.min(MAX_MONTHS_PER_CALL, remaining);
      part++;
      let res;
      try {
        res = await renewOnce(integ, tech, eliteId, m, m * perMonth, part === 1 ? opKey : `${opKey}-p${part}`);
      } catch (e) {
        if (part > 1 && e instanceof EliteApiError) {
          e.message = `${months - remaining} mês(es) JÁ foram renovados no Elite, mas a parte seguinte falhou: ${e.message}`;
        }
        throw e;
      }
      if (res.status === 202) {
        throw new EliteApiError(
          `O Elite deixou a renovação em conferência (não confirmou). NÃO renove de novo — confira no painel do Elite${part > 1 ? ` (${months - remaining} mês(es) já renovados antes)` : ""}.`,
          409,
          res.data,
          res.requestId,
        );
      }
      last = eliteUnwrap(res.data);
      const opId = last?.operation_id ?? (res.data as any)?.operation_id;
      if (opId != null) operationIds.push(String(opId));
      remaining -= m;
    }

    // Vencimento novo: da resposta; se não vier, 1 leitura do cliente
    let expIso = eliteExpiry(last);
    if (!expIso) {
      try {
        const det = await eliteRequest(integ, "GET", `/${tech}/clients/${encodeURIComponent(eliteId)}`);
        expIso = eliteExpiry(det.data);
      } catch (e) {
        console.error("[ELITE] renovado, mas falhou ao ler o vencimento", (e as any)?.message);
      }
    }

    // ID do painel novo diferente do salvo → corrige no cadastro
    const clientRowId = String(body?.client_id ?? "").trim();
    if (clientRowId && eliteId !== savedId) {
      const { error } = await adminSupabase()
        .from("clients")
        .update({ external_user_id: eliteId })
        .eq("id", clientRowId)
        .eq("tenant_id", caller.tenantId);
      if (error) console.error("[ELITE] falha ao gravar o ID novo do cliente", error.message);
    }

    return NextResponse.json({
      ok: true,
      data: {
        exp_date_iso: expIso,
        external_user_id: eliteId,
        operation_ids: operationIds,
      },
    });
  } catch (e: any) {
    const status = e instanceof EliteApiError && e.status >= 400 && e.status < 500 ? e.status : 500;
    console.error("[integration_error:elite:renew-client]", {
      message: e?.message,
      status: e?.status,
      requestId: e?.requestId,
      kind: "integration_error",
      provider: "elite",
      action: "renew-client",
    });
    return NextResponse.json({ ok: false, error: e?.message || "Falha ao renovar no Elite." }, { status });
  }
}
