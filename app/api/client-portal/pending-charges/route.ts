// app/api/client-portal/pending-charges/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPendingCharges } from "@/lib/client-portal/pending-charges";

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
      .select("tenant_id, whatsapp_username")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessErr || !sess) return jsonError("Sessão inválida", 401);

    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("id, whatsapp_username, secondary_whatsapp_username, price_currency")
      .eq("id", client_id)
      .eq("tenant_id", sess.tenant_id)
      .or(`whatsapp_username.eq.${sess.whatsapp_username},secondary_whatsapp_username.eq.${sess.whatsapp_username}`)
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
    return jsonError("Erro interno", 500);
  }
}
