// app/api/client-portal/guia-tv/log-access/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function normalizeToken(v: unknown) {
  return String(v ?? "").trim();
}

function isPlausibleSessionToken(t: string) {
  if (t.length < 16 || t.length > 256) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ✅ exige uma sessão válida do portal do cliente (evita log falso de qualquer origem)
    const session_token = normalizeToken(body?.session_token);
    if (!session_token || !isPlausibleSessionToken(session_token)) {
      return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401 });
    }

    const { data: sessao, error: sessaoErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessaoErr || !sessao) {
      return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401 });
    }

    const servidor = String(body?.servidor || "TODOS").toUpperCase();

    if (!["ELITE","NATV","FAST","TODOS"].includes(servidor)) {
      return NextResponse.json({ ok: false, error: "servidor inválido" }, { status: 400 });
    }

    const { error: insertErr } = await supabaseAdmin
      .from("guia_tv_access_log")
      .insert({ servidor, tenant_id: sessao.tenant_id });

    if (insertErr) {
      console.error("[GUIA-TV-LOG] Erro ao inserir:", insertErr.message);
      return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[GUIA-TV-LOG] Erro inesperado:", e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}