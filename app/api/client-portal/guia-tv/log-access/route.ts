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
    const servidor = String(body?.servidor || "TODOS").toUpperCase();

    if (!["ELITE","NATV","FAST","TODOS"].includes(servidor)) {
      return NextResponse.json({ ok: false, error: "servidor inválido" }, { status: 400 });
    }

    const { error: insertErr } = await supabaseAdmin
      .from("guia_tv_access_log")
      .insert({ servidor });

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