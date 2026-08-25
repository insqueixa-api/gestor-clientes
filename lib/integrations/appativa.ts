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

const APPATIVA_BASE_URL = "https://api.ativeapp.com";

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
