// app/api/catalogo/sugestoes/route.ts
//
// GET  ?status=PENDENTE|ENVIADO_SUPORTE|ADICIONADO|REJEITADO|TODOS — lista sugestões
// PATCH { id, status, motivo_rejeicao?, categoria_adicionada? } — admin atualiza status

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const STATUS_VALIDOS = ["PENDENTE", "ENVIADO_SUPORTE", "ADICIONADO", "REJEITADO"];

async function getTenantId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return data?.tenant_id ?? null;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const tenantId = await getTenantId(user.id);
  if (!tenantId) return NextResponse.json({ error: "Tenant não encontrado" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const status = (searchParams.get("status") || "PENDENTE").toUpperCase();

  try {
    let query = supabaseAdmin
      .from("content_suggestions")
      .select("id, servidor, tipo, titulo, link, status, categoria_adicionada, motivo_rejeicao, criado_em, atualizado_em")
      .eq("tenant_id", tenantId)
      .order("criado_em", { ascending: false });

    if (status !== "TODOS") {
      if (!STATUS_VALIDOS.includes(status)) {
        return NextResponse.json({ ok: false, error: "status inválido" }, { status: 400 });
      }
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) throw error;

    const ids = (data || []).map((s) => s.id);
    const contagemPorId = new Map<string, number>();

    if (ids.length > 0) {
      const { data: pedidos } = await supabaseAdmin
        .from("content_suggestion_requests")
        .select("suggestion_id")
        .in("suggestion_id", ids);
      for (const p of pedidos || []) {
        contagemPorId.set(p.suggestion_id, (contagemPorId.get(p.suggestion_id) || 0) + 1);
      }
    }

    const resultado = (data || []).map((s) => ({
      ...s,
      total_pedidos: contagemPorId.get(s.id) || 0,
    }));

    return NextResponse.json({ ok: true, data: resultado });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const tenantId = await getTenantId(user.id);
  if (!tenantId) return NextResponse.json({ error: "Tenant não encontrado" }, { status: 400 });

  try {
    const body = await req.json();
    const id = String(body?.id || "");
    const status = String(body?.status || "").toUpperCase();

    if (!id) return NextResponse.json({ ok: false, error: "id obrigatório" }, { status: 400 });
    if (!STATUS_VALIDOS.includes(status)) {
      return NextResponse.json({ ok: false, error: "status inválido" }, { status: 400 });
    }
    if (status === "REJEITADO" && !String(body?.motivo_rejeicao || "").trim()) {
      return NextResponse.json({ ok: false, error: "Informe o motivo da rejeição" }, { status: 400 });
    }

    const update: Record<string, any> = {
      status,
      atualizado_em: new Date().toISOString(),
    };
    if (status === "REJEITADO") update.motivo_rejeicao = String(body.motivo_rejeicao).trim();
    if (status === "ADICIONADO" && body?.categoria_adicionada) {
      update.categoria_adicionada = String(body.categoria_adicionada).trim();
    }
    // Limpa motivo de rejeição se o status voltou a mudar pra outra coisa
    if (status !== "REJEITADO") update.motivo_rejeicao = null;

    const { error } = await supabaseAdmin
      .from("content_suggestions")
      .update(update)
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
