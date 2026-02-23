import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function makeSupabaseAdmin() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!supabaseUrl || !serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}


// ✅ Nunca cachear resposta de sessão
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeToken(v: unknown) {
  return String(v ?? "").trim();
}

// ✅ valida formato pra reduzir brute force/oráculo e evitar lixo
function isPlausibleSessionToken(t: string) {
  // Ajuste leve: aceita tokens comuns (uuid/hex/base64url)
  if (t.length < 16 || t.length > 256) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

// ✅ log “cego”: nada de imprimir erro do supabase / stack em produção
function safeServerLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
    // em dev, ok logar pra depurar
    console.error(...args);
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      safeServerLog("validate-session: Server misconfigured");
      return NextResponse.json(
        { ok: false, error: "Erro interno" },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    const body = await req.json().catch(() => ({}));

    const session_token = normalizeToken((body as any)?.session_token);

    // ⚠️ Não diferenciar demais as respostas (evita enumeração/oráculo)
    if (!session_token || !isPlausibleSessionToken(session_token)) {
      return NextResponse.json(
        { ok: false, error: "Sessão inválida" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) {
      safeServerLog("validate-session: session not found/expired");
      return NextResponse.json(
        { ok: false, error: "Sessão inválida" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    // ✅ BUSCA O WHATSAPP DO DONO DO SISTEMA COM PERMISSÃO DE ADMIN (Bypassa o RLS)
    let admin_whatsapp = null;
    try {
// ✅ Aceita ADMIN, admin ou owner
      const { data: memberData } = await supabaseAdmin
        .from("tenant_members")
        .select("user_id")
        .eq("tenant_id", data.tenant_id)
        .in("role", ["ADMIN", "admin", "owner"]) // ✅ CORREÇÃO À PROVA DE BALAS
        .limit(1);

      if (memberData && memberData.length > 0) {
        const { data: profileData } = await supabaseAdmin
          .from("profiles")
          .select("whatsapp_username")
          .eq("id", memberData[0].user_id)
          .limit(1);

        if (profileData && profileData.length > 0) {
          admin_whatsapp = profileData[0].whatsapp_username;
        }
      }
    } catch (e) {
      safeServerLog("validate-session: falha ao buscar whatsapp do admin");
    }

    return NextResponse.json(
      {
        ok: true,
        data: {
          tenant_id: data.tenant_id,
          whatsapp_username: data.whatsapp_username,
          admin_whatsapp: admin_whatsapp, // ✅ Devolve para o Frontend
        },
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err: any) {
    safeServerLog("validate-session: unexpected error", err?.message);

    // ✅ NUNCA devolve err.message pro cliente (zero leak)
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
