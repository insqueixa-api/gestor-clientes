// app/api/client-portal/guia-tv/sugestao/buscar/route.ts
//
// POST — autocomplete de filmes/séries já existentes no catálogo, usado
// enquanto o cliente digita o nome do conteúdo que quer sugerir. Se aparecer
// resultado aqui, o front deve travar o envio ("já disponível no servidor").
//
// body: { session_token, servidor: 'ELITE'|'NATV'|'FAST', tipo: 'FILME'|'SERIE', q }

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

function normalizarBusca(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SERVIDORES_VALIDOS = ["ELITE", "NATV", "FAST"];
const TIPOS_VALIDOS = ["FILME", "SERIE"];

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

    // ✅ Valida a sessão exatamente como o validate-session — só precisamos
    // confirmar que ela existe e não expirou, não usamos tenant_id aqui
    // porque o catálogo (catalog_master/catalog_availability) é global,
    // não por tenant — mesmo padrão das rotas de admin (elite/natv/fast).
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

    const servidor = String(body?.servidor || "").toUpperCase();
    const tipo = String(body?.tipo || "").toUpperCase();
    const q = String(body?.q || "").trim();

    if (!SERVIDORES_VALIDOS.includes(servidor)) {
      return NextResponse.json(
        { ok: false, error: "servidor inválido" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (!TIPOS_VALIDOS.includes(tipo)) {
      return NextResponse.json(
        { ok: false, error: "tipo inválido" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const termo = normalizarBusca(q);
    if (termo.length < 2) {
      return NextResponse.json({ ok: true, data: [] }, { headers: NO_STORE_HEADERS });
    }

    const { data, error } = await supabaseAdmin
      .from("catalog_availability")
      .select(`
        master_id,
        catalog_master!inner (
          id,
          titulo_normalizado,
          titulo_busca,
          tipo
        )
      `)
      .eq("servidor", servidor)
      .eq("catalog_master.tipo", tipo)
      .ilike("catalog_master.titulo_busca", `%${termo}%`)
      .limit(8);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "Erro ao buscar no catálogo" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const resultados = (data || []).map((row: any) => ({
      id: row.catalog_master.id,
      titulo: row.catalog_master.titulo_normalizado,
    }));

    return NextResponse.json({ ok: true, data: resultados }, { headers: NO_STORE_HEADERS });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}