// lib/whatsapp/receipts.ts
// ✅ 04/10/2026: vincula o id da mensagem no WhatsApp (devolvido pelo /send
// da VM) ao job do Histórico, pra o recibo ✓✓ que a VM manda depois
// (app/api/whatsapp/receipts) aparecer na linha certa. Upsert só destas
// colunas — o recibo de entrega pode ter chegado ANTES desta gravação, e
// não pode ser apagado por ela (ver docs/sql/whatsapp_message_receipts.sql).
// Best-effort: nunca lança, falhar aqui não pode virar falha de envio.

export async function recordSentMessage(
  sb: any,
  params: {
    waMessageId: unknown;
    tenantId: string;
    jobId: string | null;
    phone: string | null;
    isSecondary?: boolean;
  },
): Promise<void> {
  const id = typeof params.waMessageId === "string" ? params.waMessageId.trim() : "";
  if (!id || !params.jobId) return;
  try {
    const { error } = await sb.from("whatsapp_message_receipts").upsert(
      {
        wa_message_id: id,
        tenant_id: params.tenantId,
        job_id: params.jobId,
        phone: params.phone,
        is_secondary: !!params.isSecondary,
      },
      { onConflict: "wa_message_id" },
    );
    if (error) console.error("[WA][receipts] falha ao vincular mensagem ao job", error.message);
  } catch (e: any) {
    console.error("[WA][receipts] falha ao vincular mensagem ao job", e?.message);
  }
}
