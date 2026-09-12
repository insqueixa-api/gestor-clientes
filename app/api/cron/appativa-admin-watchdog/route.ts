// app/api/cron/appativa-admin-watchdog/route.ts
//
// ✅ 11/09/2026, pedido do Márcio (projeto de tirar o Fluid Compute — Grupo
// 2, ativação manual de app pelo admin). Mesmo espírito do
// app/api/cron/appativa-payment-watchdog (Grupo 1, fluxo de pagamento): a
// checagem síncrona dentro de `after()` (lib/apps/appativa-client-
// activation.ts) foi encurtada pra ~35s (era ~75s) pra caber em
// maxDuration=60 — a mesma medição real do Grupo 1 (nenhuma das confirmações
// reais já vistas coube em qualquer janela razoável dentro de uma única
// invocação: uma levou 124s, outra ~93min) vale aqui também, é o MESMO
// mecanismo de polling por trás dos dois fluxos. Este vigia é quem cobre o
// resto — rota diferente e secret diferente do vigia de pagamento (nome
// separado de propósito, os dois nunca compartilham fila).
//
// ⚠️ Diferença do vigia de pagamento: aqui NÃO existe client_portal_payments
// — o estado pendente vive em client_apps.field_values._appativa_pending_id
// (chave fixa, ver triggerAppativaActivationForClient). Rodando de 1 em 1
// minuto (pg_cron), mas SÓ consulta o próprio banco primeiro — se não achar
// nenhum client_apps com o marcador, sai sem nunca bater na API da Appativa.
// Volume real é ínfimo (0 pendências no momento em que este vigia foi
// criado) — na prática roda "vazio" quase sempre.
//
// ⚠️ Achado 11/09/2026 (revisão antes de subir): a 1ª versão filtrava por
// `client_apps.created_at` dentro de 3h — errado, porque `created_at` é
// quando o APP foi cadastrado, não quando a ativação foi disparada. Um
// admin ativando a Appativa num app antigo (cadastrado há semanas) nunca
// cairia na janela, mesmo pendente há 1 minuto. Não existe coluna "pending
// desde" nesta tabela (diferente de client_portal_payments, no vigia de
// pagamento, onde created_at nasce junto com o próprio pagamento).
//
// Sem coluna certa pra basear uma janela de tempo, e como o volume real é
// ínfimo (0 pendências historicamente), a solução é simplesmente NÃO ter
// janela — só o marcador `_appativa_pending_id` presente já basta pra
// entrar na consulta. Isso nunca fica "pendurado pra sempre" de forma
// custosa: o marcador é removido assim que resolve (sucesso ou rejeição
// real) por qualquer um dos 3 caminhos (after() da própria ativação, este
// vigia, ou o botão manual "Ver status") — enquanto ele existir, é sinal
// de que ainda há algo genuinamente em aberto, então vale continuar
// checando, e o custo de checar algo raro é desprezível.
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isCronRequest } from "@/lib/internal-auth";
import { checkAppativaHistoricoOnce } from "@/lib/apps/appativa-client-activation";
import { getAppativaApiKey } from "@/lib/integrations/appativa";
import { findFieldByType } from "@/lib/apps/panel";

export const dynamic = "force-dynamic";
// ✅ 12/09/2026: 60s → 120s, Fluid Compute mantido de vez — sem mais teto de
// 60s do Hobby. Na prática quase sempre roda "vazio" (sai antes de bater na
// Appativa), então isso é só folga extra pro caso raro do lote de até 20
// pendências demorar mais que o normal.
export const maxDuration = 120;

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function handle(req: Request) {
  if (!isCronRequest(req, "APPATIVA_ADMIN_WATCHDOG_CRON_SECRET")) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // 1) só consulta o próprio banco — barato, nunca bate na API da Appativa
  // se não achar nada. Sem filtro de janela (ver comentário acima do
  // arquivo) — só a presença do marcador já basta.
  const { data: pending, error } = await supabaseAdmin
    .from("client_apps")
    .select("id, tenant_id, field_values, apps(fields_config)")
    .not("field_values->>_appativa_pending_id", "is", null)
    .limit(20);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!pending?.length) {
    return Response.json({ ok: true, pendentes: 0 });
  }

  // 2) achou pendência de verdade — aí sim reconsulta cada uma. Chave da
  // Appativa é por tenant (api_integrations), cacheada aqui pra não repetir
  // a consulta se vier mais de um client_apps do mesmo tenant no lote.
  const apiKeyCache = new Map<string, string | null>();
  let resolved = 0;
  let failed = 0;

  for (const row of pending as any[]) {
    const historicoId = row.field_values?.["_appativa_pending_id"];
    if (!historicoId) continue;

    let apiKey = apiKeyCache.get(row.tenant_id);
    if (apiKey === undefined) {
      apiKey = await getAppativaApiKey(supabaseAdmin, row.tenant_id);
      apiKeyCache.set(row.tenant_id, apiKey);
    }
    if (!apiKey) continue; // sem chave configurada pro tenant — nada a checar

    try {
      const check = await checkAppativaHistoricoOnce(apiKey, historicoId);
      if (check.outcome === "pending") continue;

      const { _appativa_pending_id, ...restFieldValues } = row.field_values || {};

      if (check.outcome === "done") {
        const fieldsConfig = Array.isArray(row.apps?.fields_config) ? row.apps.fields_config : [];
        const dateField = findFieldByType(fieldsConfig, "date");
        const updated = dateField
          ? { ...restFieldValues, [String(dateField.id || dateField.label)]: check.expireDate }
          : restFieldValues;
        await supabaseAdmin.from("client_apps").update({ field_values: updated }).eq("id", row.id);
        resolved++;
      } else {
        // outcome === "error" — recusa de verdade (rejeição), não
        // "vencimento não bateu" (esse já vira "pending" dentro de
        // checkAppativaHistoricoOnce, não chega aqui).
        await supabaseAdmin.from("client_apps").update({ field_values: restFieldValues }).eq("id", row.id);
        failed++;
      }
    } catch {
      // best-effort — próxima rodada do cron tenta de novo
    }
  }

  return Response.json({ ok: true, pendentes: pending.length, resolvidos: resolved, com_erro: failed });
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
