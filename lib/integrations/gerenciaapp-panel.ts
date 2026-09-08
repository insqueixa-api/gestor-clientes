// lib/integrations/gerenciaapp-panel.ts
//
// Leitura do status da CONTA MASTER do GerenciaApp (validade da própria
// revenda, não de um cliente) — GET /dashboard, mesma família Inertia da
// rota app/api/integrations/apps/gerenciaapp/route.ts (login por
// email+senha, cookie+XSRF, proxy residencial pra passar do Cloudflare a
// partir da Vercel). Separado num helper próprio porque essa rota nunca
// mexe em MAC/playlist de cliente — só lê `props.auth.user.expire_account`
// da página inicial do painel deles.
import { fetch as undiciFetch, ProxyAgent } from "undici";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const PROXY_URL = String(process.env.GERENCIAAPP_PROXY_URL || "").trim();
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;

function pfetch(url: string, opts: Record<string, any> = {}) {
  return undiciFetch(url, { ...opts, ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {}) }) as unknown as Promise<Response>;
}

function getSetCookies(headers: Headers): string[] {
  return typeof (headers as any).getSetCookie === "function"
    ? (headers as any).getSetCookie()
    : (headers.get("set-cookie") || "").split(/,(?=[^ ])/).filter(Boolean);
}

function parseSetCookies(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of getSetCookies(headers)) {
    const [nameVal] = line.split(";");
    const eq = nameVal.indexOf("=");
    if (eq === -1) continue;
    out[nameVal.slice(0, eq).trim()] = nameVal.slice(eq + 1).trim();
  }
  return out;
}

function cookieHeaderFrom(map: Record<string, string>): string {
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function loginGerenciaApp(baseUrl: string, email: string, password: string) {
  const res1 = await pfetch(`${baseUrl}/login`, { headers: { "User-Agent": UA } });
  const cookies1 = parseSetCookies(res1.headers);
  const xsrf1 = decodeURIComponent(cookies1["XSRF-TOKEN"] || "");
  if (!xsrf1) throw new Error("Não recebi XSRF-TOKEN do painel (GET /login).");

  const res2 = await pfetch(`${baseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-XSRF-TOKEN": xsrf1,
      Cookie: cookieHeaderFrom(cookies1),
      Referer: `${baseUrl}/login`,
      "User-Agent": UA,
    },
    body: JSON.stringify({ email, password, remember: false }),
  });

  if (res2.status !== 302 && res2.status !== 200) {
    throw new Error(`Falha no login do GerenciaApp (HTTP ${res2.status}). Verifique usuário/senha.`);
  }

  const cookies2 = parseSetCookies(res2.headers);
  const merged = { ...cookies1, ...cookies2 };
  return { cookieHeader: cookieHeaderFrom(merged) };
}

// Lê a página inicial (Inertia) do painel — traz `expire_account` (validade
// da própria conta master) e `limit_users`/`limit_used` (não usados aqui,
// mas confirmados vindo do mesmo lugar caso precise no futuro).
export async function fetchGerenciaAppAccountStatus(
  baseUrl: string,
  email: string,
  password: string,
): Promise<{ expire_account: string | null }> {
  const { cookieHeader } = await loginGerenciaApp(baseUrl, email, password);

  const res = await pfetch(`${baseUrl}/dashboard`, {
    redirect: "manual",
    headers: { Accept: "text/html", Cookie: cookieHeader, "User-Agent": UA },
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error("Painel redirecionou ao abrir /dashboard — sessão pode não ter autenticado.");
  }
  const html = await res.text();
  const m = html.match(/data-page="([^"]+)"/);
  if (!m) throw new Error("Não consegui ler os dados do dashboard do GerenciaApp.");
  const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const json = JSON.parse(decoded);
  const expireAccount = json?.props?.auth?.user?.expire_account ?? null;
  return { expire_account: expireAccount };
}
