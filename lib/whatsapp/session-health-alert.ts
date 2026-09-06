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
// Alerta de verdade (sino+e-mail) só quando SUSTENTADO (3+ checagens
// seguidas com erro, decidido na própria VM) ou um pico isolado alto — um
// erro pontual costuma se autocorrigir sozinho via retry do Baileys, e
// avisar sem ter uma ação real pra recomendar só gera alarme falso (achado
// pelo Márcio ao receber o primeiro alerta real).
import { adminSupabase } from "@/lib/api/auth";
import { notify } from "@/lib/notifications/notify";
import { sendAdminEmail } from "@/lib/notifications/send-admin-email";

export type SessionHealthPayload = {
  libsignalErrors?: number;
  decryptRetries?: number;
  shouldAlert?: boolean;
  consecutiveWindows?: number;
  // ✅ 05/09/2026, pedido do Márcio ("com toda certeza preciso"): quando
  // sustentado, a própria VM já tenta reconectar sozinha (soft, sem QR
  // novo) antes de avisar — ver getAndResetSessionHealth em sessionManager.js.
  autoReconnectTriggered?: boolean;
};

// "default"/"session2" → mesmo rótulo usado em Configurações > WhatsApp
// (ver disconnect-alert.ts::humanSessionLabel, mesmo padrão).
export function humanSessionLabel(sessionLabel: string): string {
  return sessionLabel === "session2" ? "Sessão Secundária" : "Sessão Principal";
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

// Sino + e-mail — só quando `shouldAlert` (decidido na VM: sustentado ou
// pico alto). Best-effort, nunca lança.
export async function notifySessionHealthAlert(tenantId: string, sessionLabel: string, health: SessionHealthPayload) {
  if (!health.shouldAlert) return;

  const libsignalErrors = Math.max(0, Number(health.libsignalErrors) || 0);
  const decryptRetries = Math.max(0, Number(health.decryptRetries) || 0);
  const consecutiveWindows = Math.max(0, Number(health.consecutiveWindows) || 0);
  const humanLabel = humanSessionLabel(sessionLabel);

  const detailMsg = `${libsignalErrors} erro(s) de sessão + ${decryptRetries} pedido(s) de reenvio`;
  const durationMsg =
    consecutiveWindows >= 3
      ? `persistindo em ${consecutiveWindows} checagens seguidas (não se autocorrigiu sozinho)`
      : "num pico isolado bem acima do normal";
  // ✅ Quando a VM já tentou reconectar sozinha (auto-recuperação), a
  // recomendação muda: não pede pra tentar "Reconectar" de novo (acabou de
  // acontecer), só orienta escalar pro Hard Reset se persistir.
  const actionMsg = health.autoReconnectTriggered
    ? 'A própria sessão já tentou reconectar sozinha automaticamente. Verifique se algum cliente reclamou de não receber mensagem recentemente; se o problema voltar a acontecer logo em seguida, use "Hard Reset" em Configurações > WhatsApp (vai exigir escanear o QR de novo).'
    : 'Verifique se algum cliente reclamou de não receber mensagem recentemente. Se sim, tente primeiro "Reconectar" em Configurações > WhatsApp; se voltar a acontecer logo em seguida, use "Hard Reset" (vai exigir escanear o QR de novo).';
  const sourceId = `session_health:${sessionLabel}:${Date.now()}`;

  try {
    await notify({
      tenantId,
      type: "whatsapp_erros_sessao",
      title: "⚠️ WhatsApp — erros de sessão persistentes",
      message: `${detailMsg} na "${humanLabel}", ${durationMsg}. ${actionMsg}`,
      link: "/admin/settings/whatsapp",
      sourceId,
    });
    await sendAdminEmail(
      `⚠️ WhatsApp — erros de sessão persistentes (${humanLabel})`,
      `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <p><strong>${detailMsg}</strong> na "${humanLabel}", ${durationMsg}.</p>
        <p>Isso costuma ser o sintoma de mensagens que chegam como "Aguardando mensagem" ou vazias pro destinatário.</p>
        <p><strong>O que fazer:</strong> ${actionMsg}</p>
      </div>`,
    );
  } catch (e: any) {
    console.error("[session-health-alert] falha ao notificar erro sustentado:", e?.message);
  }
}

// Usado pelos 3 envios reais (envio_agora/envio_programado/envio_avulso) —
// combina os dois de uma vez, já que ali não existe nenhum outro mecanismo
// de upsert em lote pra reaproveitar.
export async function reportSessionHealthFromSend(tenantId: string, sessionLabel: string, health: SessionHealthPayload | null | undefined) {
  if (!health) return;
  await upsertSessionHealthTile(sessionLabel, health);
  await notifySessionHealthAlert(tenantId, sessionLabel, health);
}
