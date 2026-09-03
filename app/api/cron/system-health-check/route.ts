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
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
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

// ✅ 02/09/2026, pedido do Márcio: os 3 checks abaixo (Supabase/Vercel/
// Cloudflare) mostravam status GENÉRICO da plataforma inteira (statuspage.io
// — "Supabase está no ar pro mundo?"). Ele queria saber do PROJETO dele
// especificamente (CPU/RAM/disco do banco, deploy atual, espaço usado no
// R2) — os checks acima (checkStatusPage) continuam existindo (ainda é útil
// saber se a plataforma em si está com problema), estes são complementares.

// ─── Parser Prometheus (bem simples — só o suficiente pro formato que o
// endpoint de métricas privilegiadas da Supabase devolve) ─────────────────
type PromRow = { name: string; labels: Record<string, string>; value: number };
function parsePrometheus(raw: string): PromRow[] {
  const rows: PromRow[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const withLabels = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+(-?[0-9.eE+]+)\s*$/);
    const noLabels = withLabels ? null : line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+(-?[0-9.eE+]+)\s*$/);
    if (withLabels) {
      const [, name, labelsStr, valStr] = withLabels;
      const labels: Record<string, string> = {};
      for (const lm of labelsStr.matchAll(/(\w+)="([^"]*)"/g)) labels[lm[1]] = lm[2];
      rows.push({ name, labels, value: parseFloat(valStr) });
    } else if (noLabels) {
      const [, name, valStr] = noLabels;
      rows.push({ name, labels: {}, value: parseFloat(valStr) });
    }
  }
  return rows;
}
function metricValue(rows: PromRow[], name: string, match?: (l: Record<string, string>) => boolean): number | null {
  const r = rows.find((r) => r.name === name && (!match || match(r.labels)));
  return r ? r.value : null;
}
function metricSum(rows: PromRow[], name: string, match?: (l: Record<string, string>) => boolean): number {
  return rows.filter((r) => r.name === name && (!match || match(r.labels))).reduce((a, r) => a + r.value, 0);
}

// ✅ CPU% real exige 2 amostras (o Prometheus só expõe contador acumulado
// desde o boot) — guarda a amostra anterior em system_config e compara com
// a atual a cada rodada (5min de intervalo natural, já que quem chama isso
// é o próprio pg_cron do health-check).
async function checkSupabaseProject(): Promise<CheckResult> {
  const key = "supabase_project";
  const label = "Supabase — meu projeto";
  const projectUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const ref = projectUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || "";

  if (!ref || !serviceKey) {
    return { key, label, group: "externos", status: "warn", detail: "Configuração ausente (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)" };
  }

  try {
    const res = await fetchWithTimeout(`https://${ref}.supabase.co/customer/v1/privileged/metrics`, 8000, {
      headers: { Authorization: "Basic " + Buffer.from(`service_role:${serviceKey}`).toString("base64") },
    });
    if (!res.ok) return { key, label, group: "externos", status: "warn", detail: `Falha ao consultar métricas (HTTP ${res.status})` };
    const rows = parsePrometheus(await res.text());

    const memTotal = metricValue(rows, "node_memory_MemTotal_bytes") || 0;
    const memAvail = metricValue(rows, "node_memory_MemAvailable_bytes") || 0;
    const memPct = memTotal > 0 ? Math.round(100 * (1 - memAvail / memTotal)) : null;

    const diskTotal = metricValue(rows, "node_filesystem_size_bytes", (l) => l.mountpoint === "/data") || 0;
    const diskAvail = metricValue(rows, "node_filesystem_avail_bytes", (l) => l.mountpoint === "/data") || 0;
    const diskPct = diskTotal > 0 ? Math.round(100 * (1 - diskAvail / diskTotal)) : null;

    const idleNow = metricSum(rows, "node_cpu_seconds_total", (l) => l.mode === "idle");
    const totalNow = metricSum(rows, "node_cpu_seconds_total");

    let cpuPct: number | null = null;
    const { data: prevRow } = await supabaseAdmin
      .from("system_config").select("config_value").eq("config_key", "supabase_cpu_sample").maybeSingle<{ config_value: string | null }>();
    if (prevRow?.config_value) {
      try {
        const prev = JSON.parse(prevRow.config_value);
        const idleDelta = idleNow - prev.idle;
        const totalDelta = totalNow - prev.total;
        if (totalDelta > 0) cpuPct = Math.max(0, Math.min(100, Math.round(100 * (1 - idleDelta / totalDelta))));
      } catch {}
    }
    await supabaseAdmin.from("system_config").upsert(
      { config_key: "supabase_cpu_sample", config_value: JSON.stringify({ idle: idleNow, total: totalNow }), updated_at: new Date().toISOString() },
      { onConflict: "config_key" },
    );

    const connections = Math.round(metricSum(rows, "pgbouncer_pools_client_active_connections"));

    // ✅ Só entra na conta se SUPABASE_ACCESS_TOKEN estiver configurado —
    // best-effort, não quebra o check se faltar (mesmo padrão do checkGemini
    // quando falta a chave).
    let errosTxt = "";
    const mgmtToken = String(process.env.SUPABASE_ACCESS_TOKEN || "").trim();
    if (mgmtToken) {
      try {
        const sql = `select count(*) as n from postgres_logs where event_message ilike '%error%' and timestamp > (extract(epoch from now() - interval '1 hour') * 1000000)::bigint`;
        const logRes = await fetchWithTimeout(
          `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`,
          8000,
          { headers: { Authorization: `Bearer ${mgmtToken}` } },
        );
        if (logRes.ok) {
          const logJson: any = await logRes.json();
          const n = logJson?.result?.[0]?.n;
          if (n !== undefined) errosTxt = ` · ${n} erro(s) (1h)`;
        }
      } catch {}
    }

    // ✅ 02/09/2026, pedido do Márcio: SUPABASE_ACCESS_TOKEN (Personal Access
    // Token da conta Supabase, sem escopo por projeto) não tem endpoint de
    // auto-consulta de validade — testado, /v1/profile não devolve
    // expiração nenhuma. Guarda a data conhecida (informada na hora da
    // geração) em system_config e avisa aqui mesmo quando faltar pouco,
    // já que "daqui a 1 ano eu não vou lembrar" foi o problema apontado.
    let renovacaoTxt = "";
    let renovacaoUrgente = false;
    if (mgmtToken) {
      const { data: expRow } = await supabaseAdmin
        .from("system_config").select("config_value").eq("config_key", "supabase_access_token_expires_at").maybeSingle<{ config_value: string | null }>();
      if (expRow?.config_value) {
        const expiresAt = new Date(expRow.config_value + "T00:00:00Z");
        const diasRestantes = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
        if (diasRestantes <= 30) {
          renovacaoUrgente = true;
          const situacao = diasRestantes < 0 ? `VENCEU há ${-diasRestantes}d` : `vence em ${diasRestantes}d`;
          renovacaoTxt = ` · ⚠ SUPABASE_ACCESS_TOKEN ${situacao} (${expRow.config_value}) — gere um novo em supabase.com/dashboard/account/tokens e cole na env var SUPABASE_ACCESS_TOKEN (Vercel → Settings → Environment Variables, Production+Preview) + atualize system_config.supabase_access_token_expires_at`;
        }
      }
    }

    const parts = [
      cpuPct !== null ? `CPU ${cpuPct}%` : "CPU (aguardando 2ª amostra)",
      memPct !== null ? `RAM ${memPct}% (${Math.round((memTotal - memAvail) / 1e6)}/${Math.round(memTotal / 1e6)}MB)` : null,
      diskPct !== null ? `Disco ${diskPct}% (${((diskTotal - diskAvail) / 1e9).toFixed(2)}/${(diskTotal / 1e9).toFixed(2)}GB)` : null,
      `${connections} conexões`,
    ].filter(Boolean).join(" · ") + errosTxt + renovacaoTxt;

    const status: CheckStatus =
      (diskPct !== null && diskPct >= 90) || (memPct !== null && memPct >= 90) ? "fail"
      : (diskPct !== null && diskPct >= 75) || (memPct !== null && memPct >= 75) || (cpuPct !== null && cpuPct >= 85) || renovacaoUrgente ? "warn"
      : "ok";

    return { key, label, group: "externos", status, detail: parts };
  } catch (e: any) {
    return { key, label, group: "externos", status: "warn", detail: e?.name === "AbortError" ? "Timeout" : String(e?.message || e).slice(0, 200) };
  }
}

// ✅ IDs do time/projeto — não são segredo (aparecem em qualquer URL do
// dashboard da Vercel), só o VERCEL_API_TOKEN que é sensível.
const VERCEL_TEAM_ID    = "team_6oAx0zyYrtURvDCz8BvnY0TU";
const VERCEL_PROJECT_ID = "prj_5i6GIEoZw6AIAPAjpUY7NYR29nxy";

async function checkVercelProject(): Promise<CheckResult> {
  const key = "vercel_project";
  const label = "Vercel — meu projeto";
  const token = String(process.env.VERCEL_API_TOKEN || "").trim();

  if (!token) {
    return { key, label, group: "externos", status: "warn", detail: "VERCEL_API_TOKEN não configurado" };
  }

  try {
    const t0 = Date.now();
    const [depRes, pingRes] = await Promise.all([
      fetchWithTimeout(`https://api.vercel.com/v6/deployments?teamId=${VERCEL_TEAM_ID}&projectId=${VERCEL_PROJECT_ID}&limit=5`, 8000, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetchWithTimeout("https://unigestor.net.br/", 6000).catch(() => null),
    ]);
    const pingMs = Date.now() - t0;

    if (!depRes.ok) return { key, label, group: "externos", status: "warn", detail: `Falha ao consultar Vercel (HTTP ${depRes.status})` };
    const depJson: any = await depRes.json();
    const deps: any[] = depJson?.deployments || [];
    const latest = deps[0];
    const okCount = deps.filter((d) => d.state === "READY").length;
    const ageMin = latest ? Math.round((Date.now() - latest.createdAt) / 60000) : null;
    const pingOk = !!pingRes && pingRes.ok;

    const parts = [
      latest ? `Deploy atual: ${latest.readyState}${ageMin !== null ? ` (${ageMin}min atrás)` : ""}` : "Sem deploys",
      deps.length > 0 ? `últimos ${deps.length}: ${okCount}/${deps.length} OK` : null,
      `unigestor.net.br: ${pingOk ? `respondeu em ${pingMs}ms` : "sem resposta"}`,
    ].filter(Boolean).join(" · ");

    const status: CheckStatus =
      latest?.readyState === "ERROR" || latest?.readyState === "CANCELED" || !pingOk ? "fail"
      : latest?.readyState === "BUILDING" || latest?.readyState === "QUEUED" || okCount < deps.length ? "warn"
      : "ok";

    return { key, label, group: "externos", status, detail: parts };
  } catch (e: any) {
    return { key, label, group: "externos", status: "warn", detail: e?.name === "AbortError" ? "Timeout" : String(e?.message || e).slice(0, 200) };
  }
}

// ✅ Não precisa de token novo do Cloudflare — testado 02/09/2026: os 2
// buckets juntos têm só ~220 objetos/63MB, ListObjectsV2 completo em
// <1s. Trava de segurança em 30 páginas (30k objetos) pra nunca virar uma
// chamada longa se o volume crescer muito.
async function checkCloudflareR2(): Promise<CheckResult> {
  const key = "cloudflare_r2";
  const label = "Cloudflare R2 — meu projeto";
  const accountId       = String(process.env.R2_ACCOUNT_ID || "").trim();
  const accessKeyId     = String(process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucketMedia     = String(process.env.R2_BUCKET_NAME || "unigestor-media").trim();
  const bucketVault     = String(process.env.R2_VAULT_BUCKET_NAME || "").trim();

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return { key, label, group: "externos", status: "warn", detail: "Credenciais R2 ausentes" };
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  async function bucketStats(bucket: string) {
    let count = 0, bytes = 0, token: string | undefined, pages = 0;
    do {
      const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }));
      count += (r.Contents || []).length;
      bytes += (r.Contents || []).reduce((a, o) => a + (o.Size || 0), 0);
      token = r.NextContinuationToken;
      pages++;
    } while (token && pages < 30);
    return { count, bytes };
  }

  try {
    const t0 = Date.now();
    const media = await bucketStats(bucketMedia);
    const vault = bucketVault ? await bucketStats(bucketVault) : null;
    const ms = Date.now() - t0;

    const totalGB = (media.bytes + (vault?.bytes || 0)) / 1e9;
    const parts = [
      `${bucketMedia}: ${media.count} arquivos, ${(media.bytes / 1e6).toFixed(1)}MB`,
      vault ? `${bucketVault}: ${vault.count} arquivos, ${(vault.bytes / 1e6).toFixed(1)}MB` : null,
      `respondeu em ${ms}ms`,
    ].filter(Boolean).join(" · ");

    // R2 tem 10GB grátis de armazenamento/mês — aviso perto do limite.
    const status: CheckStatus = totalGB >= 9 ? "warn" : "ok";

    return { key, label, group: "externos", status, detail: parts };
  } catch (e: any) {
    return { key, label, group: "externos", status: "fail", detail: String(e?.message || e).slice(0, 200) };
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
    checkSupabaseProject(),
    checkVercelProject(),
    checkCloudflareR2(),
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
