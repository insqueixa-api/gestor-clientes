// app/api/client-portal/pending-charges/route.ts
import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPendingCharges } from "@/lib/client-portal/pending-charges";
import { touchPortalSession } from "@/lib/client-portal/session";

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

function normalizeStr(v: unknown) {
  return String(v ?? "").trim();
}

function isPlausibleSessionToken(t: string) {
  if (t.length < 16 || t.length > 256) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

// ✅ Só leitura — não cria nem altera nada. Usado pro portal avisar o
// cliente ANTES de clicar em "Concluir Renovação" se existe pendência
// aberta pra somar no total. O create-payment recalcula tudo de novo do
// zero, nunca confia no que essa rota devolveu.
export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);

    if (!session_token || !client_id) return jsonError("Parâmetros incompletos", 400);
    if (!isPlausibleSessionToken(session_token)) return jsonError("Sessão inválida", 401);
    if (!isUuid(client_id)) return jsonError("Cliente não encontrado", 404);

    const { data: sess, error: sessErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username, phone_anchor")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessErr || !sess) return jsonError("Sessão inválida", 401);

    // ✅ Não bloqueia a resposta (mesmo padrão de validatePortalClient em
    // lib/client-portal/session.ts) — bookkeeping, não precisa do round-trip.
    after(() => touchPortalSession(supabaseAdmin, session_token));

    // ✅ Texto OU âncora de telefone (ver
    // docs/sql/portal_phone_anchor_hybrid_identity.sql)
    const { data: idsData, error: idsErr } = await supabaseAdmin.rpc(
      "portal_client_ids_for_identity",
      {
        p_tenant_id: sess.tenant_id,
        p_whatsapp_username: sess.whatsapp_username,
        p_phone_anchor: (sess as any).phone_anchor ?? null,
      },
    );
    if (idsErr) return jsonError("Erro interno", 500);
    const accessibleIds = new Set(((idsData as { id: string }[] | null) || []).map((r) => r.id));
    if (!accessibleIds.has(client_id)) return jsonError("Cliente não encontrado", 404);

    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("id, whatsapp_username, secondary_whatsapp_username, price_currency")
      .eq("id", client_id)
      .eq("tenant_id", sess.tenant_id)
      .single();

    if (clientErr || !client) return jsonError("Cliente não encontrado", 404);

    const currency = String(client.price_currency || "BRL").trim() || "BRL";

    const result = await getPendingCharges(supabaseAdmin, sess.tenant_id, client_id, currency);

    return NextResponse.json(
      {
        ok: true,
        currency,
        total: result.total,
        items: result.items.map((it) => ({
          message: it.message,
          appName: it.appName,
          convertedAmount: it.convertedAmount,
          activationDate: it.activationDate,
        })),
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err: any) {
    console.error("[pending-charges]", err?.message);
    return jsonError("Erro interno", 500);
  }
}
