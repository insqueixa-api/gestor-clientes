// app/api/whatsapp/session-alert/route.ts
// ✅ 05/09/2026, pedido do Márcio: a VM do WhatsApp faz um Hard Reset (apaga
// a sessão inteira, exige QR novo) sem que ninguém seja avisado de verdade —
// antes ficava só no docker logs. Esta rota deixa a própria VM chamar de
// volta o app pra reaproveitar o MESMO pipeline de alerta (sino do admin +
// e-mail) que já existe pra desconexão total (ver
// lib/whatsapp/disconnect-alert.ts).
//
// ✅ 05/09/2026 (mesmo dia): o "kind: session_health" que existia aqui foi
// REMOVIDO — pedido do Márcio pra não ter nenhum timer rodando sozinho na
// VM. Essa checagem virou embutida na resposta de um envio real (ver
// reportSessionHealthFromSend em envio_agora/envio_programado/envio_avulso)
// — não precisa desta rota, porque já roda dentro do próprio Next.js e pode
// chamar notify()/sendAdminEmail() direto, sem round-trip HTTP.
//
// Autenticação: reaproveita o segredo que JÁ é compartilhado especificamente
// entre app e VM nos dois sentidos — UNIGESTOR_WA_TOKEN no app é o MESMO
// valor que API_TOKEN na VM (confirmado byte a byte antes de implementar
// isso). Nenhum segredo novo precisou ser distribuído.
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { notify, resolveNotification } from "@/lib/notifications/notify";
import { sendAdminEmail } from "@/lib/notifications/send-admin-email";
import { makeSessionKey, resolveCronTenantSelection } from "@/lib/whatsapp/wa-context";

export const dynamic = "force-dynamic";

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAuthorized(req: NextRequest): boolean {
  const expected = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  return timingSafeEqualStr(token, expected);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const kind = String(body?.kind || "");
  const sessionKey = String(body?.sessionKey || "").trim();
  const detail = String(body?.detail || "").slice(0, 500);
  const contactDigits = String(body?.contactDigits || "").trim();

  if ((kind !== "hard_reset" && kind !== "connected" && kind !== "chronic_contact") || !sessionKey) {
    return NextResponse.json({ ok: false, error: "Parâmetros inválidos" }, { status: 400 });
  }

  try {
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // ✅ Sistema single-tenant hoje — mesma lógica de resolução de tenant já
    // usada pra cron do WhatsApp (getCronTenantContext em wa-context.ts):
    // funciona sozinha quando há só 1 tenant real na tabela.
    const { data: rows } = await supabaseAdmin.from("tenant_members").select("tenant_id, user_id").limit(200);
    const selection = resolveCronTenantSelection(rows || []);
    if (!selection) {
      return NextResponse.json({ ok: false, error: "Não foi possível resolver o tenant" }, { status: 500 });
    }

    // ✅ A VM só conhece o hash opaco da sessão (sessionKey) — compara com
    // os dois hashes possíveis (sessão 1/2) pra mostrar um rótulo legível
    // em vez do hash cru no e-mail/sino.
    const session1Key = makeSessionKey(selection.tenantId, selection.userId, 1);
    const session2Key = makeSessionKey(selection.tenantId, selection.userId, 2);
    const humanLabel =
      sessionKey === session1Key ? "Sessão Principal"
      : sessionKey === session2Key ? "Sessão Secundária"
      : `Sessão (${sessionKey.slice(0, 8)})`;
    // ✅ "default"/"session2" — mesmo rótulo interno usado em disconnect-alert.ts
    // (sourceIdFor), pra conseguir resolver whatsapp_desconectado abaixo.
    const sessionLabel =
      sessionKey === session1Key ? "default" : sessionKey === session2Key ? "session2" : null;

    // ✅ 06/09/2026, bug real achado: sourceId tinha Date.now() — cada Hard
    // Reset virava notificação nova, nunca reabria a mesma, e nada nunca
    // resolvia (Márcio viu 3 "Hard Reset executado" acumuladas no sino).
    // Estável por sessão + resolvido pelo "connected" abaixo, mesmo padrão
    // já corrigido hoje pra whatsapp_erros_sessao.
    const hardResetSourceId = `hard_reset:${sessionKey}`;

    if (kind === "connected") {
      // ✅ Conexão reabriu de verdade — resolve qualquer alerta de Hard
      // Reset ou desconexão que ainda estivesse aberto pra esta sessão.
      // Best-effort, sem e-mail (reconectar sozinho não é um evento que
      // precise avisar por e-mail toda vez).
      await resolveNotification(selection.tenantId, "whatsapp_hard_reset", hardResetSourceId);
      if (sessionLabel) {
        await resolveNotification(selection.tenantId, "whatsapp_desconectado", `session:${sessionLabel}`);
      }
      return NextResponse.json({ ok: true });
    }

    if (kind === "chronic_contact") {
      // ✅ 07/09/2026, pedido do Márcio: a escalada automática por contato
      // (3 → 5 → 7 → 10 pedidos de reenvio) já se resolve sozinha na
      // maioria dos casos zerando a sessão do contato — só chega até aqui
      // quando o MESMO contato ainda insiste depois de todos os degraus
      // (padrão visto com o Anderson: algo persistente, provavelmente do
      // lado do aparelho dele). sourceId por contato (não por sessão) pra
      // cada contato problemático virar sua própria notificação, sem se
      // misturar com os outros.
      const chronicSourceId = `chronic_contact:${sessionKey}:${contactDigits || detail.slice(0, 40)}`;
      await notify({
        tenantId: selection.tenantId,
        type: "whatsapp_contato_persistente",
        title: "🔁 WhatsApp — contato insistindo em pedir reenvio",
        message: `Na "${humanLabel}", ${detail || "um contato"} continua pedindo reenvio mesmo depois de várias zeragens automáticas de sessão — pode ser algo do lado do aparelho dele. Vale checar manualmente se as mensagens estão chegando.`,
        link: "/admin/settings/whatsapp",
        sourceId: chronicSourceId,
      });
      return NextResponse.json({ ok: true });
    }

    // ❌ 09/09/2026, pedido explícito do Márcio: a Sessão Secundária não é
    // usada de propósito (nunca vai ser reconectada) — "Hard Reset" no
    // painel sempre reseta as 2 sessões juntas (ver app/api/whatsapp/
    // hard-reset/route.ts), então todo Hard Reset gerava TAMBÉM um aviso
    // sobre a Secundária, que nunca resolve sozinho (só resolveria com um
    // "connected" que nunca vai acontecer) — ficava pra sempre no sino
    // pedindo pra escanear QR de uma sessão que ele não quer conectar.
    // Desconectada é o estado CORRETO dela, não um problema.
    if (sessionLabel === "session2") {
      return NextResponse.json({ ok: true });
    }

    await notify({
      tenantId: selection.tenantId,
      type: "whatsapp_hard_reset",
      title: "🗑️ WhatsApp — Hard Reset executado",
      message: `A "${humanLabel}" foi resetada por completo (${detail || "sem detalhe"}) — escaneie o QR novamente em Configurações > WhatsApp.`,
      link: "/admin/settings/whatsapp",
      sourceId: hardResetSourceId,
    });
    await sendAdminEmail(
      `🗑️ WhatsApp — Hard Reset executado (${humanLabel})`,
      `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <p><strong>A "${humanLabel}" do WhatsApp foi resetada por completo (Hard Reset).</strong></p>
        <p>${detail || "Sem detalhe adicional."}</p>
        <p>A sessão está em branco agora — escaneie o QR novamente em Configurações &gt; WhatsApp assim que possível.</p>
      </div>`,
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[whatsapp/session-alert] falha ao processar alerta:", e?.message);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
