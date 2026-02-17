import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { session_token } = await req.json();

    if (!session_token) {
      return NextResponse.json(
        { ok: false, error: "Token não fornecido" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) {
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
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}