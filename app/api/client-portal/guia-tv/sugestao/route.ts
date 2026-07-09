// app/api/client-portal/guia-tv/sugestao/route.ts
//
// POST — cria uma sugestão de conteúdo, ou registra mais um pedido numa
// sugestão já existente (fluxo de duplicata em 2 etapas, ver abaixo).
//
// MODO A (padrão) — cliente digitou título novo:
//   body: { session_token, conta, servidor, tipo, titulo, link }
//   - Se não existir sugestão com esse título nesse servidor → cria.
//   - Se já existir e ESTE cliente já pediu antes → avisa "já está no seu histórico".
//   - Se já existir e for OUTRO cliente pedindo pela 1ª vez → responde
//     { duplicate: true, ... } SEM criar nada. O front deve mostrar o popup
//     de confirmação e, se o cliente confirmar, chamar de novo no MODO B.
//
// MODO B (confirmação de duplicata) — cliente confirmou o popup:
//   body: { session_token, conta, confirmar_duplicata: true, suggestion_id }
//   - Só registra o pedido deste cliente na sugestão já existente.

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

// ⚠️ Validação BÁSICA por enquanto (sem IA) — bloqueia vazio, formato de URL
// inválido, e domínios de busca (Google e afins). Não confirma se o link
// realmente mostra o filme/série certo — isso fica pro suporte avaliar.
function validarLink(link: string): { ok: boolean; erro?: string } {
  const v = link.trim();
  if (!v) return { ok: false, erro: "Link é obrigatório." };

  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return { ok: false, erro: "Link inválido — inclua o endereço completo (https://...)." };
  }

  if (!/^https?:$/.test(url.protocol)) {
    return { ok: false, erro: "Link inválido — use um endereço http:// ou https://." };
  }

  const host = url.hostname.toLowerCase();
  const DOMINIOS_BUSCA = ["google.", "bing.", "search.yahoo.", "duckduckgo."];
  if (DOMINIOS_BUSCA.some((d) => host.includes(d))) {
    return {
      ok: false,
      erro: "Não aceitamos link de busca (Google/Bing/etc). Envie o link direto da página do filme ou série.",
    };
  }

  return { ok: true };
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

    // ✅ Confirma que essa conta (client_id) pertence mesmo ao tenant da sessão
    // — impede alguém trocar o "conta=" na URL pra ver/mexer no histórico
    // de outro cliente.
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

    // ─── MODO B: confirmação de duplicata ──────────────────────────────────
    if (body?.confirmar_duplicata === true) {
      const suggestion_id = normalizeToken(body?.suggestion_id);
      if (!suggestion_id) {
        return NextResponse.json(
          { ok: false, error: "suggestion_id obrigatório" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }

      const { data: sugestao, error: sugestaoErr } = await supabaseAdmin
        .from("content_suggestions")
        .select("id, tenant_id, titulo, status")
        .eq("id", suggestion_id)
        .eq("tenant_id", sessao.tenant_id)
        .maybeSingle();

      if (sugestaoErr || !sugestao) {
        return NextResponse.json(
          { ok: false, error: "Sugestão não encontrada" },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }

      const { error: insertErr } = await supabaseAdmin
        .from("content_suggestion_requests")
        .upsert(
          { suggestion_id: sugestao.id, client_id: conta },
          { onConflict: "suggestion_id,client_id", ignoreDuplicates: true },
        );

      if (insertErr) {
        return NextResponse.json(
          { ok: false, error: "Erro ao registrar pedido" },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }

      return NextResponse.json(
        { ok: true, registered: true, titulo: sugestao.titulo, status: sugestao.status },
        { headers: NO_STORE_HEADERS },
      );
    }

    // ─── MODO A: título novo (ou primeira vez deste cliente) ───────────────
    const servidor = String(body?.servidor || "").toUpperCase();
    const tipo = String(body?.tipo || "").toUpperCase();
    const titulo = String(body?.titulo || "").trim();
    const link = String(body?.link || "").trim();

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
    if (!titulo || titulo.length < 2) {
      return NextResponse.json(
        { ok: false, error: "Informe o nome do conteúdo." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const linkCheck = validarLink(link);
    if (!linkCheck.ok) {
      return NextResponse.json(
        { ok: false, error: linkCheck.erro },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const titulo_busca = normalizarBusca(titulo);

    const { data: existente } = await supabaseAdmin
      .from("content_suggestions")
      .select("id, titulo, status")
      .eq("tenant_id", sessao.tenant_id)
      .eq("servidor", servidor)
      .eq("titulo_busca", titulo_busca)
      .maybeSingle();

    if (existente) {
      // Esse cliente já pediu esse título antes?
      const { data: pedidoProprio } = await supabaseAdmin
        .from("content_suggestion_requests")
        .select("id")
        .eq("suggestion_id", existente.id)
        .eq("client_id", conta)
        .maybeSingle();

      if (pedidoProprio) {
        return NextResponse.json(
          {
            ok: true,
            already_requested_by_you: true,
            titulo: existente.titulo,
            status: existente.status,
          },
          { headers: NO_STORE_HEADERS },
        );
      }

      // Outro cliente já pediu — front deve confirmar antes de registrar
      const { count: totalPedidos } = await supabaseAdmin
        .from("content_suggestion_requests")
        .select("*", { count: "exact", head: true })
        .eq("suggestion_id", existente.id);

      return NextResponse.json(
        {
          ok: true,
          duplicate: true,
          needs_confirmation: true,
          suggestion_id: existente.id,
          titulo_existente: existente.titulo,
          status: existente.status,
          total_pedidos: totalPedidos || 0,
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    // Título realmente novo — cria a sugestão + o pedido deste cliente
    const { data: nova, error: novaErr } = await supabaseAdmin
      .from("content_suggestions")
      .insert({
        tenant_id: sessao.tenant_id,
        servidor,
        tipo,
        titulo,
        titulo_busca,
        link,
        status: "PENDENTE",
      })
      .select("id, titulo, status")
      .single();

    if (novaErr || !nova) {
      return NextResponse.json(
        { ok: false, error: "Erro ao registrar sugestão" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const { error: reqErr } = await supabaseAdmin
      .from("content_suggestion_requests")
      .insert({ suggestion_id: nova.id, client_id: conta });

    if (reqErr) {
      return NextResponse.json(
        { ok: false, error: "Erro ao registrar pedido" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { ok: true, created: true, titulo: nova.titulo, status: nova.status },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}