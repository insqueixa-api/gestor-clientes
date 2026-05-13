import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient as createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ============================================================
// TIPOS
// ============================================================

type ClientRow = {
  id: string;
  tenant_id: string;
  display_name: string | null;
  server_username: string | null;
  server_id: string;
  server_password: string | null;
  plan_label: string | null;
  plan_table_id: string | null;
  price_amount: number | null;
  price_currency: string | null;
  vencimento: string | null;
  screens: number | null;
  notes: string | null;
  technology: string | null;
  is_trial: boolean | null;
  whatsapp_username: string | null;
};

type ServerRow = {
  id: string;
  name: string;
  credits_available: number | null;
};

// ============================================================
// HELPERS
// ============================================================

function safeServerLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
    console.error(...args);
  }
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function isInternal(req: NextRequest) {
  const expected = String(process.env.INTERNAL_API_SECRET || "").trim();
  const received = String(req.headers.get("x-internal-secret") || "").trim();

  if (!expected || !received) return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

const PLAN_LABELS_FROM_MONTHS: Record<number, string> = {
  1: "Mensal",
  2: "Bimestral",
  3: "Trimestral",
  6: "Semestral",
  12: "Anual",
};

function fmtMoney(currency: string, n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
  }).format(n);
}

function calcNewVencimentoISO(currentVencimento: string | null, months: number): string {
  // ATIVO → soma meses sobre o vencimento atual; VENCIDO → soma meses sobre agora
  const vencDate = currentVencimento ? new Date(currentVencimento) : null;
  const isActive = vencDate != null && vencDate > new Date();
  const base = isActive && vencDate ? new Date(vencDate) : new Date();
  base.setMonth(base.getMonth() + months);

  // 23:59 no horário de Brasília
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return new Date(`${yyyy}-${mm}-${dd}T23:59:00-03:00`).toISOString();
}

// ============================================================
// POST
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // ✅ Gate internal precisa ser calculado ANTES de qualquer uso
    const internal = isInternal(req);

    // ✅ Se alguém mandou header x-internal-secret mas não bateu, bloqueia (não cai em auth normal)
    const hasInternalHeader = !!req.headers.get("x-internal-secret");
    if (hasInternalHeader && !internal) return jsonError(401, "Unauthorized");

    // ✅ tenant_id só é exigido quando internal
    const tenant_id = String(body?.tenant_id ?? "").trim();
    const integration_id = String(body?.integration_id ?? "").trim();
    const client_id = String(body?.client_id ?? "").trim();
    const months = Number(body?.months);

    // Opcionais (vindos do fulfillment do portal)
    const screensInput = Number(body?.screens);
    const totalAmountInput = body?.total_amount != null ? Number(body.total_amount) : null;
    const currencyInput = String(body?.currency ?? "").trim().toUpperCase();
    const planLabelInput = String(body?.plan_label ?? "").trim();
    const priceAmountInput = body?.price_amount != null ? Number(body.price_amount) : null;
    const mpPaymentId = String(body?.mp_payment_id ?? "").trim();
    const source = String(body?.source ?? "").trim();

    // Validação básica
    if (!client_id || !Number.isFinite(months)) {
      return jsonError(400, "client_id e months são obrigatórios");
    }

    // ✅ Meses permitidos (mesmo padrão do NATV / PLAN_MONTHS)
    const validMonths = [1, 2, 3, 6, 12];
    const monthsNum = Math.trunc(months);
    if (!validMonths.includes(monthsNum)) {
      return jsonError(400, "months deve ser 1, 2, 3, 6 ou 12");
    }

    if (internal && !tenant_id) {
      return jsonError(400, "tenant_id é obrigatório (internal)");
    }

    // ✅ Gate: interno OU usuário autenticado
    if (!internal) {
      const supabaseAuth = await createSupabaseServer();
      const { data: auth, error: authErr } = await supabaseAuth.auth.getUser();
      if (authErr || !auth?.user?.id) {
        return jsonError(401, "Unauthorized");
      }
    }

    // ✅ Supabase:
    // - Interno: Service Role (não depende de cookie / RLS)
    // - Não-interno: client logado (RLS protege)
    const supabase = internal
      ? createSupabaseAdmin(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
      : await createSupabaseServer();

    // ----------------------------------------------------------------
    // 1) Validar integração (quando passada — fulfillment sempre passa)
    // ----------------------------------------------------------------
    if (integration_id) {
      let integQuery = supabase
        .from("server_integrations")
        .select("provider, is_active")
        .eq("id", integration_id);

      if (internal) {
        // TRAVA cross-tenant
        integQuery = integQuery.eq("tenant_id", tenant_id);
      }

      const { data: integ, error: integErr } = await integQuery.single();
      if (integErr || !integ) {
        safeServerLog("aluno renew: integração não encontrada");
        return jsonError(404, "Integração não encontrada");
      }

      const provider = String(integ.provider ?? "").toUpperCase();
      if (provider !== "ALUNO") return jsonError(400, "Integração não é ALUNO");
      if (integ.is_active === false) return jsonError(400, "Integração está inativa");
    }

    // ----------------------------------------------------------------
    // 2) Carregar cliente (tenant lock quando internal; RLS quando user)
    // ----------------------------------------------------------------
    let clientQuery = supabase
      .from("clients")
      .select("id,tenant_id,display_name,server_username,server_id,server_password,plan_label,plan_table_id,price_amount,price_currency,vencimento,screens,notes,technology,is_trial,whatsapp_username")
      .eq("id", client_id);

    if (internal) clientQuery = clientQuery.eq("tenant_id", tenant_id);

    const { data: clientData, error: cErr } = await clientQuery.single();
    if (cErr || !clientData) {
      safeServerLog("aluno renew: cliente não encontrado");
      return jsonError(404, "Cliente não encontrado");
    }

    // ✅ Cast explícito (evita "never" do supabase-js quando select é dinâmico)
    const client = clientData as unknown as ClientRow;

    // A partir daqui, usar o tenant_id do cliente carregado (válido nos 2 modos)
    const finalTenantId = String(client.tenant_id);

    // ----------------------------------------------------------------
    // 3) Carregar servidor virtual
    // ----------------------------------------------------------------
    const { data: serverData, error: sErr } = await supabase
      .from("servers")
      .select("id, name, credits_available")
      .eq("tenant_id", finalTenantId)
      .eq("id", client.server_id)
      .single();

    if (sErr || !serverData) {
      safeServerLog("aluno renew: servidor virtual não encontrado");
      return jsonError(404, "Servidor virtual não encontrado");
    }

    // ✅ Cast explícito
    const server = serverData as unknown as ServerRow;

    // ----------------------------------------------------------------
    // 4) Derivar campos finais (com fallback pro que está no cliente)
    // ----------------------------------------------------------------
    const qtyScreens = Number.isFinite(screensInput) ? screensInput : Number(client.screens ?? 1);
    const finalCurrency = currencyInput || String(client.price_currency || "BRL").toUpperCase();
    const finalPlanLabel = planLabelInput || PLAN_LABELS_FROM_MONTHS[monthsNum] || String(client.plan_label || "Mensal");
    const finalPriceAmount = priceAmountInput ?? Number(client.price_amount ?? 0);
    const totalPaid = totalAmountInput ?? finalPriceAmount;
    const unitPrice = monthsNum > 0 ? Number((totalPaid / monthsNum).toFixed(2)) : totalPaid;

    const nameToSend = client.display_name || "Aluno";
    const login = String(client.server_username || "").trim() || "-";

    const newVencimentoISO = calcNewVencimentoISO(client.vencimento, monthsNum);

    // Origem do log
    const isFromPortal = source === "portal" || !!mpPaymentId;
    const logPrefix = isFromPortal ? "Renovação via Portal do Cliente" : "Renovação via API";

    const formattedMoney = fmtMoney(finalCurrency, totalPaid);
    const clientMessage = `${logPrefix} · ${monthsNum} mês(es) · ${qtyScreens} tela(s) · ${formattedMoney}`;
    const serverNotes = `${logPrefix} · ${nameToSend} (${login}) · ${monthsNum} mês(es) · ${qtyScreens} tela(s) · ${formattedMoney}${mpPaymentId ? ` · MP: ${mpPaymentId}` : ""}`;

    // ----------------------------------------------------------------
    // 5) PASSO 1 — update_client (espelha modal manual)
    // ----------------------------------------------------------------
    const { error: updateErr } = await supabase.rpc("update_client", {
      p_tenant_id:                  finalTenantId,
      p_client_id:                  client_id,
      p_display_name:               nameToSend,
      p_name_prefix:                null,
      p_notes:                      client.notes || null,
      p_clear_notes:                false,
      p_server_id:                  client.server_id,
      p_server_username:            client.server_username,
      p_server_password:            null,
      p_screens:                    qtyScreens,
      p_plan_label:                 finalPlanLabel,
      p_plan_table_id:              client.plan_table_id || null,
      p_price_amount:               finalPriceAmount,
      p_price_currency:             finalCurrency,
      p_vencimento:                 client.vencimento, // renew_client_and_log que vai mexer
      p_is_trial:                   client.is_trial === true ? false : null,
      p_whatsapp_opt_in:            true,
      p_whatsapp_username:          null,
      p_whatsapp_snooze_until:      null,
      p_is_archived:                false,
      p_technology:                 client.technology || "ACADEMIA",
      p_clear_whatsapp_snooze_until: false,
      p_clear_secondary:            false,
    });

    if (updateErr) {
      safeServerLog("aluno renew: update_client erro", updateErr.message);
      return jsonError(500, "Falha ao atualizar cadastro");
    }

    // ----------------------------------------------------------------
    // 6) PASSO 2 — renew_client_and_log (débito de créditos + log)
    // ----------------------------------------------------------------
    const { error: renewErr } = await supabase.rpc("renew_client_and_log", {
      p_tenant_id:      finalTenantId,
      p_client_id:      client_id,
      p_months:         monthsNum,
      p_status:         "PAID",
      p_notes:          serverNotes,
      p_new_vencimento: newVencimentoISO,
      p_is_automatic:   false, // mantém comportamento do manual (debita créditos via RPC)
      p_message:        clientMessage,
      p_unit_price:     unitPrice,
      p_total_amount:   totalPaid,
    });

    if (renewErr) {
      safeServerLog("aluno renew: renew_client_and_log erro", renewErr.message);
      return jsonError(500, "Falha ao registrar renovação");
    }

    // ----------------------------------------------------------------
    // 7) PASSO 3 — reset saldo do servidor virtual pra 9999
    // ----------------------------------------------------------------
    try {
      await supabase.rpc("update_server_credits_manual", {
        p_server_id:   server.id,
        p_new_credits: 9999,
      });
    } catch (resetErr: any) {
      // não bloqueia — a renovação já aconteceu, só falhou o reset
      safeServerLog("aluno renew: reset 9999 falhou", resetErr?.message);
    }

    // ----------------------------------------------------------------
    // 8) Retorno (formato compatível com o fulfillment)
    // ----------------------------------------------------------------
    return NextResponse.json({
      ok: true,
      data: {
        exp_date_iso:      newVencimentoISO,
        credits_remaining: 9999,
        server_name:       server.name,
      },
    });

  } catch (err: any) {
    safeServerLog("aluno renew: crash", err?.message);
    return jsonError(500, "Erro interno");
  }
}
