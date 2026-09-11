// lib/whatsapp/session-health-alert.ts
// ✅ 05/09/2026, pedido do Márcio: checagem de erros de sessão/decriptação
// (Bad MAC/Failed to decrypt/Closing session/recv retry request na VM, ver
// whatsapp-service/src/sessionManager.js::getAndResetSessionHealth) só
// acontece embutida num envio real (envio_agora/envio_programado/
// envio_avulso, que já checam a resposta da VM pra outras coisas — mesmo
// espírito do cache de conectividade em disconnect-alert.ts). ❌ 11/09/2026:
// o painel "Sistema" (removido) também chamava essa checagem sob consulta —
// só restou a resolução de alerta antigo via envio real.
//
// ❌ 08/09/2026: o sino+e-mail que existia aqui (SUSTENTADO ou pico isolado
// alto) foi removido — contava ruído agregado sem dizer qual contato foi
// afetado nem se algo de fato deixou de chegar (achado real: "34 erros + 0
// pedidos de reenvio" disparou alerta num envio que teve sucesso). Ver nota
// grande mais abaixo, onde notifySessionHealthAlert existia. Só resta a
// resolução de alertas antigos que ainda estejam abertos.
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
// resolve o alerta antigo se ele ainda estiver aberto de antes de
// 08/09/2026 (não cria mais nenhum novo — ver nota acima de
// notifySessionHealthAlert, removida).
export async function reportSessionHealthFromSend(tenantId: string, sessionLabel: string, health: SessionHealthPayload | null | undefined) {
  if (!health) return;
  if (shouldClearSessionHealthAlert(health)) {
    await resolveSessionHealthAlert(tenantId, sessionLabel);
  }
}
