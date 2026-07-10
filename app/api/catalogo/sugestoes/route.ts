// app/api/catalogo/sugestoes/route.ts
//
// GET    ?status=... — lista sugestões, cada uma com a lista de quem pediu
//                       (nome, username do servidor, whatsapp) pra você conseguir
//                       alinhar com o cliente se precisar.
// PATCH  { id, status?, motivo_rejeicao?, categoria_adicionada?, titulo?, link? }
//        — atualiza status e/ou corrige título/link (admin pode editar sempre,
//        mesmo depois de Pendente — diferente do cliente, que só edita Pendente).
// DELETE { id } — remove a sugestão (cascata remove os pedidos vinculados).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resolveNotification } from "@/lib/notifications/notify";

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

    // Busca quem pediu cada sugestão (pode ser mais de um cliente)
    const solicitantesPorId = new Map<string, { client_id: string; nome: string; username: string; whatsapp: string | null }[]>();

    if (ids.length > 0) {
      const { data: pedidos } = await supabaseAdmin
        .from("content_suggestion_requests")
        .select("suggestion_id, client_id")
        .in("suggestion_id", ids);

      const clientIds = [...new Set((pedidos || []).map((p) => p.client_id))];

      const clientesPorId = new Map<string, { nome: string; username: string; whatsapp: string | null }>();
      if (clientIds.length > 0) {
        const { data: clientesData } = await supabaseAdmin
          .from("clients")
          .select("id, display_name, server_username, phone_e164")
          .in("id", clientIds);
        for (const c of clientesData || []) {
          clientesPorId.set(c.id, {
            nome: c.display_name || "Sem nome",
            username: c.server_username || "—",
            whatsapp: c.phone_e164 || null,
          });
        }
      }

      for (const p of pedidos || []) {
        const cliente = clientesPorId.get(p.client_id);
        const arr = solicitantesPorId.get(p.suggestion_id) || [];
        arr.push({
          client_id: p.client_id,
          nome: cliente?.nome || "Cliente removido",
          username: cliente?.username || "—",
          whatsapp: cliente?.whatsapp || null,
        });
        solicitantesPorId.set(p.suggestion_id, arr);
      }
    }

    const resultado = (data || []).map((s) => ({
      ...s,
      solicitantes: solicitantesPorId.get(s.id) || [],
      total_pedidos: (solicitantesPorId.get(s.id) || []).length,
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
    if (!id) return NextResponse.json({ ok: false, error: "id obrigatório" }, { status: 400 });

    const update: Record<string, any> = { atualizado_em: new Date().toISOString() };

    // ── Correção de título/link (admin pode fazer isso a qualquer momento) ──
    if (typeof body?.titulo === "string" && body.titulo.trim()) {
      update.titulo = body.titulo.trim();
    }
    if (typeof body?.link === "string" && body.link.trim()) {
      update.link = body.link.trim();
    }

    // ── Mudança de status (opcional nesta chamada) ──────────────────────────
    if (body?.status) {
      const status = String(body.status).toUpperCase();
      if (!STATUS_VALIDOS.includes(status)) {
        return NextResponse.json({ ok: false, error: "status inválido" }, { status: 400 });
      }
      if (status === "REJEITADO" && !String(body?.motivo_rejeicao || "").trim()) {
        return NextResponse.json({ ok: false, error: "Informe o motivo da rejeição" }, { status: 400 });
      }
      update.status = status;
      update.motivo_rejeicao = status === "REJEITADO" ? String(body.motivo_rejeicao).trim() : null;
      if (status === "ADICIONADO" && body?.categoria_adicionada) {
        update.categoria_adicionada = String(body.categoria_adicionada).trim();
      }
    }

const { error } = await supabaseAdmin
      .from("content_suggestions")
      .update(update)
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) throw error;

// ✅ Só resolve o alerta se o status saiu de PENDENTE de fato — se algum dia
    // reabrir (voltar pra PENDENTE), o alerta deve continuar/voltar a aparecer.
    if (update.status && update.status !== "PENDENTE") {
      await resolveNotification(tenantId, "sugestao_conteudo", id);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const tenantId = await getTenantId(user.id);
  if (!tenantId) return NextResponse.json({ error: "Tenant não encontrado" }, { status: 400 });

  try {
    const body = await req.json();
    const id = String(body?.id || "");
    if (!id) return NextResponse.json({ ok: false, error: "id obrigatório" }, { status: 400 });

// content_suggestion_requests tem ON DELETE CASCADE — apaga junto
    const { error } = await supabaseAdmin
      .from("content_suggestions")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) throw error;

    // ✅ Some com o alerta do sino junto com a sugestão excluída
    await resolveNotification(tenantId, "sugestao_conteudo", id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
