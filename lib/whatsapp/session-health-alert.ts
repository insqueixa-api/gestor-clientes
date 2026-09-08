// lib/whatsapp/session-health-alert.ts
// ✅ 05/09/2026, pedido do Márcio: nada de timer de 5 em 5 minutos rodando
// sozinho — a checagem de erros de sessão/decriptação (Bad MAC/Failed to
// decrypt/Closing session/recv retry request na VM, ver
// whatsapp-service/src/sessionManager.js::getAndResetSessionHealth) só deve
// acontecer quando: (1) alguém clica "Sincronizar agora" no painel Sistema
// (ou o cron de 5min que JÁ existia pra outras checagens dessa tela chama a
// mesma rota — ver system-health-check/route.ts), ou (2) um envio real de
// mensagem acontece (envio_agora/envio_programado/envio_avulso, que já
// checam a resposta da VM pra outras coisas — mesmo espírito do cache de
// conectividade em disconnect-alert.ts).
//
// ❌ 08/09/2026: o sino+e-mail que existia aqui (SUSTENTADO ou pico isolado
// alto) foi removido — contava ruído agregado sem dizer qual contato foi
// afetado nem se algo de fato deixou de chegar (achado real: "34 erros + 0
// pedidos de reenvio" disparou alerta num envio que teve sucesso). Ver nota
// grande mais abaixo, onde notifySessionHealthAlert existia. Só resta o
// card passivo do Sistema (sob consulta) + a resolução de alertas antigos
// que ainda estejam abertos.
import { adminSupabase } from "@/lib/api/auth";
import { resolveNotification } from "@/lib/notifications/notify";

// ❌ 08/09/2026: `shouldAlert`/`consecutiveWindows`/`autoReconnectTriggered`
// removidos do tipo — só existiam pra alimentar notifySessionHealthAlert
// (removida acima). A VM continua calculando e usando esses valores
// internamente pra decidir seu PRÓPRIO auto-reconnect (ver
// getAndResetSessionHealth em sessionManager.js), só o app parou de
// precisar deles.
export type SessionHealthPayload = {
  libsignalErrors?: number;
  decryptRetries?: number;
};

// "default"/"session2" → mesmo rótulo usado em Configurações > WhatsApp
// (ver disconnect-alert.ts::humanSessionLabel, mesmo padrão).
export function humanSessionLabel(sessionLabel: string): string {
  return sessionLabel === "session2" ? "Sessão Secundária" : "Sessão Principal";
}

// ✅ 06/09/2026, bug real achado (Márcio: "se já resolveu, pq não some do
// sino?"): estável por sessão, não por tentativa — precisa ser sempre o
// mesmo pra resolveNotification (abaixo) conseguir achar e fechar a MESMA
// notificação que notify() abriu, igual ao padrão de whatsapp_desconectado
// em disconnect-alert.ts. Antes tinha Date.now() no sourceId, então cada
// alerta virava uma notificação nova e nada nunca resolvia — ficava pra
// sempre no sino mesmo depois do erro parar.
function sessionHealthSourceId(sessionLabel: string): string {
  return `session_health:${sessionLabel}`;
}

export function sessionHealthCheckResult(sessionLabel: string, health: SessionHealthPayload) {
  const libsignalErrors = Math.max(0, Number(health.libsignalErrors) || 0);
  const decryptRetries = Math.max(0, Number(health.decryptRetries) || 0);
  const total = libsignalErrors + decryptRetries;
  const humanLabel = humanSessionLabel(sessionLabel);

  return {
    status: (total > 0 ? "warn" : "ok") as "ok" | "warn",
    detail:
      total > 0
        ? `${humanLabel}: ${libsignalErrors} erro(s) de sessão + ${decryptRetries} pedido(s) de reenvio desde a última checagem`
        : `${humanLabel}: sem erros de sessão/decriptação desde a última checagem`,
  };
}

// ✅ 07/09/2026, bug real achado (Márcio: "2+2 enviou e zerou, 9+1 enviou e
// zerou, 10+3 enviou e zerou... deveria ter resolvido"): a resolução do
// SINO exigia total === 0 (via sessionHealthCheckResult acima), mas depois
// de subir o limite de alerta pra 30 (ruído residual normal virou 0-13 por
// janela, não mais raro), zero exato praticamente nunca mais acontece —
// o sino, uma vez aberto, ficava preso numa "zona morta" (total entre 1 e
// 29): nem alto o bastante pra reabrir alerta, nem zero pra fechar.
// Resolve quando volta a um nível claramente normal de novo (bem abaixo
// do limite de alerta), não só quando bate exatamente zero.
const ALERT_CLEAR_THRESHOLD = 15;

export function shouldClearSessionHealthAlert(health: SessionHealthPayload): boolean {
  const total = Math.max(0, Number(health.libsignalErrors) || 0) + Math.max(0, Number(health.decryptRetries) || 0);
  return total < ALERT_CLEAR_THRESHOLD;
}

// Grava direto em system_health_checks — usado por quem NÃO já tem um
// mecanismo próprio de upsert em lote (os 3 envios reais; a rota de
// Sincronizar/cron já faz isso sozinha pra TODAS as checagens, incluindo
// esta, então não chama esta função).
export async function upsertSessionHealthTile(sessionLabel: string, health: SessionHealthPayload) {
  const { status, detail } = sessionHealthCheckResult(sessionLabel, health);
  try {
    const supabase = adminSupabase();
    await supabase.from("system_health_checks").upsert(
      {
        check_key: "whatsapp_session_health",
        label: "WhatsApp — Erros de sessão",
        group_key: "whatsapp",
        status,
        detail,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "check_key" },
    );
  } catch (e: any) {
    console.error("[session-health-alert] falha ao atualizar card do Sistema:", e?.message);
  }
}

// ❌ 08/09/2026, removido a pedido do Márcio: esse alerta (sino+e-mail)
// contava ruído AGREGADO de sessão (Bad MAC/Closing session) sem dizer qual
// contato foi afetado nem se alguma mensagem de fato deixou de chegar — o
// caso real que expôs isso foi um pico de "34 erros + 0 pedidos de reenvio"
// disparando o alerta durante um envio que teve SUCESSO, sem nenhuma
// mensagem realmente afetada (zero pedido de reenvio = ninguém precisou de
// reenvio). "Informação irrelevante", nas palavras dele. Substituído de
// vez pela escada por contato em whatsapp-service/src/sessionManager.js
// (ESCALATION_LADDER) + notificação whatsapp_contato_persistente em
// app/api/whatsapp/session-alert/route.ts, que só avisa quando um contato
// específico realmente insiste (15+ pedidos de reenvio sem se resolver
// sozinho) — aí sim com nome/número, informação acionável de verdade.
// O card passivo em Admin > Sistema (upsertSessionHealthTile) continua de
// pé — é informação disponível sob consulta, não um push.

// Some do sino quando uma checagem volta a um nível claramente normal —
// chamar sempre que shouldClearSessionHealthAlert() der true, nos dois
// pontos que checam saúde de sessão (envio real e cron/"Sincronizar
// agora"). Best-effort.
export async function resolveSessionHealthAlert(tenantId: string, sessionLabel: string) {
  try {
    await resolveNotification(tenantId, "whatsapp_erros_sessao", sessionHealthSourceId(sessionLabel));
  } catch (e: any) {
    console.error("[session-health-alert] falha ao resolver alerta:", e?.message);
  }
}

// Usado pelos 3 envios reais (envio_agora/envio_programado/envio_avulso) —
// atualiza o card passivo do Sistema e resolve o alerta antigo se ele ainda
// estiver aberto de antes de 08/09/2026 (não cria mais nenhum novo — ver
// nota acima de notifySessionHealthAlert, removida).
export async function reportSessionHealthFromSend(tenantId: string, sessionLabel: string, health: SessionHealthPayload | null | undefined) {
  if (!health) return;
  await upsertSessionHealthTile(sessionLabel, health);
  if (shouldClearSessionHealthAlert(health)) {
    await resolveSessionHealthAlert(tenantId, sessionLabel);
  }
}
