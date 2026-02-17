import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { session_token, client_id, period, price_amount } = body;

    // Validação
    if (!session_token || !client_id || !period || !price_amount) {
      return NextResponse.json(
        { ok: false, error: "Parâmetros incompletos" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    
    // 1. Validar sessão (busca direto na tabela de sessões)
const { data: sessionData, error: sessionErr } = await supabase
  .from("client_portal_sessions")
  .select("tenant_id, whatsapp_username")
  .eq("session_token", session_token)
  .gt("expires_at", new Date().toISOString())
  .limit(1);

if (sessionErr || !sessionData || sessionData.length === 0) {
  return NextResponse.json(
    { ok: false, error: "Sessão inválida" },
    { status: 401 }
  );
}

const sess = sessionData[0];

    // 2. Verificar se o cliente pertence à sessão
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, tenant_id, whatsapp_username")
      .eq("id", client_id)
      .eq("tenant_id", sess.tenant_id)
      .eq("whatsapp_username", sess.whatsapp_username)
      .single();

    if (clientErr || !client) {
      return NextResponse.json(
        { ok: false, error: "Cliente não encontrado" },
        { status: 404 }
      );
    }

    // 3. Mapear período para label
    const PERIOD_TO_LABEL: Record<string, string> = {
      MONTHLY: "Mensal",
      BIMONTHLY: "Bimestral",
      QUARTERLY: "Trimestral",
      SEMIANNUAL: "Semestral",
      ANNUAL: "Anual",
    };

    const plan_label = PERIOD_TO_LABEL[period] || "Mensal";

    // 4. Atualizar plano e valor
    const { error: updateErr } = await supabase
      .from("clients")
      .update({
        plan_label,
        price_amount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", client_id)
      .eq("tenant_id", sess.tenant_id);

    if (updateErr) {
      return NextResponse.json(
        { ok: false, error: "Erro ao atualizar plano" },
        { status: 500 }
      );
    }

    // 5. Retornar sucesso
    return NextResponse.json({
      ok: true,
      message: "Plano atualizado com sucesso",
    });

  } catch (err: any) {
    console.error("Erro ao atualizar plano:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Erro interno" },
      { status: 500 }
    );
  }
}
