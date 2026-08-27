// lib/integrations/appativa.ts
//
// Chamadas de ativação de licença de app na Appativa (appativa.store /
// api.ativeapp.com) — parceiro cadastrado em api_integrations
// (provider='APPATIVA'). Auth via header X-API-Key; a chave é sempre
// resolvida pelo caller (nunca busca sozinha aqui, nunca de env var — pode
// rotacionar a qualquer momento, ver docs/sql/api_integrations_partners.sql).
//
// ⚠️ Ambos os endpoints são ASSÍNCRONOS: só devolvem um id (a ativação
// entra numa fila do lado deles), NUNCA o vencimento real. A confirmação
// de verdade (sucesso ou erro, com motivo) chega depois via webhook
// (app/api/webhooks/appativa/route.ts) — ver project_appativa_integration
// na memória pra doc completa.
//
// Fail-soft: nunca lançam — erro de rede/HTTP vira {ok:false, error},
// mesmo padrão já usado em checkClientAppValidity (lib/apps/orchestration.ts).

import { notify, resolveNotification } from "@/lib/notifications/notify";

const APPATIVA_BASE_URL = "https://api.ativeapp.com";

// ✅ Janela de checagem automática pós-solicitação (achado 26/08/2026,
// pedido do Márcio — testando ativações reais, percebeu que a Appativa
// nunca confirma antes de uns 15s, então checar antes disso só gasta uma
// tentativa à toa). Compartilhado entre o fluxo de pagamento no Portal
// (lib/client-portal/fulfillment.ts) e a ativação manual pelo admin
// (lib/apps/appativa-client-activation.ts) — os dois usam a MESMA janela,
// pra nunca ficarem dessincronizados de novo.
export const APPATIVA_INITIAL_DELAY_MS = 15_000;
export const APPATIVA_POLL_INTERVAL_MS = 5_000;
export const APPATIVA_POLL_TOTAL_MS = 60_000;
export const APPATIVA_POLL_ATTEMPTS = Math.floor(APPATIVA_POLL_TOTAL_MS / APPATIVA_POLL_INTERVAL_MS);

type AppativaResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function appativaFetch<T>(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<AppativaResult<T>> {
  try {
    const res = await fetch(`${APPATIVA_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({} as any));

    if (!res.ok || json?.sucesso === false) {
      const msg =
        json?.erro || json?.message || `Falha ao chamar a Appativa (HTTP ${res.status})`;
      return { ok: false, error: String(msg) };
    }

    return { ok: true, data: json as T };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha ao conectar com a Appativa" };
  }
}

export type SolicitarAtivacaoResult = { id: string };

// ✅ Apesar do nome do campo "app_uuid" na API deles, o valor esperado é o
// "id" do catálogo (listar-aplicativos), não o "uuid" — achado documentado
// na doc deles e já refletido em apps.appativa_app_id (que já guarda o id
// certo). Ver comentário em docs/sql/apps_appativa_mapping.sql.
export async function solicitarAtivacao(
  apiKey: string,
  params: { appativaAppId: string; macApp: string; keyApp?: string },
): Promise<AppativaResult<SolicitarAtivacaoResult>> {
  return appativaFetch<SolicitarAtivacaoResult>(apiKey, "/api/solicitar-ativacao", {
    app_uuid: params.appativaAppId,
    mac_app: params.macApp,
    ...(params.keyApp ? { key_app: params.keyApp } : {}),
  });
}

export type ReenviarAtivacaoResult = {
  historico_id: string;
  ajuste_credito?: { tipo: string; valor: number };
};

export async function reenviarAtivacao(
  apiKey: string,
  params: {
    historicoId: string;
    appativaAppId?: string;
    macApp?: string;
    keyApp?: string;
    obs?: string;
  },
): Promise<AppativaResult<ReenviarAtivacaoResult>> {
  return appativaFetch<ReenviarAtivacaoResult>(apiKey, "/api/reenviar-ativacao", {
    historico_id: params.historicoId,
    ...(params.appativaAppId ? { app_uuid: params.appativaAppId } : {}),
    ...(params.macApp ? { mac_app: params.macApp } : {}),
    ...(params.keyApp ? { key: params.keyApp } : {}),
    ...(params.obs ? { obs: params.obs } : {}),
  });
}

// ✅ Achado 25/08/2026 (Márcio, em produção — primeira ativação real): o
// webhook deles pode demorar muito ou nunca disparar (o próprio /api/
// historico tem um campo `enviado_n8n` que ficou `false` minutos depois de
// uma ativação já confirmada do lado deles). Em vez de confiar só no push,
// reconsultamos direto: /api/historico aceita um filtro `id` (não
// documentado, mas testado e funcionando — devolve exatamente o item da
// ativação, com total:1). Essa é a MESMA fonte que a Appativa mostra no
// dashboard deles (appativa.store/reseller/activations) — não precisa de
// login/sessão, só a X-API-Key normal.
//
// ⚠️ A resposta desse endpoint especificamente vem envelopada em
// `success_case.body` (confirmado ao vivo — diferente de solicitar-ativacao/
// reenviar-ativacao, que devolvem o corpo direto). Tratado de forma
// defensiva abaixo (aceita os dois formatos) caso isso mude no futuro.
export type HistoricoItem = {
  id: string;
  status_transacao: string;
  data_expiracao?: string | null;
  data_expiracao_at?: string | null;
  obs?: string | null;
  mac_app?: string | null;
  nome_app?: string | null;
};

export async function consultarAtivacao(
  apiKey: string,
  historicoId: string,
): Promise<AppativaResult<HistoricoItem>> {
  try {
    const res = await fetch(
      `${APPATIVA_BASE_URL}/api/historico?id=${encodeURIComponent(historicoId)}`,
      { headers: { "X-API-Key": apiKey }, cache: "no-store" },
    );
    const json = await res.json().catch(() => ({} as any));
    const body = json?.success_case?.body ?? json;

    if (!res.ok || body?.sucesso === false) {
      const msg = body?.erro || body?.message || `Falha ao consultar histórico (HTTP ${res.status})`;
      return { ok: false, error: String(msg) };
    }

    const item = Array.isArray(body?.items) ? body.items[0] : null;
    if (!item) return { ok: false, error: "Ativação não encontrada no histórico da Appativa." };

    return { ok: true, data: item as HistoricoItem };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha ao conectar com a Appativa" };
  }
}

// ✅ Limiar próprio do parceiro (diferente do <=15 usado pros servidores
// IPTV) — mesmo valor já usado em app/api/integrations/appativa/
// sync-credits/route.ts, testado e confirmado funcionando em produção
// 25/08/2026 (sino + valor certo).
const LOW_CREDITS_THRESHOLD = 5;

// ✅ Extraída de app/api/integrations/appativa/sync-credits/route.ts
// (26/08/2026, achado do Márcio: o saldo mostrado na aba Parceiros ficava
// desatualizado depois de uma ativação real — só atualizava quando alguém
// clicava "Sincronizar" manualmente). Reaproveitada pelo botão manual E
// chamada automaticamente depois de toda solicitação/reenvio de ativação
// real (markAppRenewalPaid e as 2 rotas de retry), já que é exatamente o
// momento em que o saldo muda do lado deles. Fail-soft — nunca lança,
// nunca deve derrubar o fluxo de ativação que a chamou.
export async function syncAppativaCredits(
  supabaseAdmin: any,
  tenantId: string,
): Promise<{ ok: boolean; credits?: number; error?: string }> {
  const { data: integration } = await supabaseAdmin
    .from("api_integrations")
    .select("id, label, api_key")
    .eq("tenant_id", tenantId)
    .eq("provider", "APPATIVA")
    .eq("is_active", true)
    .maybeSingle();

  const apiKey = String(integration?.api_key || "").trim();
  if (!integration || !apiKey) return { ok: false, error: "Parceiro Appativa não encontrado/sem chave" };

  let creditsData: any;
  try {
    const res = await fetch(`${APPATIVA_BASE_URL}/api/creditos-disponiveis`, {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
    });
    creditsData = await res.json().catch(() => ({} as any));
    if (!res.ok || creditsData?.sucesso !== true) {
      return { ok: false, error: creditsData?.erro || creditsData?.message || "Falha ao consultar créditos" };
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha ao conectar com a Appativa" };
  }

  const credits = Number(creditsData?.creditos_disponiveis);

  await supabaseAdmin
    .from("api_integrations")
    .update({ credits_available: credits, credits_last_sync_at: new Date().toISOString() })
    .eq("id", integration.id)
    .eq("tenant_id", tenantId);

  if (Number.isFinite(credits) && credits < LOW_CREDITS_THRESHOLD) {
    try {
      await notify({
        tenantId,
        type: "saldo_baixo",
        title: "🪫 Saldo Baixo — Parceiro",
        message: `O parceiro "${integration.label}" está com apenas ${credits} crédito(s). Recarregue para evitar interrupção nas ativações.`,
        link: "/admin/settings/api-server",
        sourceId: integration.id,
      });
    } catch {
      // não bloqueia o sync por falha na notificação
    }
  } else if (Number.isFinite(credits)) {
    try {
      await resolveNotification(tenantId, "saldo_baixo", integration.id);
    } catch {
      // não bloqueia o sync por falha ao resolver a notificação
    }
  }

  return { ok: true, credits };
}

// ✅ Chave ativa do parceiro — resolvida uma vez, reaproveitada pelos
// callers (markAppRenewalPaid, retry-activation route). Sempre lida fresca
// do banco, nunca cacheada entre invocações da function.
export async function getAppativaApiKey(
  supabaseAdmin: any,
  tenantId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("api_integrations")
    .select("api_key")
    .eq("tenant_id", tenantId)
    .eq("provider", "APPATIVA")
    .eq("is_active", true)
    .maybeSingle();
  const key = String(data?.api_key || "").trim();
  return key || null;
}
