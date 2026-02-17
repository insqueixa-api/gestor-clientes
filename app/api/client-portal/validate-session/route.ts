import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ✅ Service Role bypassa RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { session_token } = await req.json();

    if (!session_token) {
      return NextResponse.json(
        { ok: false, error: "Token não fornecido" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) {
      console.error("Sessão não encontrada:", error);
      return NextResponse.json(
        { ok: false, error: "Sessão inválida" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        tenant_id: data.tenant_id,
        whatsapp_username: data.whatsapp_username,
      },
    });
  } catch (err: any) {
    console.error("Erro validate-session:", err);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
