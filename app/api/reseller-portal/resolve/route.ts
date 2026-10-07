// app/api/reseller-portal/resolve/route.ts
// ✅ 07/10/2026 (bug achado pelo Márcio: link copiado da revenda abria
// "Esta sessão expirou"). A tela de login (app/LoginClient.tsx) confere o
// link com o RPC portal_resolve_token, que só conhece links de CLIENTE —
// link de revenda caía como "morto" antes de chegar no /api/client-portal/login.
// Esta rota é o equivalente da revenda: só é chamada quando o RPC do cliente
// NÃO reconheceu o token (o caminho do cliente não muda). Devolve só o
// identificador mostrado na tela (WhatsApp ou nome) — mesmo nível do RPC do
// cliente; não cria sessão nem marca uso.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const token = String(body?.token ?? "").trim();
    if (token.length < 16 || token.length > 256 || !/^[a-zA-Z0-9=_\-.]+$/.test(token)) {
      return NextResponse.json({ ok: false }, { status: 404, headers: NO_STORE });
    }
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data: t } = await sb
      .from("reseller_portal_tokens")
      .select("tenant_id, reseller_id")
      .eq("token", token)
      .eq("is_active", true)
      .maybeSingle();
    if (!t) return NextResponse.json({ ok: false }, { status: 404, headers: NO_STORE });
    const { data: r } = await sb
      .from("resellers")
      .select("display_name, whatsapp_username, is_archived, portal_disabled_at")
      .eq("id", t.reseller_id)
      .eq("tenant_id", t.tenant_id)
      .maybeSingle();
    if (!r || r.is_archived || r.portal_disabled_at) return NextResponse.json({ ok: false }, { status: 404, headers: NO_STORE });
    const identity = String(r.whatsapp_username || r.display_name || "").trim();
    if (!identity) return NextResponse.json({ ok: false }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true, whatsapp_username: identity }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
