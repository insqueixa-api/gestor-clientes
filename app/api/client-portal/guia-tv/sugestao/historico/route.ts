// app/api/client-portal/guia-tv/sugestao/historico/route.ts
//
// POST — lista as sugestões que ESTE cliente pediu (próprio histórico),
// com status atual e, se marcado como "solicitado por outros também",
// quantos pedidos aquele título tem no total.
//
// body: { session_token, conta }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function makeSupabaseAdmin() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

function normalizeToken(v: unknown) {
  return String(v ?? "").trim();
}

function isPlausibleSessionToken(t: string) {
  if (t.length < 16 || t.length > 256) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { ok: false, error: "Erro interno" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const body = await req.json().catch(() => ({}));

    const session_token = normalizeToken(body?.session_token);
    if (!session_token || !isPlausibleSessionToken(session_token)) {
      return NextResponse.json(
        { ok: false, error: "Sessão inválida" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const { data: sessao, error: sessaoErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessaoErr || !sessao) {
      return NextResponse.json(
        { ok: false, error: "Sessão inválida" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const conta = normalizeToken(body?.conta);
    if (!conta) {
      return NextResponse.json(
        { ok: false, error: "Conta obrigatória" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const { data: cliente, error: clienteErr } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", conta)
      .eq("tenant_id", sessao.tenant_id)
      .maybeSingle();

    if (clienteErr || !cliente) {
      return NextResponse.json(
        { ok: false, error: "Conta inválida para esta sessão" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    // Pedidos deste cliente → sugestão vinculada (join), mais recentes primeiro
    const { data, error } = await supabaseAdmin
      .from("content_suggestion_requests")
      .select(`
        criado_em,
        content_suggestions!inner (
          id,
          servidor,
          tipo,
          titulo,
          link,
          status,
          categoria_adicionada,
          motivo_rejeicao,
          criado_em,
          criado_por_client_id
        )
      `)
      .eq("client_id", conta)
      .eq("content_suggestions.tenant_id", sessao.tenant_id)
      .order("criado_em", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "Erro ao carregar histórico" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // Pra cada sugestão, conta quantos pedidos ela tem no total (útil pro
    // front mostrar "solicitado por mais X pessoas", se quiser)
    const suggestionIds = (data || []).map((row: any) => row.content_suggestions.id);
    const contagemPorId = new Map<string, number>();

    if (suggestionIds.length > 0) {
      const { data: contagens } = await supabaseAdmin
        .from("content_suggestion_requests")
        .select("suggestion_id")
        .in("suggestion_id", suggestionIds);

      for (const row of contagens || []) {
        const id = row.suggestion_id;
        contagemPorId.set(id, (contagemPorId.get(id) || 0) + 1);
      }
    }

    const resultado = (data || []).map((row: any) => {
      const s = row.content_suggestions;
      return {
        suggestion_id: s.id,
        servidor: s.servidor,
        tipo: s.tipo,
        titulo: s.titulo,
        link: s.link,
        status: s.status,
        categoria_adicionada: s.categoria_adicionada,
        motivo_rejeicao: s.motivo_rejeicao,
        pedido_em: row.criado_em,
        total_pedidos: contagemPorId.get(s.id) || 1,
        pode_editar: s.status === "PENDENTE" && s.criado_por_client_id === conta,
      };
    });

    return NextResponse.json({ ok: true, data: resultado }, { headers: NO_STORE_HEADERS });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}