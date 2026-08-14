// app/api/integrations/apps/duplecast/route.ts
//
// Proxy fino pra VM (whatsapp-service, POST /duplecast/action). A Vercel não
// consegue passar do Cloudflare do duplecast.com de jeito nenhum — testado
// ao vivo de 3 IPs diferentes (esta função, o proxy residencial BR já usado
// por outras integrações, e a própria VM antes do FlareSolverr), sempre a
// mesma página "Just a moment..." (desafio JS), HTTP 403. Não é reputação de
// IP: qualquer requisição sem motor de JavaScript é barrada.
//
// A VM tem o FlareSolverr (container Docker local) resolvendo esse desafio
// numa única chamada; o resto do fluxo (login por mac+device_key, criar/
// checar/apagar playlist) reaproveita os cookies direto — ver
// whatsapp-service/src/duplecastClient.js pra lógica real (portada 1:1 do
// que já estava aqui antes, só que rodando na VM em vez da Vercel).
//
//   - Login: POST device_login/ {mac, device_key} → sessão fica presa a ESSE
//     dispositivo (sem precisar filtrar por MAC nas próximas chamadas).
//   - device_main/ mostra "Expire on DD/MM/YYYY" — vencimento real do
//     dispositivo.
//   - Add Playlist: device_main/add/, form_action=generate_m3u_playlist
//     (m3u_name, m3u_playlist, epg_url, note, locked/pin/confirm_pin).
//   - Delete (device_main/delete/{id}/) exige POST com _csrf_token+0+submit=Yes
//     (GET sozinho não apaga). Nunca pede PIN, mesmo pra playlist marcada
//     "Protected" — só o Edit pede PIN via modal.
// Login por device_key elimina a dependência do login_email/login_password
// de revendedor pra esse app (esses campos continuam salvos em
// app_integrations por histórico, mas não são mais usados aqui).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    if (hasBadInternalHeader(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const internal = isInternalRequest(req);

    let supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdmin>;
    if (internal) {
      supabase = createAdmin(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
    } else {
      supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, macValue, finalServerName, m3uUrl, password, username, deviceKey } = body;

    if (!action) {
      return NextResponse.json({ ok: false, error: "action é obrigatório." }, { status: 400 });
    }
    if (!macValue) {
      return NextResponse.json({ ok: false, error: "macValue é obrigatório." }, { status: 400 });
    }
    if (!deviceKey) {
      return NextResponse.json(
        { ok: false, error: "Device Key é obrigatório pro Duplecast agora — preencha o campo 'Device Key' desse app." },
        { status: 400 },
      );
    }

    const { data: integ, error: integErr } = await supabase
      .from("app_integrations")
      .select("api_url")
      .eq("app_name", "DUPLECAST")
      .maybeSingle();

    if (integErr || !integ?.api_url) {
      return NextResponse.json({ ok: false, error: "Integração Duplecast não configurada." }, { status: 500 });
    }

    const baseUrl = new URL(integ.api_url).origin;

    const vmBaseUrl = process.env.UNIGESTOR_WA_BASE_URL;
    const vmToken = process.env.UNIGESTOR_WA_TOKEN;
    if (!vmBaseUrl || !vmToken) {
      return NextResponse.json({ ok: false, error: "VM não configurada (UNIGESTOR_WA_BASE_URL/UNIGESTOR_WA_TOKEN)." }, { status: 500 });
    }

    let vmPayload: Record<string, unknown> = { action, baseUrl, macValue, deviceKey };
    if (action === "create") {
      vmPayload = { ...vmPayload, m3uName: finalServerName, m3uUrl, pin: password };
    } else if (action === "delete") {
      vmPayload = { ...vmPayload, searchName: finalServerName || username, pin: password };
    }

    const vmRes = await fetch(`${vmBaseUrl.replace(/\/$/, "")}/duplecast/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${vmToken}`,
      },
      body: JSON.stringify(vmPayload),
      // ✅ 58s (maxDuration é 60s) — dá espaço pro retry de 2 tentativas do
      // duplecastClient.js na VM (até ~46s só pra resolver o Cloudflare nos
      // casos mais lentos) + o resto do fluxo (login + ação).
      signal: AbortSignal.timeout(58000),
    });
    const vmJson = await vmRes.json().catch(() => ({}) as any);

    if (!vmRes.ok || !vmJson?.ok) {
      return NextResponse.json(
        { ok: false, error: vmJson?.error || `Falha na VM (HTTP ${vmRes.status}).` },
        { status: vmRes.status === 404 ? 404 : 500 },
      );
    }

    if (action === "check") {
      return NextResponse.json({
        ok: true,
        expireDate: vmJson.expireDate ?? null,
        isTrial: !!vmJson.isTrial,
        message: vmJson.expireDate
          ? "Vencimento atualizado."
          : vmJson.isTrial
            ? "Dispositivo ainda em modo trial — Duplecast não informa vencimento até ativar a licença."
            : "Não foi possível localizar o vencimento no painel.",
      });
    }

    if (action === "create") {
      return NextResponse.json({ ok: true, expireDate: vmJson.expireDate ?? null, message: "Playlist configurada com sucesso." });
    }

    if (action === "delete") {
      return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
    }

    return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete | check" }, { status: 400 });
  } catch (e: any) {
    const msg = e?.name === "TimeoutError" || e?.name === "AbortError" ? "Timeout ao contatar a VM (Cloudflare pode estar demorando)." : (e.message || "Erro interno.");
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
