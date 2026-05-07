import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    // 1. Autenticação
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ ok: false, error: "Não autenticado." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      integration_id,
      tenant_id,
      months,
      credits_to_deduct,
    } = body as {
      integration_id: string;
      tenant_id: string;
      months: number;
      credits_to_deduct?: number;
    };

    if (!integration_id || !tenant_id || !months) {
      return NextResponse.json(
        { ok: false, error: "Parâmetros obrigatórios ausentes: integration_id, tenant_id, months." },
        { status: 400 }
      );
    }

    // 2. Valida membership no tenant
    const { data: mem } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("tenant_id", tenant_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!mem) {
      return NextResponse.json({ ok: false, error: "Acesso negado." }, { status: 403 });
    }

    // 3. Busca o servidor vinculado a esta integração
    const { data: server, error: srvErr } = await supabase
      .from("servers")
      .select("id, credits_available, name")
      .eq("tenant_id", tenant_id)
      .eq("panel_integration", integration_id)
      .maybeSingle();

    if (srvErr || !server) {
      return NextResponse.json(
        { ok: false, error: "Servidor não encontrado para esta integração." },
        { status: 404 }
      );
    }

    // 4. Verifica saldo
    const creditsNeeded = Number(credits_to_deduct ?? months ?? 1);
    const currentCredits = Number(server.credits_available || 0);

    if (currentCredits < creditsNeeded) {
      return NextResponse.json(
        {
          ok: false,
          error: `Saldo insuficiente. Disponível: ${currentCredits} crédito(s) · Necessário: ${creditsNeeded}.`,
        },
        { status: 400 }
      );
    }

    // 5. Desconta créditos via RPC
    const newCredits = currentCredits - creditsNeeded;
    const { error: updateErr } = await supabase.rpc("update_server_credits_manual", {
      p_server_id:   server.id,
      p_new_credits: newCredits,
    });

    if (updateErr) {
      return NextResponse.json(
        { ok: false, error: `Falha ao descontar créditos: ${updateErr.message}` },
        { status: 500 }
      );
    }

    // 6. Calcula novo vencimento: months a partir de agora, sempre 23:59 horário de Brasília
    const now = new Date();
    const exp = new Date(now);
    exp.setMonth(exp.getMonth() + Number(months));

    const yyyy = exp.getFullYear();
    const mm   = String(exp.getMonth() + 1).padStart(2, "0");
    const dd   = String(exp.getDate()).padStart(2, "0");
    // -03:00 = horário de Brasília (sem ajuste de horário de verão por simplicidade)
    const expIso = new Date(`${yyyy}-${mm}-${dd}T23:59:00-03:00`).toISOString();

    return NextResponse.json({
      ok: true,
      data: {
        exp_date_iso:       expIso,
        credits_remaining:  newCredits,
        server_name:        server.name,
      },
    });

  } catch (err: any) {
    console.error("[aluno/renew] Erro inesperado:", err);
    return NextResponse.json({ ok: false, error: "Erro interno." }, { status: 500 });
  }
}
