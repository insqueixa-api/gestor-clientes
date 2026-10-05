// lib/integrations/elite-api.ts
// ✅ 05/10/2026: cliente da API oficial do Elite (https://new.offo.dad/api/v1)
// — substitui o fluxo antigo pela extensão (adminx.offo.dad saiu do ar).
//
// Regras da documentação deles, todas tratadas aqui (não espalhar pelas rotas):
// - chave SÓ no cabeçalho Authorization: Bearer (nunca na URL);
// - todo POST leva Idempotency-Key (16–64, [A-Za-z0-9_-]); repetição em
//   timeout/429/503 usa EXATAMENTE a mesma URL, corpo e chave — chave nova
//   seria outro pedido (ex: renovação em dobro);
// - 202 = needs_review: não repetir com outra chave;
// - limites: 60 req/min e 1.500/dia por chave, 10 escritas/min por revenda;
// - 401 = chave inválida/expirada/revogada (troca de senha do painel também
//   revoga) → avisa no sino + e-mail na hora, além do aviso de 2 dias antes.
//
// A chave fica em server_integrations.api_token (vence em 90 dias, troca pela
// tela de Integrações) e a validade em api_token_expires_at.
import { randomUUID } from "crypto";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { adminSupabase } from "@/lib/api/auth";
import { notify } from "@/lib/notifications/notify";
import { sendAdminEmail } from "@/lib/notifications/send-admin-email";
import { getGerenciaAppProxyDispatcher } from "@/lib/integrations/gerenciaapp-proxy";

export const ELITE_API_BASE = "https://new.offo.dad/api/v1";

export type EliteTech = "iptv" | "p2p";

/** Tecnologia do cliente no UniGestor → rota do Elite (padrão IPTV). */
export function eliteTechOf(technology: unknown): EliteTech {
  return /p2p/i.test(String(technology ?? "")) ? "p2p" : "iptv";
}

export type EliteIntegration = {
  id: string;
  tenant_id: string;
  api_token: string | null;
  // endereço da API editável no modal (vazio = ELITE_API_BASE)
  api_base_url?: string | null;
  integration_name?: string | null;
  // proxy cadastrado na integração (server_integrations.proxy_url) — se
  // houver, TODA chamada ao Elite sai por ele (IP da Vercel pode ser barrado)
  proxy_url?: string | null;
};

const proxyCache = new Map<string, ProxyAgent>();
function proxyFor(url: string | null | undefined): ProxyAgent | undefined {
  const u = String(url || "").trim();
  if (!u) return undefined;
  let agent = proxyCache.get(u);
  if (!agent) {
    agent = new ProxyAgent(u);
    proxyCache.set(u, agent);
  }
  return agent;
}

/** Texto curto da resposta crua (HTML de bloqueio, etc.) pra mensagem de erro. */
function rawSnippet(data: any): string {
  const raw = typeof data?.raw === "string" ? data.raw : "";
  return raw.replace(/<[^>]*>/g, " ").replace(/s+/g, " ").trim().slice(0, 140);
}

export class EliteApiError extends Error {
  status: number;
  code: string | null;
  data: any;
  requestId: string | null;
  constructor(message: string, status: number, data: any, requestId: string | null) {
    super(message);
    this.status = status;
    this.data = data;
    this.code = (data && (data.code || data.error_code || data.error?.code)) || null;
    this.requestId = requestId;
  }
}

/**
 * Endereço salvo na integração (editável no modal). Só domínio, sem caminho
 * (cadastro antigo "https://new.offo.dad") → completa com /api/v1. Nunca
 * aceita http: a chave iria em texto aberto.
 */
export function eliteBaseUrl(saved: string | null | undefined): string {
  const raw = String(saved || "").trim().replace(/\/+$/, "");
  if (!raw) return ELITE_API_BASE;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
  } catch {
    throw new EliteApiError("Endereço da API Elite inválido no cadastro da integração.", 0, null, null);
  }
  if (u.protocol !== "https:") {
    throw new EliteApiError("O endereço da API Elite precisa ser https.", 0, null, null);
  }
  const path = u.pathname.replace(/\/+$/, "");
  return u.origin + (path ? path : "/api/v1");
}

/** Idempotency-Key no formato aceito (16–64, letras/números/hífen/sublinhado). */
export function eliteIdempotencyKey(prefix: string): string {
  const clean = String(prefix || "ug").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "ug";
  return `${clean}-${randomUUID().replace(/-/g, "")}`.slice(0, 64);
}

function pickMessage(data: any, status: number): string {
  const m =
    (data && (data.message || data.error_description || data.detail)) ||
    (data && typeof data.error === "string" ? data.error : data?.error?.message) ||
    null;
  if (m) return String(m);
  if (status === 401) return "Chave da API Elite inválida ou vencida.";
  if (status === 403) return "A chave da API Elite não tem permissão para esta ação.";
  if (status === 404) return "Não encontrado no Elite (endereço inexistente, ou cliente fora da sua conta).";
  if (status === 409) return "Conflito no Elite (operação em andamento ou custo acima do limite).";
  if (status === 422) return "O Elite recusou os dados enviados.";
  if (status === 429) return "Limite de chamadas da API Elite atingido. Tente de novo em instantes.";
  if (status >= 500) return "Painel Elite indisponível no momento.";
  return `Erro ${status} na API Elite.`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function alertInvalidKey(integ: EliteIntegration, message: string) {
  const title = "🔑 Chave da API Elite recusada";
  const text = `A API do Elite recusou a chave da integração "${integ.integration_name || "Elite"}" (${message}). Gere uma chave nova no painel e troque em Configurações → Integrações. Até lá, testes e renovações do Elite não funcionam.`;
  try {
    await notify({
      tenantId: integ.tenant_id,
      type: "chave_api_vencendo",
      title,
      message: text,
      link: "/admin/settings/api-server",
      sourceId: integ.id,
    });
  } catch (e) {
    console.error("[ELITE] falha no sino da chave inválida", (e as any)?.message);
  }
  try {
    await sendAdminEmail(`🚨 ${title}`, `<p>${text}</p>`);
  } catch (e) {
    console.error("[ELITE] falha no e-mail da chave inválida", (e as any)?.message);
  }
}

/**
 * Chamada única à API. POST sempre com Idempotency-Key (gera se não vier);
 * repete até 2x em rede/429/503 com a MESMA chave e o mesmo corpo.
 */
export async function eliteRequest<T = any>(
  integ: EliteIntegration,
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; query?: Record<string, string | number | null | undefined>; idempotencyKey?: string } = {},
): Promise<{ status: number; data: T; requestId: string | null; idempotencyKey: string | null }> {
  const token = String(integ.api_token || "").trim();
  if (!token) throw new EliteApiError("Integração Elite sem chave de API cadastrada.", 0, null, null);

  const url = new URL(eliteBaseUrl(integ.api_base_url) + path);
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const idemKey = method === "POST" ? opts.idempotencyKey || eliteIdempotencyKey("ug") : null;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = idemKey!;
  }
  const payload = method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined;

  // ✅ 05/10/2026: sai pelo proxy residencial BR (ProxyBR, o mesmo do
  // GerenciaApp, editável no card ProxyBR) — sem proxy o Elite barrava o IP
  // da Vercel (404 antes da API, chave "nunca usada"); o proxy_url antigo da
  // integração (datacenter EUA) não respondia. proxy_url só como reserva.
  const proxyBr = await getGerenciaAppProxyDispatcher();
  const dispatcher = proxyBr ?? proxyFor(integ.proxy_url);
  const via = proxyBr ? "proxy ProxyBR" : dispatcher ? "proxy da integração" : "sem proxy";
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = (await undiciFetch(url.toString(), {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(20000),
        ...(dispatcher ? { dispatcher } : {}),
      })) as unknown as Response;
    } catch (e) {
      // timeout/rede: repete com a mesma chave (a doc manda exatamente isso)
      lastErr = e;
      await sleep(1500 * (attempt + 1));
      continue;
    }

    const requestId = res.headers.get("x-request-id");
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 500) };
    }

    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) * 1000 : 2000 * (attempt + 1));
      continue;
    }

    if (res.status === 401) {
      const msg = pickMessage(data, 401);
      await alertInvalidKey(integ, msg);
      throw new EliteApiError(msg, 401, data, requestId);
    }

    if (res.status >= 400) {
      console.error("[ELITE] erro", { path, status: res.status, requestId, via, data });
      // Sem mensagem JSON do Elite = provavelmente nem chegou na API (bloqueio
      // na borda, página HTML) → mostra HTTP, X-Request-ID e o começo da
      // resposta pra dar pra saber quem respondeu.
      const hasJsonMsg = !!(data && !data.raw && (data.message || data.error || data.detail));
      const extra = hasJsonMsg
        ? ""
        : ` [${via} · HTTP ${res.status}${requestId ? ` · X-Request-ID ${requestId}` : " · sem X-Request-ID (não veio da API)"}${rawSnippet(data) ? ` · ${rawSnippet(data)}` : ""}]`;
      throw new EliteApiError(pickMessage(data, res.status) + extra, res.status, data, requestId);
    }

    return { status: res.status, data: data as T, requestId, idempotencyKey: idemKey };
  }

  throw new EliteApiError(
    `Sem resposta do painel Elite (${via}: ${[(lastErr as any)?.message, (lastErr as any)?.cause?.code || (lastErr as any)?.cause?.message].filter(Boolean).join(" · ") || "rede"}).`,
    0,
    null,
    null,
  );
}

/** Desembrulha { data: ... } se a resposta vier envelopada. */
export function eliteUnwrap(data: any): any {
  if (data && typeof data === "object" && !Array.isArray(data) && data.data !== undefined) return data.data;
  return data;
}

/** Saldo e login da conta (GET /me). */
export async function eliteMe(integ: EliteIntegration) {
  const { data } = await eliteRequest(integ, "GET", "/me");
  const d = eliteUnwrap(data) || {};
  const acc = d.account || d.reseller || d.user || d;
  const rawCredits = acc.credits ?? acc.balance ?? acc.saldo ?? acc.credit ?? null;
  const credits = rawCredits === null || rawCredits === undefined ? null : Number(rawCredits);
  return {
    id: acc.id != null ? Number(acc.id) : null,
    username: (acc.username || acc.login || null) as string | null,
    credits: credits !== null && Number.isFinite(credits) ? credits : null,
    raw: data,
  };
}

/** Busca 1 cliente pelo login exato (search casa parte do login → filtra aqui). */
export async function eliteFindClientByUsername(integ: EliteIntegration, tech: EliteTech, username: string) {
  const { data } = await eliteRequest(integ, "GET", `/${tech}/clients`, {
    query: { search: username, limit: 100, after_id: 0 },
  });
  const list = eliteList(data);
  const u = username.trim().toLowerCase();
  return list.find((c: any) => String(c?.username || c?.login || "").trim().toLowerCase() === u) || null;
}

/** Itens de uma listagem, aceitando { data: [...] } / { items: [...] } / { clients: [...] }. */
export function eliteList(data: any): any[] {
  if (Array.isArray(data)) return data;
  for (const k of ["data", "items", "clients", "results"]) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  return [];
}

/** Lê o vencimento do cliente em qualquer formato que o Elite devolver. */
export function eliteExpiry(client: any): string | null {
  const c = eliteUnwrap(client) || {};
  const v =
    c.expires_at ?? c.exp_date ?? c.expires ?? c.expiry ?? c.expiration ?? c.expire_at ?? c.due_date ?? c.client?.expires_at ?? null;
  if (v === null || v === undefined || v === "") return null;
  // Formato real (05/10/2026): IPTV exp_date e P2P expires_at em segundos;
  // P2P sem 1º acesso vem 0 = "ainda sem vencimento" (não é 1970).
  if (typeof v === "number" || /^d+$/.test(String(v))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Lê a integração Elite (service role) — sempre filtrando pelo tenant. */
export async function loadEliteIntegration(integrationId: string, tenantId: string): Promise<EliteIntegration & { is_active: boolean; provider: string }> {
  const sb = adminSupabase();
  const { data, error } = await sb
    .from("server_integrations")
    .select("id, tenant_id, provider, api_token, integration_name, is_active, proxy_url, api_base_url")
    .eq("id", integrationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) throw new EliteApiError("Integração Elite não encontrada.", 404, null, null);
  if (String(data.provider).toUpperCase() !== "ELITE") throw new EliteApiError("A integração não é Elite.", 400, null, null);
  if (!data.is_active) throw new EliteApiError("A integração Elite está inativa.", 400, null, null);
  return data as any;
}
