// app/api/whatsapp/bot/agent/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Rota de produção (webhook real, chamada por whatsapp-service/src/sessionManager.js).
// Usa o mesmo motor de árvore do simulador (lib/whatsapp/bot-engine.ts) — antes
// duplicado aqui inteiro, mantido em sincronia manualmente com chat-admin/route.ts.
// Aqui ficam só as partes exclusivas de produção: autenticação interna, leitura
// mais completa do cliente, análise de comprovante (mídia) e o fluxo "Portal ou
// PIX?" — nada disso existe no simulador.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isInternalRequest } from "@/lib/internal-auth";
import { resolveClientProvider, type ServerProvider } from "@/lib/whatsapp/bot-menu";
import { getFlowSettings } from "@/lib/whatsapp/bot-flow-settings";
import { runBotEngine } from "@/lib/whatsapp/bot-engine";
import { callGemini } from "@/lib/whatsapp/gemini-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") console.log(...args);
}

function isInternalAuth(req: Request): boolean {
  return isInternalRequest(req, "UNIGESTOR_BOT_INTERNAL_SECRET");
}

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Envio de resposta via WA service (real, produção) ────────────────────────

async function sendWAMessage(sessionKey: string, phone: string, message: string, imageUrl?: string) {
  const baseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
  const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
  if (!baseUrl || !waToken) {
    safeLog("[BOT][agent] WA env vars ausentes");
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${baseUrl}/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${waToken}`,
        "x-session-key": sessionKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone,
        message,
        ...(imageUrl ? { image_url: imageUrl } : {}),
        // ✅ O bot já mostrou "digitando..." durante o debounce (sessionManager.js,
        // resetDebounceTimers) antes de chegar até aqui — sem essa flag, o VM
        // simularia "digitando" de novo bem antes de mandar, duplicando o efeito.
        skip_typing_delay: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      safeLog("[BOT][agent] Erro ao enviar WA:", res.status, await res.text().catch(() => ""));
    }
  } catch (e: any) {
    safeLog("[BOT][agent] Timeout/erro ao enviar WA:", e?.message);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
  if (!isInternalAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) {
    safeLog("[BOT][agent] GEMINI_API_KEY não configurada");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { tenant_id, session_key, phone, remoteJid, text, media_base64, media_type, mime_type, awaiting_payment_type, payment_clarification_attempts, bot_state } = body;

  const jidToCheck = remoteJid || phone || "";
  if (jidToCheck.includes("@g.us")) {
    safeLog(`[BOT][agent] Mensagem de grupo ignorada: ${jidToCheck}`);
    return NextResponse.json({ ok: true, action: "ignored_group" });
  }

  if (!tenant_id || !session_key || !phone) {
    return NextResponse.json({ error: "Parâmetros obrigatórios ausentes" }, { status: 400 });
  }

  // ── 1. Identificar cliente ──────────────────────────────────────────────
  const { data: clientMatches, error: clientErr } = await sb
    .from("clients")
    .select(`
      id, display_name, secondary_display_name,
      whatsapp_username, secondary_whatsapp_username,
      server_username, server_password,
      vencimento, screens, plan_label, plan_table_id,
      price_amount, price_currency, technology,
      server_id, is_trial, is_archived,
      servers (name, dns, is_offline, offline_since, offline_reason)
    `)
    .eq("tenant_id", tenant_id)
    .or(`whatsapp_username.eq.${phone},secondary_whatsapp_username.eq.${phone}`);

  if (clientErr || !clientMatches?.length) {
    safeLog("[BOT][agent] Número não identificado como cliente:", phone);
    return NextResponse.json({ ok: true, action: "silence" });
  }

  const clients = clientMatches.map((raw) => {
    const isSec = raw.secondary_whatsapp_username === phone;
    const dnsArray: string[] = (raw.servers as any)?.dns || [];
    const srv = raw.servers as any;
    return {
      ...raw,
      display_name: isSec ? (raw.secondary_display_name || raw.display_name || "Cliente") : (raw.display_name || "Cliente"),
      server_name: srv?.name || "Servidor",
      server_dns: dnsArray,
      server_is_offline: srv?.is_offline ?? false,
      server_offline_since: srv?.offline_since ?? null,
      server_offline_reason: srv?.offline_reason ?? null,
      is_secondary: isSec,
    };
  });

  const firstName = clients[0].display_name.split(" ")[0];

  // Mensagens globais editáveis no painel (saudação, sucesso, escala, retry).
  const flow = await getFlowSettings(sb, tenant_id);

  // ✅ Provider do servidor do cliente (NATV/FAST/ELITE) — usado pra filtrar
  // conteúdo restrito a um servidor específico, tanto na árvore quanto no
  // RAG da base de conhecimento. Baseado na 1ª conta do cliente — clientes
  // com múltiplas contas em servidores diferentes usam a conta principal
  // como referência (mesma simplificação já usada em `firstName`/`clients[0]`).
  const clientProvider: ServerProvider | null = await resolveClientProvider(sb, clients[0]?.server_id || null);

  // ── 2. Mídia — lógica determinística (exclusiva da produção) ─────────────
  if (media_base64 && media_type) {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: recentPayments } = await sb
      .from("client_portal_payments")
      .select("id, fulfillment_status, whatsapp_status")
      .eq("tenant_id", tenant_id)
      .in("client_id", clients.map((c: any) => c.id))
      .gte("created_at", sixHoursAgo)
      .order("created_at", { ascending: false })
      .limit(1);

    const recentPayment = recentPayments?.[0];

    if (recentPayment?.whatsapp_status === "sent") {
      const msg = `Oi ${firstName}! 😊 Recebi seu comprovante, mas sua renovação já foi processada automaticamente pelo portal — tudo certo com seu acesso!\n\nPara os próximos pagamentos pelo portal, não precisa enviar comprovante. Tudo acontece de forma automática. ✅`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "auto_confirmed", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    if (recentPayment?.fulfillment_status === "manual_pending") {
      const msg = `Oi ${firstName}! Recebi seu comprovante. ✅\n\nSua renovação está em análise e será concluída em breve. Qualquer dúvida é só chamar!`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "manual_pending", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    if (recentPayment?.fulfillment_status === "error") {
      const msg = `Oi ${firstName}! Recebi seu comprovante. ✅\n\nSeu pagamento foi confirmado! Só tivemos uma instabilidade técnica na finalização automática, mas o Márcio já foi notificado e vai concluir sua renovação em instantes.`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "fulfillment_error", mark_read: false, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    if (!recentPayment) {
      // ✅ Antes só perguntava "é comprovante? sim/não" — qualquer outra foto
      // (ex: tela de app de TV avisando que a ativação/licença expirou) caía
      // em silêncio total, mesmo já existindo um nó pronto pra esse assunto.
      // Agora classifica em 3 categorias e roteia "app_expired" direto pro
      // nó certo da árvore (busca por keyword, não texto fixo hardcoded).
      const analysisPayload: any = {
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: mime_type || (media_type === "image" ? "image/jpeg" : "application/pdf"), data: media_base64 } },
            { text: `Analise esta imagem/documento e classifique em UMA destas categorias:\n- "receipt": é um comprovante de pagamento financeiro (transferência PIX, TED, DOC, recibo bancário ou similar)\n- "app_expired": é uma tela de aplicativo de TV/IPTV avisando que a ativação/licença/assinatura do APLICATIVO expirou e pedindo pra renovar (ex: "Activation has expired", "ativação expirou", telas com Device ID / Device Key)\n- "none": não é nenhuma das duas\n\nResponda SOMENTE com este JSON, sem markdown, sem explicação:\n{"category":"receipt"}\nou\n{"category":"app_expired"}\nou\n{"category":"none"}` },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 64 },
      };

      let parsed: any = null;
      try {
        const analysisResult = await callGemini(geminiKey, analysisPayload, 20_000);
        const rawText = analysisResult?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
      } catch (e: any) {
        safeLog("[BOT][agent] Erro ao analisar imagem:", e?.message);
        return NextResponse.json({ ok: true, action: "silence", mark_read: true });
      }

      const category = String(parsed?.category || "none");

      if (category === "receipt") {
        const msg = `Vi que você informou que está pago! Só confirma uma coisa: foi feito direto pelo portal ou via PIX/transferência manual?`;
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({
          ok: true, action: "awaiting_payment_type", mark_read: true, bot_response: msg,
          display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null,
        });
      }

      if (category === "app_expired") {
        // ✅ Busca o nó pela keyword que ele já usa pra ser encontrado por
        // texto (não pelo label — sobrevive a renomear o nó no painel).
        const { data: expiredNode } = await sb
          .from("bot_menu_nodes")
          .select("id")
          .eq("tenant_id", tenant_id)
          .eq("is_active", true)
          .contains("keywords", ["expirado"])
          .limit(1)
          .maybeSingle();

        if (expiredNode?.id) {
          const sentMessages: string[] = [];
          const send = async (m: string) => {
            if (!m?.trim()) return;
            sentMessages.push(m);
            await sendWAMessage(session_key, phone, m);
          };
          const result = await runBotEngine({
            sb, tenantId: tenant_id, geminiKey, flow, clients, clientMatchesRaw: clientMatches, clientProvider,
            trimmed: "",
            botState: bot_state,
            forceNodeId: expiredNode.id,
            send,
            sendImage: (imgUrl, caption) => sendWAMessage(session_key, phone, caption, imgUrl),
            logPrefix: "[BOT][agent][img]",
          });
          return NextResponse.json({
            ok: true, action: result.action, escalate: result.escalate ?? false, mark_read: result.markRead,
            bot_response: sentMessages.join("\n\n"), next_state: result.nextState, transfer_reason: result.transferReason ?? null,
            display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null,
          });
        }
      }

      return NextResponse.json({ ok: true, action: "silence", mark_read: true });
    }

    return NextResponse.json({ ok: true, action: "silence" });
  }

  // ── 3. Mensagem de texto ─────────────────────────────────────────────────
  if (!text?.trim()) {
    return NextResponse.json({ ok: true, action: "silence" });
  }
  const trimmed = text.trim();

  // ── "Portal ou PIX?" — checado antes do roteamento de menu (exclusivo da
  // produção; só existe porque só aqui há upload de comprovante) ───────────
  if (awaiting_payment_type === true) {
    const mentionsPix = /\b(pix|transfer[eê]ncia|manual|ted|doc|dep[oó]sito)\b/i.test(trimmed);
    const mentionsPortal = /\b(portal|link|site)\b/i.test(trimmed);

    if (mentionsPix && !mentionsPortal) {
      const msg1 = `Entendido! O Márcio vai cuidar da sua renovação assim que possível 😊`;
      await sendWAMessage(session_key, phone, msg1);
      const msg2 = `Já fica a dica: se renovar direto pelo portal usando o link que te mandei, o processo é automático — você nem precisa enviar comprovante nem esperar a confirmação manual. #FicaADica`;
      await sendWAMessage(session_key, phone, msg2);
      return NextResponse.json({
        ok: true, action: "payment_pix_confirmed", mark_read: false, bot_response: `${msg1}\n\n${msg2}`,
        display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null,
      });
    }

    if (mentionsPortal && !mentionsPix) {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: recheck } = await sb
        .from("client_portal_payments")
        .select("id, fulfillment_status, whatsapp_status")
        .eq("tenant_id", tenant_id).in("client_id", clients.map((c: any) => c.id))
        .gte("created_at", sixHoursAgo).order("created_at", { ascending: false }).limit(1);

      const found = recheck?.[0];
      if (found?.whatsapp_status === "sent") {
        const msg = `Ah, encontrei aqui! 😊 Sua renovação pelo portal já foi processada automaticamente — tudo certo com seu acesso!`;
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "payment_portal_confirmed", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }

      const msg = `Hmm, ainda não encontrei o registro por aqui — deixa comigo, já vou verificar direto com o Márcio pra confirmar. 🙏`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "payment_portal_not_found", mark_read: false, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    if ((payment_clarification_attempts || 0) >= 2) {
      await sendWAMessage(session_key, phone, flow.escalate_message);
      return NextResponse.json({ ok: true, action: "payment_type_gave_up", escalate: true, mark_read: false, bot_response: flow.escalate_message, next_state: "__clear__", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    const msg = `Desculpa, não entendi — foi pelo portal (aquele link que te mandei) ou via PIX/transferência manual?`;
    await sendWAMessage(session_key, phone, msg);
    return NextResponse.json({ ok: true, action: "awaiting_payment_type", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
  }

  // ── 4. Motor de árvore compartilhado (idêntico ao simulador) ─────────────
  const sentMessages: string[] = [];
  const send = async (msg: string) => {
    if (!msg?.trim()) return;
    sentMessages.push(msg);
    await sendWAMessage(session_key, phone, msg);
  };

  const result = await runBotEngine({
    sb,
    tenantId: tenant_id,
    geminiKey,
    flow,
    clients,
    clientMatchesRaw: clientMatches,
    clientProvider,
    trimmed,
    botState: bot_state,
    awaitingPaymentType: awaiting_payment_type === true,
    send,
    sendImage: (imgUrl, caption) => sendWAMessage(session_key, phone, caption, imgUrl),
    logPrefix: "[BOT][agent]",
  });

  // ✅ display_name/server_name aqui sempre refletem clients[0] (conta
  // principal) — mesmo padrão usado antes da unificação nos gates globais;
  // servem só pro rodapé de evento/log do sessionManager.js, nunca pra
  // decidir pra qual telefone enviar (isso já é sempre `phone`, correto).
  return NextResponse.json({
    ok: true,
    action: result.action,
    escalate: result.escalate ?? false,
    mark_read: result.markRead,
    bot_response: sentMessages.join("\n\n"),
    next_state: result.nextState,
    transfer_reason: result.transferReason ?? null,
    display_name: clients[0]?.display_name || null,
    server_name: clients[0]?.server_name || null,
  });
}
