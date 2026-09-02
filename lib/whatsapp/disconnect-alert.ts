// lib/whatsapp/disconnect-alert.ts
// ✅ 29/08/2026, pedido do Márcio: sessão do WhatsApp caiu no meio de um
// envio hoje e ninguém foi avisado — o sino mostrou as FALHAS (mensagem por
// mensagem), mas nada sinalizava "a causa é a sessão estar desconectada".
// Checagem só reativa (na hora de tentar mandar) — sem poller/health-check
// separado, de propósito (pedido explícito: só nos pontos que realmente
// mandam mensagem). Cobre as 3 rotas que chamam a VM de verdade:
// envio_agora, envio_programado e envio_avulso (achada ao revalidar —
// disparo pra número avulso, fora de cadastro de cliente).
//
// Sinal de verdade (não regex em texto de erro): a VM devolve HTTP 503 com
// {error, status} quando a sessão não está conectada
// (whatsapp-service/src/index.js, rota POST /send) — mais confiável que o
// regex solto que envio_agora já usava pra classificar erro genérico.
import { notify, resolveNotification } from "@/lib/notifications/notify";
import { sendAdminEmail } from "@/lib/notifications/send-admin-email";
import { adminSupabase } from "@/lib/api/auth";

export function isWhatsAppDisconnectedResponse(status: number, rawBody: string): boolean {
  if (status !== 503) return false;
  try {
    const parsed = JSON.parse(rawBody);
    return ["disconnected", "connecting", "qr"].includes(String(parsed?.status || ""));
  } catch {
    return false;
  }
}

function sourceIdFor(sessionLabel: string): string {
  return `session:${sessionLabel}`;
}

// ✅ 02/09/2026, pedido do Márcio: em vez de um check dedicado (rota +
// chamada extra na VM) pra manter o cache de conectividade que
// billing_dispatch_check usa (system_health_checks, ver docs/sql/
// billing_dispatch_smart_check.sql), a PRÓPRIA tentativa de envio real já
// é a prova mais direta de conectividade — toda vez que reportWhatsApp
// Disconnected/Reconnected roda (ou seja, todo envio de verdade,
// automático ou manual), atualiza o cache também. Na prática: o status
// check da VM só acontece de fato quando o cache está velho (>10min sem
// NENHUM envio real) e chega uma mensagem nova pra mandar — o envio em si
// vira o check. Enquanto mensagens saem com sucesso a cada <10min, o
// cache nunca fica velho e nenhuma chamada extra de status roda.
async function updateConnectivityCache(sessionLabel: string, status: "ok" | "fail" | "warn", detail: string) {
  try {
    const supabase = adminSupabase();
    const session = sessionLabel === "session2" ? 2 : 1;
    await supabase.from("system_health_checks").upsert(
      {
        check_key: `whatsapp_${session}`,
        label: session === 1 ? "WhatsApp — Principal" : "WhatsApp — Secundário",
        group_key: "whatsapp",
        status,
        detail: detail.slice(0, 300),
        checked_at: new Date().toISOString(),
      },
      { onConflict: "check_key" },
    );
  } catch (e: any) {
    console.error("[WA][disconnect-alert] falha ao atualizar cache de conectividade:", e?.message);
  }
}

// "default"/"session2" → mesmo rótulo já usado em Configurações > WhatsApp
// (WhatsAppSessionCard, app/admin/settings/whatsapp/page.tsx) — sem isso o
// e-mail/sino mostrava o valor interno cru ("default"), sem significado
// nenhum pra quem lê.
function humanSessionLabel(sessionLabel: string): string {
  return sessionLabel === "session2" ? "Sessão Secundária" : "Sessão Principal";
}

// Best-effort — nunca lança, nunca atrasa/derruba o envio que estava sendo
// tentado. Dedup: só notifica+manda e-mail na primeira detecção; enquanto o
// alerta seguir aberto (sino não resolvido), novas falhas de conexão no
// mesmo tick/dia não mandam e-mail de novo.
export async function reportWhatsAppDisconnected(
  tenantId: string,
  sessionLabel: string,
  origin: "envio_agora" | "envio_programado" | "envio_avulso",
): Promise<void> {
  // ✅ Roda SEMPRE, fora do dedup do sino abaixo — cada tentativa real de
  // envio que confirma desconexão precisa renovar os 10min do cache,
  // mesmo que o alerta do sino já esteja aberto (dedup é só pra não
  // repetir notificação/e-mail, não pode segurar o cache desatualizado).
  await updateConnectivityCache(
    sessionLabel,
    sessionLabel === "session2" ? "warn" : "fail",
    "Desconectado — precisa escanear QR Code",
  );

  try {
    const supabase = adminSupabase();
    const sourceId = sourceIdFor(sessionLabel);

    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("type", "whatsapp_desconectado")
      .eq("source_id", sourceId)
      .is("resolved_at", null)
      .maybeSingle();

    if (existing) return;

    const originLabel =
      origin === "envio_agora" ? "Envio Agora" : origin === "envio_programado" ? "envio agendado" : "Envio Avulso";
    const humanLabel = humanSessionLabel(sessionLabel);

    await notify({
      tenantId,
      type: "whatsapp_desconectado",
      title: "🔴 WhatsApp desconectado",
      message: `A "${humanLabel}" caiu — detectado em ${originLabel}. Escaneie o QR de novo em Configurações > WhatsApp.`,
      link: "/admin/settings/whatsapp",
      sourceId,
    });

    await sendAdminEmail(
      `🔴 WhatsApp desconectado (${humanLabel})`,
      `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <p><strong>A "${humanLabel}" do WhatsApp caiu.</strong></p>
        <p>Detectado durante: ${originLabel}.</p>
        <p>Escaneie o QR novamente em Configurações &gt; WhatsApp assim que possível — enquanto isso, envios (manuais e agendados) vão continuar falhando.</p>
      </div>`,
    );
  } catch (e: any) {
    console.error("[WA][disconnect-alert] falha ao notificar desconexão:", e?.message);
  }
}

// Chamado quando um envio tem sucesso — se havia um alerta aberto pra essa
// sessão, resolve na hora (mesmo espírito do resolve instantâneo do vigia
// de crons: não espera ninguém checar manualmente).
export async function reportWhatsAppReconnected(tenantId: string, sessionLabel: string): Promise<void> {
  // ✅ Renova os 10min do cache a cada envio bem-sucedido — enquanto
  // mensagens saem normalmente, o próximo tick do billing_dispatch_check
  // nunca precisa de um check dedicado, só confia no cache.
  await updateConnectivityCache(sessionLabel, "ok", "");
  try {
    await resolveNotification(tenantId, "whatsapp_desconectado", sourceIdFor(sessionLabel));
  } catch (e: any) {
    console.error("[WA][disconnect-alert] falha ao resolver alerta:", e?.message);
  }
}
