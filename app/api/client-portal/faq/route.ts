// app/api/client-portal/faq/route.ts
// Bloco 3 do portal — sub-abas "Novo dispositivo" e "Dúvidas e sugestões".
// Fonte: bot_knowledge, mas só entradas com portal_visible=true E
// portal_content preenchido (o content original é escrito como instrução
// pro bot, não é seguro mostrar direto pro cliente).
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, isPlausibleSessionToken } from "@/lib/client-portal/session";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeStr(v: unknown) {
  return String(v ?? "").trim();
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    if (!session_token || !isPlausibleSessionToken(session_token)) {
      return jsonError("Sessão inválida", 401);
    }

    // Só precisa da sessão (não é por conta) — confirma que é uma sessão válida.
    const { data: sess, error: sessErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();
    if (sessErr || !sess) return jsonError("Sessão inválida", 401);

    const { data: rows, error } = await supabaseAdmin
      .from("bot_knowledge")
      .select("title, category, portal_category, portal_content, portal_device_types")
      .eq("tenant_id", sess.tenant_id)
      .eq("portal_visible", true)
      .not("portal_content", "is", null)
      .neq("portal_content", "");

    if (error) return jsonError("Erro interno", 500);

    const deviceSetup = (rows || [])
      .filter((r: any) => r.portal_category === "device_setup")
      .map((r: any) => ({
        title: r.title,
        content: r.portal_content,
        device_types: Array.isArray(r.portal_device_types) ? r.portal_device_types : [],
      }));

    const faq = (rows || [])
      .filter((r: any) => r.portal_category === "faq")
      .map((r: any) => ({
        title: r.title,
        content: r.portal_content,
        category: r.category || "Geral",
      }));

    return NextResponse.json(
      { ok: true, data: { device_setup: deviceSetup, faq } },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
