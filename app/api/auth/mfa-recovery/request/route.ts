// app/api/auth/mfa-recovery/request/route.ts
//
// 🔴 18/09/2026, pedido do Márcio: MFA (TOTP) opcional pro admin — essa
// rota cobre "perdi o acesso ao app autenticador". Manda um código de 6
// dígitos pro WhatsApp OU e-mail JÁ CADASTRADOS no perfil (nunca um
// contato vindo do body — só usa o que já está no banco, pra ninguém
// conseguir redirecionar a recuperação pra um número/e-mail próprio).
//
// Exige sessão válida (aal1 já basta — o usuário JÁ provou email+senha
// certos pra chegar até aqui; o que falta é só o segundo fator). O reset
// de verdade (apagar o fator MFA) só acontece na rota /verify, depois de
// confirmar o código.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { sendAdminEmail } from "@/lib/notifications/send-admin-email";
import { getWAContext } from "@/lib/whatsapp/wa-context";

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

// ✅ Cooldown — evita spam de código (WhatsApp/e-mail) e reduz a janela de
// tentativas de força bruta (cada pedido novo invalida os anteriores).
const COOLDOWN_MS = 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const channel = String(body?.channel || "").trim();
    if (channel !== "whatsapp" && channel !== "email") {
      return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
    }

    const supabaseAdmin = adminSupabase();

    // Só faz sentido recuperar se de fato existe um fator MFA verificado.
    const { data: factorsData } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: user.id });
    const hasVerifiedFactor = (factorsData?.factors || []).some((f: any) => f.status === "verified");
    if (!hasVerifiedFactor) {
      return NextResponse.json({ error: "no_mfa_enrolled" }, { status: 400 });
    }

    const { data: lastReq } = await supabaseAdmin
      .from("mfa_recovery_requests")
      .select("created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastReq && Date.now() - new Date(lastReq.created_at).getTime() < COOLDOWN_MS) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

    const { error: insErr } = await supabaseAdmin.from("mfa_recovery_requests").insert({
      user_id: user.id,
      code_hash: hashCode(code),
      channel,
      expires_at: expiresAt,
    });
    if (insErr) {
      console.error("[mfa-recovery/request] insert error", insErr.message);
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }

    if (channel === "email") {
      await sendAdminEmail(
        "Código de recuperação de MFA - UniGestor",
        `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <p>Você pediu pra desativar o MFA do UniGestor por não ter acesso ao app autenticador.</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${code}</p>
          <p>Esse código vale por 10 minutos. Se não foi você quem pediu, ignore este e-mail — o MFA continua ativo.</p>
        </div>`,
      );
    } else {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("whatsapp_username")
        .eq("id", user.id)
        .maybeSingle();
      const phone = String(profile?.whatsapp_username || "").trim();
      const waCtx = await getWAContext();
      if (!phone || !waCtx) {
        console.error("[mfa-recovery/request] whatsapp indisponível (sem telefone cadastrado ou WA_CONTEXT ausente)");
        return NextResponse.json({ error: "whatsapp_unavailable" }, { status: 502 });
      }
      const res = await fetch(`${waCtx.baseUrl}/send`, {
        method: "POST",
        headers: waCtx.headers,
        body: JSON.stringify({
          phone,
          message: `🔐 Código de recuperação de MFA do UniGestor: *${code}*\n\nVale por 10 minutos. Se não foi você quem pediu, ignore — o MFA continua ativo.`,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error("[mfa-recovery/request] falha ao enviar WhatsApp", res.status, errBody);
        return NextResponse.json({ error: "whatsapp_unavailable" }, { status: 502 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[mfa-recovery/request] unexpected", err?.message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
