// app/api/cron/system-health-check/route.ts
// ✅ 31/08/2026, pedido do Márcio depois do incidente da ProxyBR: painel
// "Sistema" (renomeado de "Crons") reflete VMs (Hetzner/Google), sessões
// WhatsApp (principal crítica, secundária só aviso), proxy dedicado (com
// aviso de validade — não só se caiu) e status de Supabase/Vercel/
// Cloudflare/Gemini (grátis+paga). TODAS as checagens daqui são EXTERNAS
// (~9 chamadas curtas, em paralelo, timeout de 6-8s cada) — de propósito
// rodam só aqui, disparadas por 1 pg_cron a cada 5min (docs/sql/
// system_health_checks.sql), NUNCA a partir da página (GET /api/system-
// health só lê o cache). Isso é o que o Márcio pediu explicitamente: "não
// consumir muito tempo/CPU da Vercel" — a página pode ser aberta 50x no
// dia sem gerar 1 chamada externa a mais.
import crypto from "crypto";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { requireAdminTenant } from "@/lib/api/auth";
import { getWAContextOrCron, proxyVM } from "@/lib/whatsapp/wa-context";
import { getActiveProxyOrder } from "@/lib/proxybr";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Mesmo mecanismo de app/api/whatsapp/* (x-cron-secret + CRON_CONTROL_SECRET)
// — reaproveitado aqui em vez de inventar um segredo novo só pra essa rota.
function isSystemCronRequest(req: Request): boolean {
  const secret = process.env.CRON_CONTROL_SECRET || "";
  const header = req.headers.get("x-cron-secret") || "";
  if (!secret || !header || header.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(secret));
}

type CheckStatus = "ok" | "warn" | "fail";
type CheckResult = { key: string; label: string; group: "infra" | "whatsapp" | "externos"; status: CheckStatus; detail: string };

async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function checkHttpOk(key: string, label: string, group: CheckResult["group"], url: string, timeoutMs = 6000): Promise<CheckResult> {
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    return { key, label, group, status: res.ok ? "ok" : "fail", detail: res.ok ? "" : `HTTP ${res.status}` };
  } catch (e: any) {
    return { key, label, group, status: "fail", detail: e?.name === "AbortError" ? "Timeout" : String(e?.message || e).slice(0, 200) };
  }
}

// ✅ statuspage.io sempre manda `description` em inglês, atrelado 1:1 ao
// `indicator` — traduzido aqui em vez de repassar cru (pedido do Márcio).
const INDICATOR_PT: Record<string, string> = {
  none: "Operacional",
  minor: "Instabilidade pontual (impacto leve)",
  major: "Interrupção parcial do serviço",
  critical: "Interrupção grave do serviço",
};

// Providers usam o mesmo formato de status page (statuspage.io).
// ✅ 01/09/2026, pedido do Márcio: "warn" só com "Instabilidade pontual
// (impacto leve)" não dizia NADA do que é — tinha que perguntar pra IA (e
// mesmo assim ela não sabia o incidente real). Agora busca também o nome
// do incidente aberto de verdade (mesmo statuspage.io, endpoint
// /incidents/unresolved.json) e mostra direto no painel, sem precisar de
// IA nenhuma pra saber O QUE está instável.
async function checkStatusPage(key: string, label: string, url: string): Promise<CheckResult> {
  try {
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) return { key, label, group: "externos", status: "warn", detail: `HTTP ${res.status} ao consultar status` };
    const json: any = await res.json();
    const indicator = String(json?.status?.indicator || "none");
    const status: CheckStatus = indicator === "none" ? "ok" : indicator === "minor" ? "warn" : "fail";

    if (indicator === "none") {
      return { key, label, group: "externos", status, detail: "" };
    }

    let incidentName = "";
    try {
      const incidentsUrl = url.replace(/status\.json$/, "incidents/unresolved.json");
      const incRes = await fetchWithTimeout(incidentsUrl, 6000);
      if (incRes.ok) {
        const incJson: any = await incRes.json();
        const incidents = Array.isArray(incJson?.incidents) ? incJson.incidents : [];
        // pega o de maior impacto (critical > major > minor > none)
        const rank: Record<string, number> = { critical: 3, major: 2, minor: 1, none: 0 };
        const top = incidents.sort((a: any, b: any) => (rank[b?.impact] || 0) - (rank[a?.impact] || 0))[0];
        incidentName = top?.name || "";
      }
    } catch {
      // segue sem o nome do incidente — detail genérico ainda é melhor que quebrar o check
    }

    const base = INDICATOR_PT[indicator] || json?.status?.description || "Operacional";
    return { key, label, group: "externos", status, detail: incidentName ? `${base} — ${incidentName}` : base };
  } catch (e: any) {
    return { key, label, group: "externos", status: "warn", detail: "Falha ao consultar status page" };
  }
}

async function checkGemini(key: string, label: string, apiKey: string | undefined): Promise<CheckResult> {
  if (!apiKey) return { key, label, group: "externos", status: "warn", detail: "Chave não configurada" };
  try {
    const res = await fetchWithTimeout(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
      8000,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
      },
    );
    if (res.ok) return { key, label, group: "externos", status: "ok", detail: "" };
    if (res.status === 429 || res.status === 503) {
      return { key, label, group: "externos", status: "warn", detail: `HTTP ${res.status} (cota/sobrecarga momentânea)` };
    }
    return { key, label, group: "externos", status: "fail", detail: `HTTP ${res.status}` };
  } catch (e: any) {
    return { key, label, group: "externos", status: "warn", detail: e?.name === "AbortError" ? "Timeout" : String(e?.message || e).slice(0, 200) };
  }
}

// ✅ Testa o proxy dedicado de verdade (não só "responde", mas "consegue
// completar uma requisição através dele") E avisa da validade — pedido do
// Márcio: "não é só se caiu, quero saber se não é caso de vencido" — dá
// pra estar OK agora e vencer em 2 dias sem aviso nenhum se só checar
// conectividade. Validade/saldo/auto-renovação vêm da API real da ProxyBR
// (achada pelo Márcio, portal.proxybr.com.br/api/v1 — ver lib/proxybr.ts),
// não mais de um campo editável manual — dado sempre atual, sem precisar
// de mim pra manter.
async function checkProxy(): Promise<CheckResult> {
  // ✅ Roda na Vercel, então lê GERENCIAAPP_PROXY_URL (a que de propósito
  // ESTÁ configurada lá) — não WHATSAPP_PROXY_URL, que fica só na VM por
  // decisão deliberada antiga (ver .env.local). Mesmo valor hoje, mesmo
  // proxy dedicado — só a variável certa pro ambiente certo.
  const proxyUrl = String(process.env.GERENCIAAPP_PROXY_URL || "").trim();
  const apiToken = String(process.env.PROXYBR_API_TOKEN || "").trim();

  let validadeTxt = "validade desconhecida (PROXYBR_API_TOKEN ausente)";
  let diasRestantes: number | null = null;
  if (apiToken) {
    try {
      const { order, balance } = await getActiveProxyOrder(apiToken);
      if (order) {
        diasRestantes = Math.ceil((new Date(order.expires_at).getTime() - Date.now()) / 86_400_000);
        const dataFmt = new Date(order.expires_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        const saldoFmt = balance != null ? `R$${balance.toFixed(2)}` : "?";
        const autoRenovTxt = order.auto_renew_active ? "auto-renov. ligada" : "auto-renov. DESLIGADA";
        validadeTxt = `${diasRestantes < 0 ? "venceu" : "expira"} em ${dataFmt} (${diasRestantes}d) · saldo ${saldoFmt} · ${autoRenovTxt}`;
      } else {
        validadeTxt = "nenhum pedido ativo encontrado na conta ProxyBR";
      }
    } catch (e: any) {
      validadeTxt = `falha ao consultar API da ProxyBR: ${String(e?.message || e).slice(0, 150)}`;
    }
  }

  if (!proxyUrl) {
    return { key: "proxy", label: "Proxy dedicado (ProxyBR)", group: "infra", status: "fail", detail: "GERENCIAAPP_PROXY_URL não configurada" };
  }

  let conectividadeOk = false;
  let erroConectividade = "";
  try {
    const dispatcher = new ProxyAgent(proxyUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      // ✅ 01/09/2026, bug real achado: testava contra api.ipify.org, que
      // esse (e provavelmente qualquer) proxy de datacenter/residencial não
      // consegue alcançar — serviços de "qual é meu IP" costumam bloquear
      // faixas de proxy de propósito. Testado manualmente: api.ipify.org e
      // httpbin.org falhavam SEMPRE através deste proxy, enquanto
      // web.whatsapp.com (o destino que de fato importa, já que esse proxy
      // só existe pro WhatsApp/GerenciaApp) respondia OK de forma
      // consistente. Painel mostrava "Falha" com o WhatsApp genuinamente
      // conectado e funcionando — falso negativo.
      const res = await (undiciFetch("https://web.whatsapp.com", {
        dispatcher,
        signal: controller.signal,
      }) as unknown as Promise<Response>);
      conectividadeOk = res.ok;
      if (!res.ok) erroConectividade = `HTTP ${res.status}`;
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    erroConectividade = e?.name === "AbortError" ? "Timeout" : String(e?.message || e).slice(0, 150);
  }

  // Vencido ou perto de vencer (<=5 dias) sempre gera aviso, mesmo se ainda
  // estiver respondendo agora — é o "avisa ANTES de morrer" que foi pedido.
  if (!conectividadeOk) {
    return { key: "proxy", label: "Proxy dedicado (ProxyBR)", group: "infra", status: "fail", detail: `Sem resposta (${erroConectividade}) · ${validadeTxt}` };
  }
  if (diasRestantes !== null && diasRestantes <= 5) {
    return { key: "proxy", label: "Proxy dedicado (ProxyBR)", group: "infra", status: "warn", detail: `Conectando OK, mas ${validadeTxt} — renovar em portal.proxybr.com.br` };
  }
  return { key: "proxy", label: "Proxy dedicado (ProxyBR)", group: "infra", status: "ok", detail: validadeTxt };
}

// ✅ 31/08/2026, achado do Márcio: o cron "Despachar cobranças" mostrava
// Tudo OK mesmo com envios reais falhando (WhatsApp desconectado) — porque
// o cron_health só sabe se a ROTA rodou sem exceção, não se as mensagens
// de fato saíram. Isso aqui checa o resultado de verdade (client_message_
// jobs) nas últimas 6h — sintoma direto, complementar ao status da sessão
// WhatsApp acima (que já mostra a causa raiz mais comum).
async function checkBillingSends(): Promise<CheckResult> {
  const seisHorasAtras = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: failed, error } = await supabaseAdmin
    .from("client_message_jobs")
    .select("client_id, reseller_id, error_message, updated_at")
    .eq("status", "FAILED")
    .gte("updated_at", seisHorasAtras)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    return { key: "billing_sends", label: "Envios de cobrança (últimas 6h)", group: "whatsapp", status: "warn", detail: `Falha ao consultar: ${error.message}` };
  }
  if (!failed?.length) {
    return { key: "billing_sends", label: "Envios de cobrança (últimas 6h)", group: "whatsapp", status: "ok", detail: "" };
  }

  // ✅ 01/09/2026, achado do Márcio: um envio que falhou mas foi recuperado
  // pelo retry automático (ex: "Plano B" de fulfillment.ts, +2min depois)
  // já não é mais um problema em aberto — o cliente recebeu a mensagem, só
  // mais tarde. Sem isso, 1 falha pontual já resolvida ficava marcada
  // "Falha" no painel por até 6h à toa. Só conta quem NÃO tem um SENT mais
  // recente que a própria falha pro mesmo destinatário.
  const { data: sent } = await supabaseAdmin
    .from("client_message_jobs")
    .select("client_id, reseller_id, updated_at")
    .eq("status", "SENT")
    .gte("updated_at", seisHorasAtras)
    .limit(200);

  const latestSentByRecipient = new Map<string, string>();
  for (const s of sent || []) {
    const key = `${s.client_id || ""}:${s.reseller_id || ""}`;
    const prev = latestSentByRecipient.get(key);
    if (!prev || s.updated_at > prev) latestSentByRecipient.set(key, s.updated_at);
  }

  const unresolved = failed.filter((f: any) => {
    const key = `${f.client_id || ""}:${f.reseller_id || ""}`;
    const latestSent = latestSentByRecipient.get(key);
    return !latestSent || latestSent < f.updated_at;
  });

  if (unresolved.length === 0) {
    return { key: "billing_sends", label: "Envios de cobrança (últimas 6h)", group: "whatsapp", status: "ok", detail: "" };
  }

  const exemplo = unresolved[0]?.error_message || "";
  return {
    key: "billing_sends",
    label: "Envios de cobrança (últimas 6h)",
    group: "whatsapp",
    status: "fail",
    detail: `${unresolved.length} falha(s) sem recuperação${exemplo ? ` — ex: ${exemplo}` : ""}`,
  };
}

// ✅ 428/408 no log do WhatsApp reconectam sozinhos na maioria das vezes —
// só "connected" ou "connecting" (no meio de uma reconexão, ainda não
// esgotou tentativas) contam como saudável; qualquer outra coisa (incluindo
// sessão nunca criada) é considerado desconectado de verdade.
async function checkWhatsAppSession(req: Request, session: 1 | 2): Promise<CheckResult> {
  const label = session === 1 ? "WhatsApp — Principal" : "WhatsApp — Secundário";
  // fail pra principal (crítico, bloqueia cobrança), warn pra secundária
  // (só usada eventualmente) — pedido explícito do Márcio.
  const statusSeVaziou: CheckStatus = session === 1 ? "fail" : "warn";

  const ctx = await getWAContextOrCron(req, session);
  if (!ctx) {
    return { key: `whatsapp_${session}`, label, group: "whatsapp", status: statusSeVaziou, detail: "Configuração ausente (env vars)" };
  }

  try {
    const result = await proxyVM(ctx, "/status", { method: "GET" });
    const status = result.json?.status as string | undefined;
    const saudavel = status === "connected" || status === "connecting";
    return {
      key: `whatsapp_${session}`,
      label,
      group: "whatsapp",
      status: saudavel ? "ok" : statusSeVaziou,
      detail: saudavel ? (status === "connecting" ? "Reconectando…" : "") : "Desconectado — precisa escanear QR Code",
    };
  } catch (e: any) {
    return { key: `whatsapp_${session}`, label, group: "whatsapp", status: statusSeVaziou, detail: e?.message?.slice(0, 200) || "Falha ao consultar a VM" };
  }
}

async function runAllChecks(req: Request): Promise<CheckResult[]> {
  const pdfVmBase = String(process.env.PDF_VM_BASE_URL || "").trim();
  const waBase = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();

  const checks = await Promise.all([
    checkWhatsAppSession(req, 1),
    checkWhatsAppSession(req, 2),
    checkBillingSends(),
    waBase
      ? checkHttpOk("vm_hetzner", "VM Hetzner (WhatsApp)", "infra", `${waBase}/health`)
      : Promise.resolve<CheckResult>({ key: "vm_hetzner", label: "VM Hetzner (WhatsApp)", group: "infra", status: "fail", detail: "UNIGESTOR_WA_BASE_URL não configurada" }),
    pdfVmBase
      ? checkHttpOk("vm_google", "VM Google Cloud (PDF)", "infra", pdfVmBase)
      : Promise.resolve<CheckResult>({ key: "vm_google", label: "VM Google Cloud (PDF)", group: "infra", status: "fail", detail: "PDF_VM_BASE_URL não configurada" }),
    checkProxy(),
    checkStatusPage("supabase", "Supabase", "https://status.supabase.com/api/v2/status.json"),
    checkStatusPage("vercel", "Vercel", "https://www.vercel-status.com/api/v2/status.json"),
    checkStatusPage("cloudflare", "Cloudflare", "https://www.cloudflarestatus.com/api/v2/status.json"),
    checkGemini("gemini_free", "Gemini (chave grátis)", process.env.GEMINI_API_KEY),
    checkGemini("gemini_paid", "Gemini (chave paga, fallback)", process.env.GEMINI_API_KEY_PAID),
  ]);

  return checks;
}

async function handle(req: Request) {
  if (!isSystemCronRequest(req)) {
    const auth = await requireAdminTenant(req);
    if (!auth.ok) return auth.res;
  }

  const results = await runAllChecks(req);

  const rows = results.map((r) => ({
    check_key: r.key,
    label: r.label,
    group_key: r.group,
    status: r.status,
    detail: r.detail.slice(0, 300),
    checked_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin.from("system_health_checks").upsert(rows, { onConflict: "check_key" });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, checked: rows.length });
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
