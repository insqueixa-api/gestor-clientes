import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { session_token } = await req.json();

    if (!session_token) {
      return NextResponse.json({ ok: false, error: "Token não fornecido" }, { status: 400 });
    }

    // 1. Validar sessão
    const { data: sess, error: sessErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessErr || !sess) {
      return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401 });
    }

    // 2. Buscar contas do cliente
    const { data: accounts, error: accErr } = await supabaseAdmin
      .from("clients")
      .select(`
        id,
        display_name,
        server_username,
        screens,
        plan_label,
        vencimento,
        price_amount,
        price_currency,
        plan_table_id,
        is_trial,
        is_archived,
        servers (name)
      `)
      .eq("tenant_id", sess.tenant_id)
      .eq("whatsapp_username", sess.whatsapp_username)
      .order("is_trial", { ascending: true })
      .order("vencimento", { ascending: false });

    if (accErr) {
      return NextResponse.json({ ok: false, error: accErr.message }, { status: 500 });
    }

    const mapped = (accounts || []).map((acc: any) => ({
      id: acc.id,
      display_name: acc.display_name || "Sem nome",
      server_username: acc.server_username || "",
      server_name: acc.servers?.name || "Servidor",
      screens: acc.screens || 1,
      plan_label: acc.plan_label || "Mensal",
      vencimento: acc.vencimento,
      price_amount: acc.price_amount || 0,
      price_currency: acc.price_currency || "BRL",
      plan_table_id: acc.plan_table_id,
      is_trial: acc.is_trial || false,
      is_archived: acc.is_archived || false,
    }));

    return NextResponse.json({ ok: true, data: mapped });

  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}