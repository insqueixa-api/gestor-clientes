// lib/apps/appativa-client-activation.ts
//
// Ativação/renovação via Appativa disparada MANUALMENTE pelo admin, direto
// na tela do cliente (achado 26/08/2026, pedido do Márcio: "ali eu também
// deveria chamar essa integração pra confirmar essa ativação dos
// aplicativos" — mesmo espírito do botão "Marcar pago" do GPC Roku, ver
// lib/apps/gpc-roku-registry.ts, mas pra Appativa).
//
// ⚠️ Diferença importante: a Appativa é ASSÍNCRONA (solicitar-ativacao só
// devolve um id, a confirmação real leva alguns segundos) — diferente do
// GerenciaApp (síncrono). E, ao contrário do fluxo de pagamento
// (lib/client-portal/fulfillment.ts), aqui NÃO existe um client_portal_
// payments de verdade (o admin pode estar chamando isso sem nenhum
// pagamento ter passado pelo sistema — ex: cliente pagou por fora). Por
// isso este módulo NUNCA toca client_portal_payments — confirma e persiste
// direto em client_apps.field_values, com sua própria checagem em segundo
// plano (mesma janela 15s+5s/1min de fulfillment.ts, constantes
// compartilhadas de lib/integrations/appativa.ts).
import { after } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { findFieldByType } from "@/lib/apps/panel";
import {
  solicitarAtivacao,
  consultarAtivacao,
  getAppativaApiKey,
  syncAppativaCredits,
  APPATIVA_INITIAL_DELAY_MS,
  APPATIVA_POLL_INTERVAL_MS,
  APPATIVA_POLL_ATTEMPTS,
} from "@/lib/integrations/appativa";

const APPATIVA_SUCCESS_STATUSES = new Set(["ativado", "aprovado"]);
const APPATIVA_FAILURE_STATUSES = new Set(["incorreto", "reprovado"]);
const APPATIVA_MIN_DAYS_FORWARD = 300;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function extractDateOnly(v: unknown): string | null {
  if (!v) return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Uma tentativa de checagem — mesma lógica de validação de
// resolveAppativaAppRenewal (lib/client-portal/fulfillment.ts), só que sem
// nenhuma dependência de client_portal_payments.
//
// ✅ Exportada (achado 27/08/2026, pedido do Márcio: "ver status" quando a
// ativação manual está em andamento) — reaproveitada também pela rota
// síncrona app/api/admin/apps/appativa/status/route.ts, pra checar o
// historicoId salvo sem duplicar essa lógica de novo.
export async function checkAppativaHistoricoOnce(
  apiKey: string,
  historicoId: string,
): Promise<{ outcome: "done"; expireDate: string } | { outcome: "pending" } | { outcome: "error"; error: string }> {
  const result = await consultarAtivacao(apiKey, historicoId);
  if (!("data" in result)) return { outcome: "pending" };

  const item = result.data;
  const status = String(item.status_transacao || "").trim().toLowerCase();

  if (APPATIVA_FAILURE_STATUSES.has(status)) {
    return {
      outcome: "error",
      error: `Appativa recusou a ativação (status: "${item.status_transacao}"). Confira o Device ID (MAC) do aplicativo.`,
    };
  }
  if (!APPATIVA_SUCCESS_STATUSES.has(status)) {
    return { outcome: "pending" };
  }

  const rawExpire = item.data_expiracao_at || item.data_expiracao || null;
  const dateOnly = extractDateOnly(rawExpire);
  const daysForward = dateOnly ? (new Date(`${dateOnly}T23:59:59`).getTime() - Date.now()) / MS_PER_DAY : -1;
  if (!dateOnly || daysForward < APPATIVA_MIN_DAYS_FORWARD) {
    return {
      outcome: "error",
      error: "Appativa confirmou a ativação, mas o vencimento devolvido não bateu com o esperado (renovação anual/vitalícia). Verifique manualmente.",
    };
  }
  return { outcome: "done", expireDate: dateOnly };
}

export async function triggerAppativaActivationForClient(
  supabaseAdmin: SupabaseClient,
  params: {
    tenantId: string;
    clientAppId: string;
    appativaAppId: string;
    macApp: string;
    keyApp?: string | null;
    fieldsConfig: any[];
    fieldValues: Record<string, string>;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = await getAppativaApiKey(supabaseAdmin, params.tenantId);
  if (!apiKey) {
    return { ok: false, error: "Parceiro Appativa sem chave configurada (Configurações → Parceiros)." };
  }

  const result = await solicitarAtivacao(apiKey, {
    appativaAppId: params.appativaAppId,
    macApp: params.macApp,
    keyApp: params.keyApp || undefined,
  });

  // ⚠️ Narrowing via `"data" in result`, mesmo motivo documentado em
  // lib/client-portal/fulfillment.ts (strict:false não estreita bem uniões
  // discriminadas por igualdade literal).
  if (!("data" in result)) {
    return { ok: false, error: `Appativa: ${result.error}` };
  }

  const historicoId = String(result.data.id);

  // ✅ Marca "ativação em andamento" (achado 27/08/2026, pedido do Márcio:
  // "deixa um ver status no admin, no caso quando tem a ativação em
  // andamento") — persiste ANTES de responder, pra tela do cliente já
  // conseguir mostrar "Ver status" em vez de "Ativar via Appativa" mesmo
  // que o admin recarregue a página logo em seguida. Chave prefixada com
  // "_" segue o mesmo padrão já usado por "_trial_hint" (lib/apps/
  // orchestration.ts) — nunca aparece no formulário, só como estado interno.
  const fieldValuesWithPending = { ...params.fieldValues, _appativa_pending_id: historicoId };
  try {
    await supabaseAdmin
      .from("client_apps")
      .update({ field_values: fieldValuesWithPending })
      .eq("id", params.clientAppId);
  } catch {
    // best-effort — não bloqueia a ativação em si
  }

  // ✅ Confirmação roda em segundo plano (after()) — o admin já recebe
  // "solicitado" na hora; a tela reflete o vencimento novo sozinha assim que
  // resolver (sem precisar de um client_portal_payments pra guardar
  // estado — persiste direto em client_apps.field_values).
  after(async () => {
    await syncAppativaCredits(supabaseAdmin, params.tenantId).catch(() => {});
    try {
      await new Promise((resolve) => setTimeout(resolve, APPATIVA_INITIAL_DELAY_MS));
      for (let i = 0; i < APPATIVA_POLL_ATTEMPTS; i++) {
        const check = await checkAppativaHistoricoOnce(apiKey, historicoId);
        if (check.outcome === "done") {
          const { _appativa_pending_id, ...restFieldValues } = fieldValuesWithPending;
          const dateField = findFieldByType(params.fieldsConfig, "date");
          const updated = dateField
            ? { ...restFieldValues, [String(dateField.id || dateField.label)]: check.expireDate }
            : restFieldValues;
          await supabaseAdmin
            .from("client_apps")
            .update({ field_values: updated })
            .eq("id", params.clientAppId);
          return;
        }
        if (check.outcome === "error") {
          // ✅ Best-effort — sem sino aqui (foi o próprio admin quem
          // acionou, na tela do cliente; ele confere o resultado voltando
          // nessa mesma tela). Sentry.captureMessage seria redundante com
          // o que solicitar-ativacao/consultar-ativacao já registram.
          const { _appativa_pending_id, ...restFieldValues } = fieldValuesWithPending;
          try {
            await supabaseAdmin
              .from("client_apps")
              .update({ field_values: restFieldValues })
              .eq("id", params.clientAppId);
          } catch {
            // best-effort — a checagem de erro em si já é o que importa
          }
          return;
        }
        if (i < APPATIVA_POLL_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, APPATIVA_POLL_INTERVAL_MS));
        }
      }
      // ⚠️ Esgotou as tentativas sem confirmar nem errar — _appativa_pending_id
      // fica salvo de propósito (sem log/Auditoria, por pedido do Márcio):
      // é exatamente o que habilita o botão "Ver status" pra checar de novo
      // depois, manualmente.
    } catch {
      // best-effort — não derruba nada, o admin pode tentar de novo
    }
  });

  return { ok: true };
}
