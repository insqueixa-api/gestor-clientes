// app/api/integrations/elite/sync/route.ts
// ✅ 05/10/2026: saldo do Elite pela API oficial (GET /me) — antes o front
// pedia login/senha aqui ("get_credentials") e a extensão raspava o painel
// antigo (adminx.offo.dad, fora do ar). Agora é igual NaTV/Fast: o front (ou
// chamada interna) só manda integration_id e a rota faz tudo no servidor —
// a chave nunca sai do backend.
import { NextResponse } from "next/server";
import { resolveEliteCaller } from "@/lib/integrations/elite-auth";
import { EliteApiError, eliteMe, loadEliteIntegration } from "@/lib/integrations/elite-api";
import { adminSupabase } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const integration_id = String(body?.integration_id ?? "").trim();
    if (!integration_id) {
      return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });
    }

    const caller = await resolveEliteCaller(req, body);
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const tenantId = caller.tenantId;

    const integ = await loadEliteIntegration(integration_id, tenantId);
    const me = await eliteMe(integ);

    const patch: Record<string, unknown> = { credits_last_sync_at: new Date().toISOString() };
    if (me.credits !== null) patch.credits_last_known = me.credits;
    if (me.username) patch.owner_username = me.username;
    if (me.id !== null && Number.isFinite(me.id)) patch.owner_id = me.id;

    const { error: upErr } = await adminSupabase()
      .from("server_integrations")
      .update(patch)
      .eq("id", integ.id)
      .eq("tenant_id", tenantId);
    if (upErr) throw new Error("Falha ao salvar o saldo.");

    if (me.credits === null) {
      // resposta num formato que ainda não conhecemos — loga pra ajustar o parser
      console.error("[ELITE] /me sem saldo reconhecível", JSON.stringify(me.raw).slice(0, 800));
    }

    return NextResponse.json({
      ok: true,
      message:
        me.credits !== null
          ? `Saldo do Elite sincronizado: ${me.credits} crédito(s).`
          : "Chave do Elite validada, mas o saldo veio num formato inesperado.",
      owner: { id: me.id, username: me.username, credits: me.credits },
    });
  } catch (e: any) {
    const status = e instanceof EliteApiError && e.status >= 400 && e.status < 500 ? e.status : 500;
    console.error("[integration_error:elite:sync]", {
      message: e?.message,
      status: e?.status,
      requestId: e?.requestId,
      kind: "integration_error",
      provider: "elite",
      action: "sync",
    });
    return NextResponse.json({ ok: false, error: e?.message || "Falha no sync ELITE." }, { status });
  }
}
