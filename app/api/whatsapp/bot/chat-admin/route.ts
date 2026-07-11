// app/api/whatsapp/bot/chat-admin/route.ts
// Rota exclusiva do painel admin para testar o bot com o MESMO comportamento
// do agent real (menu, escalonamento, Item 5, Item 6, tag de escalonamento),
// mas sem enviar nada pro WhatsApp — só retorna o texto pra simulação.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generatePortalLink } from "@/lib/whatsapp/template-vars";
import {
  BOT_TOOL_DECLARATIONS,
  buildBotSystemPrompt,
  buildScopedBotSystemPrompt,
  toBRDateTime,
  ESCALATION_TAG,
  type ScopedCategory,
} from "@/lib/whatsapp/bot-prompt";
import {
  type MenuContext,
  detectMenuContext,
  submenuTextFor,
  MAIN_MENU_TEXT,
  CONTEUDO_NOT_FOUND,
  HUMAN_REQUESTED_MSG,
  BOT_GAVE_UP_MSG,
  isEscalationTrigger,
  isSimpleConfirmation,
  isLinkOnly,
  classifyRecentJob,
  isGratitudeOrGreetingOnly,
  POSTPONEMENT_INTENT,
  PROBLEM_KEYWORDS,
  checkRecentPortalPayment,
  paymentAutoConfirmedMsg,
  PAYMENT_MANUAL_PENDING_MSG,
  PAYMENT_FULFILLMENT_ERROR_MSG,
  getRootNodeBySlug,
  getNodeById,
  getChildren,
  getSteps,
  renderChildrenMenu,
  findChildByNumber,
  findChildByKeyword,
  RESOLUTION_QUESTION,
} from "@/lib/whatsapp/bot-menu";
import { callGemini, generateEmbedding, searchBotKnowledge } from "@/lib/whatsapp/gemini-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") console.log(...args);
}

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Ferramentas (mesma lógica de negócio do agent, sem envio WA) ─────────────

async function toolGerarLinkPortal(sb: any, tenantId: string, client: any): Promise<string> {
  const phone = client.whatsapp_username;
  if (!phone) return "(link não disponível — cliente sem WhatsApp)";
  return generatePortalLink(sb, {
    tenantId,
    contact: { number: phone, username: phone, is_secondary: false },
    createdBy: null,
    label: "Teste admin bot",
    expiresAt: null,
    onLog: safeLog,
  });
}

async function toolConsultarPrecos(sb: any, tenantId: string, client: any): Promise<any> {
  const PERIOD_LABELS: Record<string, string> = {
    MONTHLY: "Mensal", BIMONTHLY: "Bimestral", QUARTERLY: "Trimestral",
    SEMIANNUAL: "Semestral", ANNUAL: "Anual",
  };
  const ORDER = ["MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];

  let planTableId = client.plan_table_id;
  if (!planTableId) {
    const { data: def } = await sb
      .from("plan_tables").select("id")
      .eq("tenant_id", tenantId).eq("is_system_default", true)
      .eq("currency", client.price_currency || "BRL").maybeSingle();
    if (def) planTableId = def.id;
  }
  if (!planTableId) return { error: "Tabela de preços não encontrada" };

  const { data: items } = await sb
    .from("plan_table_items")
    .select("period, plan_table_item_prices(screens_count, price_amount)")
    .eq("plan_table_id", planTableId);

  const screens = Number(client.screens || 1);
  const precoAtual = (items || [])
    .map((item: any) => {
      let valor = 0;
      if (client.price_amount > 0 && PERIOD_LABELS[item.period] === client.plan_label) {
        valor = client.price_amount;
      } else {
        const exact = item.plan_table_item_prices?.find((p: any) => p.screens_count === screens);
        if (exact) valor = exact.price_amount;
      }
      return { periodo: PERIOD_LABELS[item.period] || item.period, valor };
    })
    .filter((p: any) => p.valor > 0)
    .sort((a: any, b: any) => ORDER.indexOf(a.period) - ORDER.indexOf(b.period));

  return { moeda: client.price_currency || "BRL", telas: screens, precos: precoAtual };
}

async function toolVerificarCloudflare(): Promise<any> {
  try {
    const res = await fetch("https://www.cloudflarestatus.com/api/v2/status.json", {
      signal: AbortSignal.timeout(5_000),
    });
    const data = await res.json();
    return { operacional: data?.status?.indicator === "none", descricao: data?.status?.description || "" };
  } catch {
    return { operacional: true, descricao: "Não foi possível verificar" };
  }
}

async function toolRecomendarApplicativo(sb: any, tenantId: string, serverId: string | null): Promise<any> {
  const { data: apps } = await sb
    .from("apps").select("name, cost_type, partner_server_id, license_price, license_period")
    .eq("tenant_id", tenantId).eq("is_hidden", false);
  if (!apps) return {};
  return {
    parceiros: (apps as any[]).filter(a => a.cost_type === "partnership" && a.partner_server_id === serverId).map(a => a.name),
    gratis: (apps as any[]).filter(a => a.cost_type === "free" && !a.partner_server_id).map(a => a.name),
    pagos: (apps as any[]).filter(a => a.cost_type === "paid" && !a.partner_server_id).map(a => ({
      nome: a.name,
      valor: a.license_price ? `R$ ${Number(a.license_price).toFixed(2).replace(".", ",")}` : null,
      periodo: a.license_period === "annual" ? "anuidade" : a.license_period === "lifetime" ? "vitalício" : null,
    })),
  };
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) return NextResponse.json({ error: "GEMINI_API_KEY não configurada" }, { status: 500 });

  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  // Auth — usuário logado normal
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: authData, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !authData?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: member } = await sb
    .from("tenant_members").select("tenant_id")
    .eq("user_id", authData.user.id).limit(1).maybeSingle();
  if (!member?.tenant_id) return NextResponse.json({ error: "Tenant não encontrado" }, { status: 403 });
  const tenantId = member.tenant_id;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const {
    message,
    phone,
    conversation_history,
    bot_state,                       // ✅ estado do menu (mesmo contrato do agent)
    awaiting_payment_type,           // ✅ Item 6 — testável manualmente no simulador
    payment_clarification_attempts,
  } = body;

  if (!message?.trim()) return NextResponse.json({ error: "message é obrigatório" }, { status: 400 });

  // ── Clientes (multi-conta, igual ao agent) ──────────────────────────────
  let clients: any[] = [];
  let clientMatchesRaw: any[] = [];

  if (phone) {
    const { data: clientMatches } = await sb
      .from("clients")
      .select(`
        id, display_name, secondary_display_name, whatsapp_username, secondary_whatsapp_username,
        server_username, server_password,
        vencimento, screens, plan_label, plan_table_id, price_amount, price_currency, technology,
        server_id, is_trial, is_archived, servers (name, dns, is_offline, offline_since, offline_reason)
      `)
      .eq("tenant_id", tenantId)
      .or(`whatsapp_username.eq.${phone},secondary_whatsapp_username.eq.${phone}`);

    if (clientMatches && clientMatches.length > 0) {
      clientMatchesRaw = clientMatches;
      clients = clientMatches.map((raw) => {
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
    }
  }

  if (clients.length === 0) {
    clients.push({
      id: null, display_name: "Cliente Teste Genérico", server_name: "Servidor Teste",
      plan_label: "Mensal", screens: 1, vencimento: null,
      price_currency: "BRL", price_amount: 0, plan_table_id: null,
      server_id: null, whatsapp_username: null, server_is_offline: false,
    });
    clientMatchesRaw.push(clients[0]);
  }

  const firstName = clients[0].display_name.split(" ")[0];
  const trimmed = message.trim();
  const numericChoice = /^[1-6]$/.test(trimmed) ? Number(trimmed) : null;

  // ── Simulação de envio — acumula mensagens em vez de mandar pro WhatsApp ──
  const sentMessages: string[] = [];
  function send(text: string) { sentMessages.push(text); }

  // Histórico multi-turn (igual ao agent, mas mantido pelo próprio front)
  const history = Array.isArray(conversation_history) ? conversation_history : [];

  // Monta a resposta final e finaliza a request com metadados de estado —
  // usado por TODOS os caminhos determinísticos (script fixo), pra manter
  // o mesmo contrato do agent real (action/escalate/mark_read/next_state).
  function finish(opts: {
    action: string;
    next_state?: string;
    escalate?: boolean;
    mark_read?: boolean;
  }) {
    const responseText = sentMessages.join("\n\n");
    const updatedHistory = [
      ...history,
      { role: "user", parts: [{ text: trimmed }] },
      { role: "model", parts: [{ text: responseText }] },
    ];
    return NextResponse.json({
      ok: true,
      response: responseText,
      updated_history: updatedHistory,
      action: opts.action,
      escalate: opts.escalate ?? false,
      mark_read: opts.mark_read,
      next_state: opts.next_state,
    });
  }

  // ── Escalonamento determinístico — prioridade máxima, igual ao agent ────
  if (isEscalationTrigger(trimmed)) {
    send(HUMAN_REQUESTED_MSG);
    return finish({ action: "escalated", escalate: true, mark_read: false, next_state: "__clear__" });
  }

  // ── Item 6: resposta a "Portal ou PIX?" (testável manualmente aqui) ─────
  if (awaiting_payment_type === true) {
    const mentionsPix = /\b(pix|transfer[eê]ncia|manual|ted|doc|dep[oó]sito)\b/i.test(trimmed);
    const mentionsPortal = /\b(portal|link|site)\b/i.test(trimmed);

    if (mentionsPix && !mentionsPortal) {
      send("Entendido! O Márcio vai cuidar da sua renovação assim que possível 😊");
      send("Já fica a dica: se renovar direto pelo portal usando o link que te mandei, o processo é automático — você nem precisa enviar comprovante nem esperar a confirmação manual. #FicaADica");
      return finish({ action: "payment_pix_confirmed", mark_read: false });
    }

    if (mentionsPortal && !mentionsPix) {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: recheck } = await sb
        .from("client_portal_payments")
        .select("id, fulfillment_status, whatsapp_status")
        .eq("tenant_id", tenantId)
        .in("client_id", clients.map((c: any) => c.id).filter(Boolean))
        .gte("created_at", sixHoursAgo)
        .order("created_at", { ascending: false })
        .limit(1);

      const found = recheck?.[0];
      if (found?.whatsapp_status === "sent") {
        send("Ah, encontrei aqui! 😊 Sua renovação pelo portal já foi processada automaticamente — tudo certo com seu acesso!");
        return finish({ action: "payment_portal_confirmed", mark_read: true });
      }
      send("Hmm, ainda não encontrei o registro por aqui — deixa comigo, já vou verificar direto com o Márcio pra confirmar. 🙏");
      return finish({ action: "payment_portal_not_found", mark_read: false });
    }

    if ((payment_clarification_attempts || 0) >= 2) {
      send(BOT_GAVE_UP_MSG);
      return finish({ action: "payment_type_gave_up", escalate: true, mark_read: false, next_state: "__clear__" });
    }

    send("Desculpa, não entendi — foi pelo portal (aquele link que te mandei) ou via PIX/transferência manual?");
    return finish({ action: "awaiting_payment_type", mark_read: true });
  }

  // ── Item 7: roteamento por estado de menu ───────────────────────────────
if (!bot_state || bot_state === "aguardando_resposta" || bot_state === "aguardando_resposta_2") {
    const detected = detectMenuContext(trimmed);

    // ✅ "conteudo" é diferente dos outros: não tem opções numeradas de
    // verdade, é sempre uma pergunta aberta (que canal, que filme, etc).
    // Em vez de responder sempre com o texto genérico do portal, deixa o
    // Gemini TENTAR responder de verdade (prompt filtrado da categoria),
    // e só cai no texto fixo se o Gemini não conseguir resolver.
    if (detected === "conteudo") {
      // Não retorna aqui — segue o fluxo normal mais abaixo (RAG + Gemini
      // com prompt filtrado), só marcando o estado antecipadamente.
      body.bot_state = "conteudo"; // repassa pro isScoped calcular certo lá embaixo
    } else if (detected) {
      send(submenuTextFor(detected));
      return finish({ action: `menu_${detected}`, mark_read: true, next_state: detected });
    }

    const isRetryState = bot_state === "aguardando_resposta" || bot_state === "aguardando_resposta_2";

    if (isRetryState && numericChoice) {
      if (numericChoice === 6) {
        send(HUMAN_REQUESTED_MSG);
        return finish({ action: "escalated_menu", escalate: true, mark_read: false, next_state: "__clear__" });
      }
      const mapped: MenuContext =
        numericChoice === 1 ? "tecnico" :
        numericChoice === 2 ? "pagamento" :
        numericChoice === 3 ? "instalacao" :
        numericChoice === 4 ? "conteudo" : null;
      if (mapped) {
        send(submenuTextFor(mapped));
        return finish({ action: `menu_${mapped}`, mark_read: true, next_state: mapped });
      }
      if (numericChoice === 5) {
        send("Claro! Pode me contar sua dúvida ou o que você precisa 😊");
        return finish({ action: "menu_duvidas_gerais", mark_read: true, next_state: "geral" });
      }
    }

    if (!bot_state) {
      send("Oi! Sou o assistente do Márcio 🤖");
      send(MAIN_MENU_TEXT);
      return finish({ action: "menu_intro", mark_read: true, next_state: "aguardando_resposta" });
    }

    if (bot_state === "aguardando_resposta_2") {
      send(BOT_GAVE_UP_MSG);
      return finish({ action: "escalated_menu", escalate: true, mark_read: false, next_state: "__clear__" });
    }

    send(`Sem pressa! Pode me contar com suas palavras o que está precisando? Por exemplo: "meu canal travou", "quero pagar" ou "preciso instalar num aparelho novo" 😊`);
    return finish({ action: "menu_retry", mark_read: true, next_state: "aguardando_resposta_2" });
  }

  // ── Item 7, continuação: já dentro de um submenu ────────────────────────
  const isAwaitingConta = /^tecnico_aguardando_conta_[1-6]$/.test(bot_state || "") || bot_state === "pagamento_aguardando_conta_3";

  if (bot_state === "tecnico" || bot_state === "pagamento" || bot_state === "instalacao" || bot_state === "conteudo" || isAwaitingConta) {
    const newContext = detectMenuContext(trimmed);
    if (newContext && newContext !== bot_state) {
      send(submenuTextFor(newContext));
      return finish({ action: `menu_switch_${newContext}`, mark_read: true, next_state: newContext });
    }

    if (bot_state === "conteudo" && CONTEUDO_NOT_FOUND.test(trimmed)) {
      send("Entendido, vou verificar isso direto com o Márcio! Pode ser um conteúdo ainda não mapeado — ele já te retorna. 🙏");
      return finish({ action: "conteudo_escalated", escalate: true, mark_read: false, next_state: "__clear__" });
    }

    const contaRetryMatch = /^tecnico_aguardando_conta_([1-6])$/.exec(bot_state || "");

    if ((bot_state === "tecnico" && numericChoice) || contaRetryMatch) {
      const effectiveChoice = contaRetryMatch ? Number(contaRetryMatch[1]) : numericChoice!;
      let selectedClient = clients[0];

      if (clients.length > 1) {
        const lowerText = trimmed.toLowerCase();
        const contaMatch = /conta\s*([1-9])/i.exec(trimmed);
        let idx: number | null = contaMatch ? Math.max(0, Number(contaMatch[1]) - 1) : null;

        if (idx === null) {
          const serverMatches = clients
            .map((c: any, i: number) => ({ i, name: String(c.server_name || "").toLowerCase() }))
            .filter((m) => m.name && lowerText.includes(m.name));
          if (serverMatches.length === 1) idx = serverMatches[0].i;
        }

        if (idx === null) {
          if (contaRetryMatch) {
            send(BOT_GAVE_UP_MSG);
            return finish({ action: "tecnico_conta_desistiu", escalate: true, mark_read: false, next_state: "__clear__" });
          }
          const lista = clients
            .map((c: any, i: number) => `- Conta ${i + 1}: ${c.display_name} (${c.server_username || "n/i"}) — ${c.server_name}`)
            .join("\n");
          send(`Você tem mais de uma conta — qual delas está com o problema? Pode responder com "conta 1", "conta 2" ou o nome do servidor:\n\n${lista}`);
          return finish({ action: "tecnico_pede_conta", mark_read: true, next_state: `tecnico_aguardando_conta_${effectiveChoice}` });
        }

        selectedClient = clients[idx] || clients[0];
      }

      if (selectedClient?.server_is_offline) {
        send("Identificamos uma instabilidade interna no servidor que já está sendo verificada pela nossa equipe. Em breve tudo estará normalizado! Por enquanto, tente acessar de tempos em tempos — quando voltar, funciona normalmente, sem precisar fazer nada. 🙏");
        return finish({ action: "tecnico_servidor_offline", mark_read: true, next_state: "geral" });
      }

      if (effectiveChoice === 1) {
        send("Segue um passo a passo que costuma resolver a maioria dos problemas:\n1. Desligue o modem da tomada e aguarde 5 minutos\n2. Desligue também a TV da tomada\n3. Após 5 minutos, ligue só o modem e aguarde a internet estabilizar\n4. Só então ligue a TV na tomada\n5. Ligue a TV pelo controle mas não abra o app ainda\n6. Aguarde 1 minuto\n7. Agora abra o app e teste\nSe continuar, me avisa que passo o próximo procedimento.");
        return finish({ action: "tecnico_reset", mark_read: true, next_state: "tecnico" });
      }
      if (effectiveChoice === 2) {
        const cf = await toolVerificarCloudflare();
        send(cf.operacional
          ? "Verifiquei aqui e não identificamos instabilidade externa no momento. Vamos tentar: desligue o modem da tomada por 5 minutos e reabra o aplicativo. Se persistir, me avisa!"
          : "Identificamos que a instabilidade vem de um serviço externo chamado Cloudflare, que faz a ponte entre você e nosso servidor. O time deles já está atuando para corrigir. A normalização deve ocorrer em breve. Obrigado pela paciência! 💙");
        return finish({ action: "tecnico_cloudflare", mark_read: true, next_state: "geral" });
      }
      if (effectiveChoice === 3) {
        send("Isso geralmente é um conflito no reprodutor de vídeo do aplicativo. Vá nas configurações do app (Settings), procure 'Media Player' ou 'Player de Vídeo' e altere de Hardware (HW) para Software (SW) — ou vice-versa. Reinicie o app e teste! 📺");
        return finish({ action: "tecnico_tela_preta", mark_read: true, next_state: "geral" });
      }
      if (effectiveChoice === 4) {
        const idxSelected = clients.indexOf(selectedClient);
        const vencido = selectedClient?.vencimento ? new Date(selectedClient.vencimento).getTime() < Date.now() : false;
        if (vencido) {
          const rawClient = clientMatchesRaw[idxSelected] || clientMatchesRaw[0];
          const portalLink = await toolGerarLinkPortal(sb, tenantId, rawClient);
          send(`Vi aqui que seu acesso está vencido — por isso o sinal parou. 😊\n\nPara renovar:\n👉 ${portalLink}\nSenha: últimos 4 dígitos do seu WhatsApp`);
        } else {
          send("Seu acesso está em dia! Vamos tentar o reset padrão: desligue o modem da tomada por 5 minutos, depois a TV, e teste de novo. Se persistir, me avisa!");
        }
        return finish({ action: "tecnico_vencimento", mark_read: true, next_state: "geral" });
      }
      if (effectiveChoice === 5) {
        send("Pode me contar com detalhes o que está acontecendo? 😊");
        return finish({ action: "tecnico_descrever", mark_read: true, next_state: "tecnico" });
      }
      // ✅ Fallback: "6" dentro do submenu técnico (fora do range 1-5) —
      // mesma correção aplicada no agent, trata como texto livre.
      send("Pode me contar com detalhes o que está acontecendo? 😊");
      return finish({ action: "tecnico_opcao_invalida", mark_read: true, next_state: "tecnico" });
    }

    const pagamentoContaRetry = bot_state === "pagamento_aguardando_conta_3";

    if ((bot_state === "pagamento" && numericChoice) || pagamentoContaRetry) {
      if (!pagamentoContaRetry && numericChoice === 1) {
        // ✅ Checa o sistema ANTES de pedir comprovante — se já tiver um
        // pagamento recente registrado, resolve na hora, sem burocracia.
        const status = await checkRecentPortalPayment(sb, tenantId, clients.map((c: any) => c.id));

        if (status === "auto_confirmed") {
          send(paymentAutoConfirmedMsg(firstName));
          return finish({ action: "pagamento_auto_confirmed", mark_read: true, next_state: "geral" });
        }
        if (status === "manual_pending") {
          send(PAYMENT_MANUAL_PENDING_MSG);
          return finish({ action: "pagamento_manual_pending", mark_read: true, next_state: "geral" });
        }
        if (status === "fulfillment_error") {
          send(PAYMENT_FULFILLMENT_ERROR_MSG);
          return finish({ action: "pagamento_fulfillment_error", mark_read: false, next_state: "geral" });
        }

        send("Pode me mandar o comprovante por aqui, ou me contar quando fez o pagamento, que eu já verifico! 📄");
        return finish({ action: "pagamento_aguardando_comprovante", mark_read: true, next_state: "pagamento" });
      }
      if (!pagamentoContaRetry && numericChoice === 2) {
        const portalLink = await toolGerarLinkPortal(sb, tenantId, clientMatchesRaw[0]);
        send(`Claro! 😊 Acesse o portal para concluir a renovação:\n👉 ${portalLink}\nSenha: últimos 4 dígitos do seu WhatsApp`);
        return finish({ action: "pagamento_renovar", mark_read: true, next_state: "geral" });
      }
      if (pagamentoContaRetry || numericChoice === 3) {
        let selectedClient = clients[0];
        if (clients.length > 1) {
          const lowerText = trimmed.toLowerCase();
          const contaMatch = /conta\s*([1-9])/i.exec(trimmed);
          let idx: number | null = contaMatch ? Math.max(0, Number(contaMatch[1]) - 1) : null;

          if (idx === null) {
            const serverMatches = clients
              .map((c: any, i: number) => ({ i, name: String(c.server_name || "").toLowerCase() }))
              .filter((m) => m.name && lowerText.includes(m.name));
            if (serverMatches.length === 1) idx = serverMatches[0].i;
          }

          if (idx === null) {
            if (pagamentoContaRetry) {
              send(BOT_GAVE_UP_MSG);
              return finish({ action: "pagamento_conta_desistiu", escalate: true, mark_read: false, next_state: "__clear__" });
            }
            const lista = clients
              .map((c: any, i: number) => `- Conta ${i + 1}: ${c.display_name} (${c.server_username || "n/i"}) — ${c.server_name}`)
              .join("\n");
            send(`Você tem mais de uma conta — qual delas você quer consultar? Pode responder com "conta 1", "conta 2" ou o nome do servidor:\n\n${lista}`);
            return finish({ action: "pagamento_pede_conta", mark_read: true, next_state: "pagamento_aguardando_conta_3" });
          }
          selectedClient = clients[idx] || clients[0];
        }

        const precos = await toolConsultarPrecos(sb, tenantId, selectedClient);
        const linhas = (precos.precos || []).map((p: any) => `- ${p.periodo}: ${precos.moeda} ${Number(p.valor).toFixed(2)}`);
        send(linhas.length ? `Segue a tabela de valores da sua conta:\n${linhas.join("\n")}` : "Não encontrei a tabela de preços da sua conta agora — vou encaminhar pro Márcio verificar. 🙏");
        return finish({ action: "pagamento_precos", mark_read: !linhas.length ? false : true, next_state: "geral" });
      }
      if (!pagamentoContaRetry && numericChoice === 4) {
        send("Seu sinal fica ativo até a data de vencimento, sem fidelidade nem multa. Se decidir cancelar, é só não renovar — nenhuma ação extra é necessária. Se mudar de ideia, estarei por aqui! 😊");
        return finish({ action: "pagamento_cancelar", mark_read: true, next_state: "geral" });
      }
      if (!pagamentoContaRetry && numericChoice === 5) {
        send("Pode me contar mais sobre o que você precisa? 😊");
        return finish({ action: "pagamento_outro", mark_read: true, next_state: "pagamento" });
      }
    }

    if (bot_state === "instalacao" && numericChoice) {
      if (numericChoice === 1) {
        send("Legal! 📺 Me diz a marca da sua TV (Samsung, LG, TCL, Philips, Android TV...) que já te indico o aplicativo certo!");
        return finish({ action: "instalacao_tv_nova", mark_read: true, next_state: "instalacao" });
      }
      if (numericChoice === 2) {
        send("Show! 📱 É iPhone/iPad ou Android?");
        return finish({ action: "instalacao_mobile", mark_read: true, next_state: "instalacao" });
      }
      if (numericChoice === 3) {
        send("Para computador (Windows ou Mac), use o Web Player:\n👉 https://gpcpro.com.br/\nCódigo: 1366067\nUsuário e senha são os mesmos do seu servidor.");
        return finish({ action: "instalacao_computador", mark_read: true, next_state: "geral" });
      }
      if (numericChoice === 4) {
        send("Sem problema! Me conta qual aplicativo você já usa que eu te ajudo a reconfigurar.");
        return finish({ action: "instalacao_reconfigurar", mark_read: true, next_state: "instalacao" });
      }
      if (numericChoice === 5) {
        send("Pode me contar mais sobre o que você precisa? 😊");
        return finish({ action: "instalacao_outro", mark_read: true, next_state: "instalacao" });
      }
    }
    // Texto livre dentro do submenu (ou "conteudo" sem match) — cai pro
    // Gemini com prompt filtrado, mais abaixo. Não retorna aqui de propósito.
  }

  // ── Item 5: mensagem automática recente ─────────────────────────────────
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentJob } = await sb
      .from("client_message_jobs")
      .select(`sent_at, automation_id, message_template_id, billing_automations ( name, type )`)
      .eq("tenant_id", tenantId)
      .in("client_id", clients.map((c: any) => c.id).filter(Boolean))
      .eq("status", "SENT")
      .gte("sent_at", twentyFourHoursAgo)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let templateInfo: { name?: string; category?: string } | null = null;
    if (recentJob?.message_template_id) {
      const { data: tpl } = await sb
        .from("message_templates").select("name, category")
        .eq("id", recentJob.message_template_id).maybeSingle();
      templateInfo = tpl || null;
    }

    const jobKind = classifyRecentJob(recentJob, templateInfo);

    if (jobKind !== "none") {
      if (jobKind === "payment_confirmation" && isGratitudeOrGreetingOnly(trimmed)) {
        send(`Que bom, ${firstName}! 😊 Fico feliz que deu tudo certo com sua renovação. Qualquer coisa é só chamar!`);
        return finish({ action: "payment_ack", mark_read: true });
      }
      if (jobKind === "vencimento" && POSTPONEMENT_INTENT.test(trimmed)) {
        send("Sem pressa! Pode ficar tranquilo — quando for renovar, é só acessar o portal que está tudo pronto. Se precisar de ajuda, é só chamar! 😊");
        return finish({ action: "vencimento_ack", mark_read: true });
      }
      if (jobKind === "pos_venda_satisfacao" && !PROBLEM_KEYWORDS.test(trimmed) && trimmed.length < 300) {
        send(`Muito obrigado pelo retorno, ${firstName}! 🙏 Fico feliz que esteja gostando. Qualquer coisa, é só chamar!`);
        return finish({ action: "satisfaction_ack", mark_read: true });
      }
      if ((jobKind === "pos_venda_fidelidade" || jobKind === "pos_venda_generico") && isGratitudeOrGreetingOnly(trimmed)) {
        send(`Que bom, ${firstName}! 😊 Fico feliz em saber. Qualquer coisa, é só chamar!`);
        return finish({ action: "pos_venda_ack", mark_read: true });
      }
    }
  } catch (e: any) {
    safeLog("[BOT][chat-admin] Erro Item5:", e?.message);
  }

  // ── Confirmação simples / link puro ─────────────────────────────────────
  if (isSimpleConfirmation(trimmed)) {
    return finish({ action: "silence_confirmation", mark_read: true });
  }
  if (isLinkOnly(trimmed)) {
    return finish({ action: "silence", mark_read: true });
  }

  // ── RAG ──────────────────────────────────────────────────────────────────
  let templatesText = "(nenhum conhecimento relevante encontrado)";
  try {
    const embedding = await generateEmbedding(geminiKey, trimmed);
    if (embedding) {
      const isSimpleQuery = /^(ol[aá]|oi|bom dia|boa tarde|boa noite|quando vence|meu vencimento|renovar|pagar|quanto custa)$/i.test(trimmed);
      templatesText = await searchBotKnowledge(sb, tenantId, embedding, isSimpleQuery ? 2 : 5);
    }
  } catch (e: any) {
    safeLog("[BOT][chat-admin] RAG erro:", e?.message);
  }

  // ── Histórico de jobs/pagamentos para contexto do prompt ────────────────
  const [{ data: recentJobs }, { data: recentPayments }] = await Promise.all([
    sb.from("client_message_jobs")
      .select("sent_at, message_template_id, status")
      .eq("tenant_id", tenantId)
      .in("client_id", clients.map((c: any) => c.id).filter(Boolean))
      .eq("status", "SENT")
      .order("sent_at", { ascending: false })
      .limit(3),
    sb.from("client_portal_payments")
      .select("created_at, status, fulfillment_status, whatsapp_status, new_vencimento, price_amount, price_currency, period")
      .eq("tenant_id", tenantId)
      .in("client_id", clients.map((c: any) => c.id).filter(Boolean))
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const historicoRecente = [
    "### Últimos envios automáticos:",
    ...(recentJobs?.length ? recentJobs.map((j: any) => `- ${j.message_template_id ? "Lembrete automático" : "Mensagem manual"} enviado em ${toBRDateTime(j.sent_at)}`) : ["- Nenhum envio recente encontrado"]),
    "",
    "### Últimos pagamentos no portal:",
    ...(recentPayments?.length ? recentPayments.map((p: any) => `- ${toBRDateTime(p.created_at)} | ${p.price_currency} ${Number(p.price_amount).toFixed(2)} | status=${p.status} | fulfillment=${p.fulfillment_status} | whatsapp=${p.whatsapp_status ?? "n/a"}${p.new_vencimento ? ` | novo_vencimento=${toBRDateTime(p.new_vencimento)}` : ""}`) : ["- Nenhum pagamento recente encontrado"]),
  ].join("\n");

  const agoraSP = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });

  // ── Prompt: filtrado por categoria (se dentro de submenu) ou completo ───
const effectiveBotState = body.bot_state || bot_state; // ✅ pega o "conteudo" forçado acima, se houver
  const scopedCategories: ScopedCategory[] = ["tecnico", "pagamento", "instalacao", "conteudo"];
  const isScoped = scopedCategories.includes(effectiveBotState as ScopedCategory);

const promptBase = isScoped
    ? buildScopedBotSystemPrompt(effectiveBotState as ScopedCategory, clients, templatesText, { historicoRecente, agoraSP })
    : buildBotSystemPrompt(clients, templatesText, { isTest: true, historicoRecente, agoraSP });

  const systemPrompt = promptBase + "\n\nREGRA DE MÍDIA: Se o cliente mencionar que enviou foto, comprovante ou imagem mas você não recebeu o conteúdo visual, responda: 'Recebi sua mensagem! Para comprovantes de pagamento, você pode renovar direto pelo portal que é automático — ou se preferir, o Márcio vai conferir assim que possível. 😊' Nunca peça para reenviar a imagem.";

  const contents = [...history, { role: "user", parts: [{ text: trimmed }] }];
  const geminiPayload: any = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    tools: [{ functionDeclarations: BOT_TOOL_DECLARATIONS }],
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
  };

  let finalResponse = "";
  try {
    for (let i = 0; i < 5; i++) {
      const result = await callGemini(geminiKey, geminiPayload, 30_000);
      const parts = result?.candidates?.[0]?.content?.parts || [];
      const toolCalls = parts.filter((p: any) => p.functionCall);
      const textPart = parts.find((p: any) => typeof p.text === "string" && p.text.trim());

      if (textPart && !toolCalls.length) {
        finalResponse = textPart.text.trim();
        break;
      }
      if (!toolCalls.length) break;

      geminiPayload.contents.push({ role: "model", parts });
      const toolResults: any[] = [];

      for (const part of toolCalls) {
        const fn = part.functionCall;
        let toolResult: any;
        try {
          switch (fn.name) {
            case "gerar_link_portal": {
              const idx = Math.max(0, (fn.args?.conta_index || 1) - 1);
              const rawClient = clientMatchesRaw[idx] || clientMatchesRaw[0];
              toolResult = { link: await toolGerarLinkPortal(sb, tenantId, rawClient) };
              break;
            }
            case "consultar_precos": {
              const idx = Math.max(0, (fn.args?.conta_index || 1) - 1);
              toolResult = await toolConsultarPrecos(sb, tenantId, clients[idx] || clients[0]);
              break;
            }
            case "verificar_cloudflare":
              toolResult = await toolVerificarCloudflare();
              break;
            case "recomendar_aplicativo": {
              const idx = Math.max(0, (fn.args?.conta_index || 1) - 1);
              const selectedClient = clients[idx] || clients[0];
              toolResult = await toolRecomendarApplicativo(sb, tenantId, selectedClient.server_id || null);
              break;
            }
            default:
              toolResult = { error: "Ferramenta desconhecida" };
          }
        } catch (e: any) {
          toolResult = { error: e?.message };
        }
        toolResults.push({ functionResponse: { name: fn.name, response: toolResult } });
      }
      geminiPayload.contents.push({ role: "user", parts: toolResults });
    }
  } catch (e: any) {
    safeLog("[BOT][chat-admin] Falha ao comunicar com Gemini:", e?.message);
    return NextResponse.json({ error: `Erro na comunicação com a IA: ${e?.message}` }, { status: 502 });
  }

  if (!finalResponse?.trim()) {
    return NextResponse.json({ ok: true, response: "(sem resposta da IA após 5 iterações)", updated_history: history, action: "no_response" });
  }

  const blockedResponses = ["do_not_respond", "silence", "no_response", "ignored"];
  if (blockedResponses.some(b => finalResponse.trim().toLowerCase() === b)) {
    return NextResponse.json({ ok: true, response: "(silêncio — bot optou por não responder)", updated_history: history, action: "silence" });
  }

  // ── Detecção da tag de escalonamento (decisão do Gemini) ────────────────
  const shouldEscalate = finalResponse.includes(ESCALATION_TAG);
  const cleanResponse = shouldEscalate ? finalResponse.split(ESCALATION_TAG).join("").trim() : finalResponse;
  const messageToSend = cleanResponse || HUMAN_REQUESTED_MSG;

  const updatedHistory = [...contents, { role: "model", parts: [{ text: messageToSend }] }];

return NextResponse.json({
    ok: true,
    response: messageToSend,
    updated_history: updatedHistory,
    action: shouldEscalate ? "escalated_gemini" : "responded",
    escalate: shouldEscalate,
    mark_read: shouldEscalate ? false : undefined,
    next_state: shouldEscalate ? "__clear__" : (effectiveBotState === "conteudo" ? "conteudo" : "geral"),
  });
}