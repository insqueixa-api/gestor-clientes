// app/api/whatsapp/bot/redirect-notice/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Checagem mínima usada pelo whatsapp-service quando uma sessão está em modo
// "não atende, redireciona pra outra sessão" (ex: número corporativo). O
// serviço de WhatsApp não tem acesso ao Supabase, então precisa perguntar
// aqui antes de mandar qualquer aviso — sem isso, mandaria o aviso de IPTV
// pra QUALQUER telefone que mensagem esse número, cliente ou não.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isInternalRequest } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

function isInternalAuth(req: Request): boolean {
  return isInternalRequest(req, "UNIGESTOR_BOT_INTERNAL_SECRET");
}

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  if (!isInternalAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenant_id = String(body?.tenant_id || "").trim();
  const phone = String(body?.phone || "").trim();
  if (!tenant_id || !phone) {
    return NextResponse.json({ error: "Parâmetros obrigatórios ausentes" }, { status: 400 });
  }

  // Mesmo critério de identificação de cliente usado no agent/route.ts.
  const { data } = await sb
    .from("clients")
    .select("id")
    .eq("tenant_id", tenant_id)
    .or(`whatsapp_username.eq.${phone},secondary_whatsapp_username.eq.${phone}`)
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ ok: true, isClient: !!data });
}
