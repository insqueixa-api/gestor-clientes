// lib/notifications/notify.ts
import { adminSupabase } from "@/lib/api/auth";

type NotificationType =
  | "fin_vencido"
  | "transfer_aguardando"
  | "manual_pending"
  | "whatsapp_falha"
  | "whatsapp_desconectado"
  | "automacao_falha"
  | "fulfillment_error"
  | "saldo_baixo"
  | "sugestao_conteudo"
  | "app_setup_pending"
  | "app_removal_pending"
  | "cron_falha";

type NotifyParams = {
  tenantId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  sourceId: string; // id do registro que originou (transacao_id, payment_id, server_id...)
};

/**
 * Formata a identidade do cliente pra notificação: "Nome - Username (Servidor)".
 * Marcio tem várias contas, então o nome sozinho não identifica qual é qual.
 */
export function formatClientLabel(
  name?: string | null,
  username?: string | null,
  serverName?: string | null,
): string {
  const label = (name || "Cliente").trim() || "Cliente";
  const user = (username || "").trim();
  if (!user) return label;
  const server = (serverName || "").trim();
  return server ? `${label} - ${user} (${server})` : `${label} - ${user}`;
}

/**
 * Cria ou atualiza uma notificação.
 * Se já existir uma notificação do mesmo (tenant, type, source_id),
 * atualiza o conteúdo em vez de duplicar.
 *
 * ✅ 01/09/2026, bug real achado: o upsert não tocava em resolved_at/
 * is_read, então um alerta que já tinha sido resolvido (ex: WhatsApp caiu,
 * reconectou sozinho) e depois volta a acontecer (cai de novo) ficava
 * "invisível" — o registro reaberto continuava marcado como resolvido/lido
 * da vez anterior. notify() só é chamado pra sinalizar um problema ATIVO
 * (resolver é sempre via resolveNotification), então sempre reabre.
 */
export async function notify(params: NotifyParams) {
  const { tenantId, type, title, message, link, sourceId } = params;
  const supabase = adminSupabase();

  const { error } = await supabase
    .from("notifications")
    .upsert(
      {
        tenant_id: tenantId,
        type,
        title,
        message,
        link: link || null,
        source_id: sourceId,
        resolved_at: null,
        is_read: false,
      },
      { onConflict: "tenant_id,type,source_id" },
    );

  if (error) {
    console.error(`[NOTIFY] Erro ao gravar notificação (${type}):`, error.message);
  }
}

/**
 * Marca uma notificação como resolvida (o problema que a originou não existe mais).
 * Ela some da lista do sino, mas o registro histórico continua no banco.
 */
export async function resolveNotification(
  tenantId: string,
  type: NotificationType,
  sourceId: string,
) {
  const supabase = adminSupabase();

  const { error } = await supabase
    .from("notifications")
    .update({ resolved_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("type", type)
    .eq("source_id", sourceId);

  if (error) {
    console.error(`[NOTIFY] Erro ao resolver notificação (${type}):`, error.message);
  }
}