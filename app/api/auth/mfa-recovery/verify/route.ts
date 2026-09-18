// app/api/auth/mfa-recovery/verify/route.ts
//
// 🔴 18/09/2026, continuação de /mfa-recovery/request: confere o código
// enviado por WhatsApp/e-mail e, se bater, apaga TODOS os fatores TOTP do
// usuário via admin API (bypassa o aal2 que o unenroll normal exigiria —
// esse é justamente o propósito desta rota: um caminho alternativo pra
// quem não consegue mais produzir o código do app autenticador). O
// próprio Supabase já derruba todas as sessões ativas quando um fator
// verificado é apagado — o usuário precisa logar de novo depois disso.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function adminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

const MAX_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const code = String(body?.code || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }

    const supabaseAdmin = adminSupabase();

    const { data: reqRow } = await supabaseAdmin
      .from("mfa_recovery_requests")
      .select("id, code_hash, expires_at, used_at, attempts")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!reqRow || reqRow.used_at || new Date(reqRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "expired_or_missing" }, { status: 400 });
    }

    if (reqRow.attempts >= MAX_ATTEMPTS) {
      await supabaseAdmin.from("mfa_recovery_requests").update({ used_at: new Date().toISOString() }).eq("id", reqRow.id);
      return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
    }

    if (hashCode(code) !== reqRow.code_hash) {
      await supabaseAdmin.from("mfa_recovery_requests").update({ attempts: reqRow.attempts + 1 }).eq("id", reqRow.id);
      return NextResponse.json({ error: "invalid_code" }, { status: 400 });
    }

    // ✅ Código certo — marca usado ANTES de apagar o fator (evita reuso se
    // a chamada de deleteFactor demorar/falhar no meio).
    await supabaseAdmin.from("mfa_recovery_requests").update({ used_at: new Date().toISOString() }).eq("id", reqRow.id);

    const { data: factorsData } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: user.id });
    for (const factor of factorsData?.factors || []) {
      if (factor.status === "verified") {
        await supabaseAdmin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[mfa-recovery/verify] unexpected", err?.message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
