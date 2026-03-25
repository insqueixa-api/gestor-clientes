import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  tryAcquireSaasLock, markSaasDone, markSaasError,
  runSaasFulfillment, prodLog,
} from "@/lib/saas-portal/fulfillment";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache", Expires: "0",
};

function makeAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function safeLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") console.error(...args);
}

export async function POST(req: NextRequest) {
  try {
    const supabase = makeAdmin();

    // Auth
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401, headers: NO_STORE });

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401, headers: NO_STORE });

    const { data: member } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member?.tenant_id) return NextResponse.json({ ok: false, error: "Tenant não encontrado" }, { status: 404, headers: NO_STORE });

    const myTenantId = String(member.tenant_id);

    const body = await req.json().catch(() => ({} as any));
    const payment_id = String(body?.payment_id || "").trim();
    if (!payment_id) return NextResponse.json({ ok: false, error: "payment_id obrigatório" }, { status: 400, headers: NO_STORE });

    // Busca pagamento
    const { data: payment, error: payErr } = await supabase
      .from("saas_portal_payments")
      .select("*")
      .eq("mp_payment_id", payment_id)
      .eq("tenant_id", myTenantId)
      .single();

    if (payErr || !payment) return NextResponse.json({ ok: false, error: "Pagamento não encontrado" }, { status: 404, headers: NO_STORE });

    const status  = String(payment.status || "").toLowerCase();
    const fStatus = String(payment.fulfillment_status || "pending").toLowerCase();

    // Já concluído
    if (fStatus === "done") {
      return NextResponse.json({
        ok: true, status: "approved", phase: "done",
        new_expires_at: payment.new_expires_at ?? null,
      }, { headers: NO_STORE });
    }

    if (fStatus === "error") {
      return NextResponse.json({
        ok: true, status: "rejected", phase: "error",
        error: "Falha ao concluir. Procure o suporte.",
      }, { headers: NO_STORE });
    }

    // Atualiza status via MP se ainda não aprovado
    if (status !== "approved") {
      const { data: gateway } = await supabase
        .from("payment_gateways")
        .select("config")
        .eq("tenant_id", payment.parent_tenant_id)
        .eq("type", "mercadopago")
        .eq("is_active", true)
        .maybeSingle();

      const mpToken = String(gateway?.config?.access_token || "").trim();
      if (mpToken) {
        const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
          headers: { Authorization: `Bearer ${mpToken}` },
        });
        const mpData = await mpRes.json().catch(() => ({} as any));
        const newStatus = String(mpData?.status || "").toLowerCase();
        if (newStatus && newStatus !== status) {
          await supabase.from("saas_portal_payments").update({ status: newStatus })
            .eq("id", payment.id);
          if (newStatus !== "approved") {
            return NextResponse.json({ ok: true, status: newStatus, phase: "awaiting_payment" }, { headers: NO_STORE });
          }
          // approved → cai no bloco abaixo
          payment.status = "approved";
        } else {
          return NextResponse.json({ ok: true, status, phase: "awaiting_payment" }, { headers: NO_STORE });
        }
      } else {
        return NextResponse.json({ ok: true, status, phase: "awaiting_payment" }, { headers: NO_STORE });
      }
    }

    // Aprovado → processing check
    if (fStatus === "processing") {
      const startedAt = payment.fulfillment_started_at ? new Date(payment.fulfillment_started_at).getTime() : 0;
      if ((Date.now() - startedAt) <= 3 * 60 * 1000) {
        return NextResponse.json({ ok: true, status: "approved", phase: "renewing" }, { headers: NO_STORE });
      }
    }

    // Tenta lock + fulfillment
    if (!payment.fulfillment_status || payment.fulfillment_status === "pending") {
      await supabase.from("saas_portal_payments").update({ fulfillment_status: "pending" })
        .eq("id", payment.id).is("fulfillment_status", null);
    }

    const lock = await tryAcquireSaasLock(supabase, myTenantId, payment.id);
    prodLog("saas.payment-status.lock", { acquired: lock.acquired, payment: String(payment.id).slice(-6) });

    if (!lock.acquired) {
      return NextResponse.json({ ok: true, status: "approved", phase: "renewing" }, { headers: NO_STORE });
    }

    try {
      const { newExpiresAt } = await runSaasFulfillment({ supabaseAdmin: supabase, payment });
      await markSaasDone(supabase, myTenantId, payment.id, newExpiresAt);
      return NextResponse.json({
        ok: true, status: "approved", phase: "done",
        new_expires_at: newExpiresAt,
      }, { headers: NO_STORE });
    } catch (e: any) {
      safeLog("saas fulfillment error:", e?.message);
      await markSaasError(supabase, myTenantId, payment.id, e?.message || "Falha no fulfillment");
      return NextResponse.json({ ok: true, status: "rejected", phase: "error", error: "Falha ao concluir. Procure o suporte." }, { headers: NO_STORE });
    }

  } catch (e: any) {
    safeLog("saas payment-status unexpected:", e?.message);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "SaaS payment-status ativo" });
}