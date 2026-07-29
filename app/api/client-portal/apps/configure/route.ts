// app/api/client-portal/apps/configure/route.ts
// "Reconfigurar" do Bloco 3 — autenticação e trava de tentativas (rate
// limit) ficam aqui, que são política do portal; a parte de falar de
// verdade com o painel do parceiro (delete-then-create, recheck do
// GERENCIAAPP, persistência do vencimento) mora em lib/apps/orchestration.ts
// e é a mesma usada por app/api/admin/apps/configure/route.ts.
import { NextRequest, NextResponse, after } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { logAppActivity } from "@/lib/apps/panel";
import { loadClientApp, configureClientApp } from "@/lib/apps/orchestration";

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
  let tenantId = "";
  let client_id = "";
  let client_app_id = "";
  let appName = "Aplicativo";
  let supabaseAdmin: ReturnType<typeof makeSupabaseAdmin> = null;

  try {
    supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    client_id = normalizeStr(body?.client_id);
    client_app_id = normalizeStr(body?.client_app_id);
    // "Secundária" (pedido do Márcio, 28/07/2026): força regenerar o m3u_url
    // sorteando outra DNS do servidor, em vez de reaproveitar o que já está
    // salvo (comportamento padrão/"Principal").
    const mode = body?.mode === "secundaria" ? "secundaria" : "principal";

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    tenantId = ctx.tenant_id;
    if (!client_app_id) return jsonError("client_app_id é obrigatório", 400);

    const row = await loadClientApp(supabaseAdmin, { clientAppId: client_app_id, tenantId, clientId: client_id });
    if (!row) return jsonError("Aplicativo não encontrado", 404);
    appName = row.appName;

    // ✅ Trava de tentativas (pedido do Márcio, 28/07/2026): "Reconfigurar"
    // apaga e recria do zero no painel do parceiro — clicar repetido sem
    // necessidade não ajuda em nada e pode até confundir o estado lá. Janela
    // de 30min = mesma validade (deslizante) da sessão do portal, então a
    // trava acompanha naturalmente o "abrir o portal de novo" do cliente.
    // 1ª tentativa (0 sucessos na janela): livre, sem aviso.
    // 2ª tentativa (1 sucesso na janela): libera, mas avisa que é a mesma
    // ação de novo (repeat_warning no response).
    // 3ª+ tentativa (2+ sucessos na janela): bloqueia — não chama o
    // parceiro, direciona pro suporte.
    const RATE_LIMIT_WINDOW_MIN = 30;
    const { data: recentEvents } = await supabaseAdmin
      .from("client_app_activity_log")
      .select("event")
      .eq("client_app_id", client_app_id)
      .in("event", ["configured", "configure_failed"])
      .gte("created_at", new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60 * 1000).toISOString());

    const recentSuccesses = (recentEvents || []).filter((e: any) => e.event === "configured").length;
    const recentFailures = (recentEvents || []).filter((e: any) => e.event === "configure_failed").length;

    if (recentSuccesses >= 2) {
      after(() =>
        logAppActivity(supabaseAdmin, {
          tenantId,
          clientId: client_id,
          clientAppId: client_app_id,
          appName,
          event: "configure_failed",
          detail: { blocked: true, reason: "rate_limit" },
        }),
      );
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          error:
            "Você já reconfigurou esse aplicativo algumas vezes nos últimos 30 minutos. Pra não ficarmos tentando à toa, fale com o suporte que a gente confere isso juntos.",
        },
        { status: 429, headers: NO_STORE_HEADERS },
      );
    }

    const result = await configureClientApp(supabaseAdmin, row, mode);

    // ✅ Comparação explícita (=== false), não `!result.ok` — o projeto roda
    // com strict:false no tsconfig, e sem strictNullChecks o TS não
    // discrimina a union corretamente a partir de negação de boolean.
    if (result.ok === false) {
      if (result.stage === "precondition") {
        return jsonError(result.error, result.status);
      }

      // ✅ Nunca mostra o erro técnico cru pro cliente (pedido do Márcio,
      // 28/07/2026) — o motivo real (result.error) já foi pro log abaixo pra
      // auditoria. 1ª falha na janela: pede pra tentar de novo. 2ª+ falha
      // seguida (recentFailures já tinha pelo menos 1 antes dessa): escala
      // pro suporte em vez de insistir.
      const escalate = recentFailures >= 1;
      // ✅ Guia o cliente pela sequência Principal → Secundária → suporte
      // (pedido do Márcio, 28/07/2026).
      const suggestSecondary = mode === "principal" && (recentSuccesses > 0 || recentFailures > 0);

      after(() =>
        logAppActivity(supabaseAdmin, {
          tenantId,
          clientId: client_id,
          clientAppId: client_app_id,
          appName,
          event: "configure_failed",
          detail: { error: result.error },
        }),
      );

      return NextResponse.json(
        {
          ok: false,
          escalate,
          suggest_secondary: suggestSecondary,
          error: escalate
            ? "Houve uma nova falha ao configurar esse aplicativo. Fale com o suporte pra gente resolver juntos."
            : "Houve uma falha ao configurar esse aplicativo. Tente mais uma vez — se continuar falhando, fale com o suporte.",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    after(() =>
      logAppActivity(supabaseAdmin, {
        tenantId,
        clientId: client_id,
        clientAppId: client_app_id,
        appName,
        event: "configured",
        detail: result.expireDate ? { expireDate: result.expireDate } : null,
      }),
    );

    return NextResponse.json(
      {
        ok: true,
        expireDate: result.expireDate,
        message: result.message || "Configurado com sucesso.",
        // ✅ 2ª tentativa dentro da janela (1 sucesso recente já contabilizado
        // antes dessa) — avisa o cliente que é a mesma ação de novo, mas não
        // bloqueia (só a 3ª+ bloqueia, ver trava no topo da rota).
        repeat_warning: recentSuccesses === 1,
        suggest_secondary: mode === "principal" && (recentSuccesses > 0 || recentFailures > 0),
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (e: any) {
    // ✅ Log best-effort mesmo em exceção não tratada — só loga se já sabemos
    // o tenant (senão não tem pra qual tenant gravar) — falha aberta, nunca
    // derruba a resposta de erro por causa do log.
    if (tenantId && client_app_id) {
      try {
        await logAppActivity(supabaseAdmin, {
          tenantId,
          clientId: client_id,
          clientAppId: client_app_id,
          appName,
          event: "configure_failed",
          detail: { error: e?.message || "Erro interno inesperado.", unexpected: true },
        });
      } catch {
        // não deixa o log derrubar a resposta de erro
      }
    }
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
