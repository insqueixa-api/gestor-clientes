import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const token = String(body?.token ?? body?.t ?? "").trim();

    if (!token) {
      return NextResponse.json({ ok: false, error: "Token não fornecido" }, { status: 400 });
    }

    // ✅ IMPORTANTÍSSIMO:
    // Reset do PIN no seu fluxo é por TOKEN (link do WhatsApp), não por telefone.
    // A RPC é quem resolve o whatsapp/tenant internamente com segurança.
    const { error } = await supabaseAdmin.rpc("portal_request_pin_reset", { p_token: token });

    // Não vaza motivo exato (evita enumeração / probing)
    if (error) {
      return NextResponse.json(
        { ok: true, message: "Se o link estiver válido, enviaremos instruções no WhatsApp." },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { ok: true, message: "Se o link estiver válido, enviaremos instruções no WhatsApp." },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: true, message: "Se o link estiver válido, enviaremos instruções no WhatsApp." },
      { status: 200 }
    );
  }
}
