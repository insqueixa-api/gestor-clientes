// app/api/client-portal/guia-tv/log-access/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionToken = String(body?.session_token || "").trim();
    const servidor = String(body?.servidor || "TODOS").toUpperCase();

    if (!sessionToken) {
      return NextResponse.json({ ok: false, error: "session_token ausente" }, { status: 400 });
    }
    if (!["ELITE","NATV","FAST","TODOS"].includes(servidor)) {
      return NextResponse.json({ ok: false, error: "servidor inválido" }, { status: 400 });
    }

    // ── 1. Resolve a sessão pelo token ──────────────────────────────────────
    const { data: sess, error: sessErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username, expires_at")
      .eq("session_token", sessionToken)
      .maybeSingle();

    if (sessErr || !sess) {
      return NextResponse.json({ ok: false, error: "sessão inválida" }, { status: 401 });
    }
    if (sess.expires_at && new Date(sess.expires_at) < new Date()) {
      return NextResponse.json({ ok: false, error: "sessão expirada" }, { status: 401 });
    }

    // ── 2. Resolve o client_id a partir do whatsapp_username (best-effort) ──
    // Se não achar, segue sem client_id — o log ainda é válido, só perde esse detalhe.
    let clientId: string | null = null;
    if (sess.whatsapp_username) {
      const { data: cli } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("tenant_id", sess.tenant_id)
        .eq("whatsapp_username", sess.whatsapp_username)
        .maybeSingle();
      clientId = cli?.id || null;
    }

    // ── 3. Insere o log ──────────────────────────────────────────────────────
    const { error: insertErr } = await supabaseAdmin
      .from("guia_tv_access_log")
      .insert({
        tenant_id: sess.tenant_id,
        client_id: clientId,
        servidor,
      });

    if (insertErr) {
      return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}