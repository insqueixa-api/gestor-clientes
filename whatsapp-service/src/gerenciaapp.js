// src/gerenciaapp.js
// Réplica do fluxo GERENCIAAPP_CREATE/GERENCIAAPP_DELETE que a extensão
// (unigestor-extensao/background.js) já faz — mas rodando aqui na VM,
// server-to-server, saindo por um proxy residencial (em vez do navegador
// do Márcio) pra não cair no bloqueio de IP de datacenter da Cloudflare.
// Login aqui é 100% scriptado (email/senha), sem precisar de aba/humano —
// confirmado que o painel aceita login via POST puro, sem desafio de JS.
import { fetch as undiciFetch, ProxyAgent } from "undici";

const PROXY_URL = String(process.env.GERENCIAAPP_PROXY_URL || "").trim();
const dispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;

function pfetch(url, opts = {}) {
  return undiciFetch(url, { ...opts, ...(dispatcher ? { dispatcher } : {}) });
}

// Sessão em memória por conta (email+base_url) — evita logar de novo a cada chamada.
// Cookie do painel expira em 2h (visto no Max-Age=7200 do Set-Cookie real); guardamos por 100min.
const sessionCache = new Map(); // key -> { cookieHeader, xsrfToken, expiresAt }
const SESSION_TTL_MS = 100 * 60 * 1000;

function parseSetCookies(headers) {
  const out = {};
  const raw =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") || "").split(/,(?=[^ ])/).filter(Boolean);
  for (const line of raw) {
    const [nameVal] = line.split(";");
    const eq = nameVal.indexOf("=");
    if (eq === -1) continue;
    out[nameVal.slice(0, eq).trim()] = nameVal.slice(eq + 1).trim();
  }
  return out;
}

function cookieHeaderFrom(cookieMap) {
  return Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function clearAvisos(baseUrl, cookieHeader, xsrfToken) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    await pfetch(`${baseUrl}/save_session_aviso`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        "X-XSRF-TOKEN": xsrfToken,
        Cookie: cookieHeader,
      },
      signal: controller.signal,
    });
    clearTimeout(t);
  } catch {
    // best-effort, igual na extensão
  }
}

async function performLogin(baseUrl, email, password) {
  // 1. GET /login → cookies iniciais + XSRF-TOKEN
  const res1 = await pfetch(`${baseUrl}/login`);
  const cookies1 = parseSetCookies(res1.headers);
  const xsrf1 = decodeURIComponent(cookies1["XSRF-TOKEN"] || "");
  if (!xsrf1) throw new Error("Não recebi XSRF-TOKEN do painel (GET /login).");

  // 2. POST /login (sem seguir redirect, pra conseguir ler o Set-Cookie da sessão autenticada)
  const res2 = await pfetch(`${baseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-XSRF-TOKEN": xsrf1,
      Cookie: cookieHeaderFrom(cookies1),
      Referer: `${baseUrl}/login`,
    },
    body: JSON.stringify({ email, password, remember: false }),
  });

  if (res2.status !== 302 && res2.status !== 200) {
    throw new Error(`Falha no login do GerenciaApp (HTTP ${res2.status}). Verifique usuário/senha.`);
  }

  const cookies2 = parseSetCookies(res2.headers);
  const merged = { ...cookies1, ...cookies2 };
  const xsrfToken = decodeURIComponent(merged["XSRF-TOKEN"] || xsrf1);
  const cookieHeader = cookieHeaderFrom(merged);

  return { cookieHeader, xsrfToken, expiresAt: Date.now() + SESSION_TTL_MS };
}

async function getSession(baseUrl, email, password) {
  const key = `${baseUrl}::${email}`;
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const session = await performLogin(baseUrl, email, password);
  sessionCache.set(key, session);

  await new Promise((r) => setTimeout(r, 1000));
  await clearAvisos(baseUrl, session.cookieHeader, session.xsrfToken);
  await new Promise((r) => setTimeout(r, 1500));

  return session;
}

function invalidateSession(baseUrl, email) {
  sessionCache.delete(`${baseUrl}::${email}`);
}

// ============================================================
// CREATE
// ============================================================
export async function createGerenciaApp({ baseUrl, email, password, payload }) {
  const BASE_URL = baseUrl.replace(/\/$/, "");
  let session = await getSession(BASE_URL, email, password);

  const doCreate = (s) =>
    pfetch(`${BASE_URL}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/html, application/xhtml+xml, application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Inertia": "true",
        "X-XSRF-TOKEN": s.xsrfToken,
        Cookie: s.cookieHeader,
      },
      body: JSON.stringify(payload),
    });

  let res = await doCreate(session);

  // Sessão caiu (cookie expirou fora do TTL previsto) → loga de novo uma vez
  if (res.url.includes("/login")) {
    invalidateSession(BASE_URL, email);
    session = await getSession(BASE_URL, email, password);
    res = await doCreate(session);
    if (res.url.includes("/login")) {
      throw new Error("Falha ao validar a sessão mesmo após novo login.");
    }
  }

  const text = await res.text();
  if (res.ok || res.status === 302 || res.redirected) {
    return { ok: true, message: "Sucesso!" };
  }

  let errMsg = `HTTP ${res.status}`;
  if (res.status === 500) {
    const m = text.match(/<title>(.*?)<\/title>/);
    errMsg = m?.[1] ? `Erro no GerenciaApp: ${m[1]}` : "Erro 500: O servidor do GerenciaApp travou.";
  } else {
    try {
      const json = JSON.parse(text);
      const errors = json?.props?.errors || json?.errors || {};
      const firstErr = Object.values(errors)[0];
      if (firstErr) errMsg = firstErr;
    } catch {
      errMsg = text.slice(0, 100);
    }
  }
  return { ok: false, error: errMsg };
}

// ============================================================
// DELETE / CHECK (compartilham a mesma busca de usuário no painel)
// ============================================================
function normalizeMac(mac) {
  return String(mac || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

async function searchUsersOnPanel(BASE_URL, session, term) {
  if (!term || !term.trim()) return [];
  const url = `${BASE_URL}/users?page=1&search=${encodeURIComponent(term)}`;
  try {
    const res = await pfetch(url, {
      headers: { Accept: "text/html", Cookie: session.cookieHeader },
    });
    if (!res.ok || res.url.includes("/login")) return [];
    const html = await res.text();
    const m = html.match(/data-page="([^"]+)"/);
    if (!m) return [];
    const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    const json = JSON.parse(decoded);
    if (json.props?.users?.data) return json.props.users.data;
    if (Array.isArray(json.props?.users)) return json.props.users;
    if (Array.isArray(json.data)) return json.data;
    return [];
  } catch {
    return [];
  }
}

// Acha o registro certo entre os resultados da busca — mesma lógica usada
// no delete: por nome exato, senão por nome+MAC, senão por MAC sozinho.
function pickUserRecord(byName, byMac, searchName, macDevice) {
  if (byName.length === 1) return byName[0];
  if (byName.length > 1 && macDevice) {
    const macNorm = normalizeMac(macDevice);
    const exact = byName.find((u) => normalizeMac(JSON.stringify(u)).includes(macNorm));
    if (exact) return exact;
  }
  if (byMac.length === 1) return byMac[0];
  if (byMac.length > 1) {
    const nameLower = String(searchName || "").toLowerCase();
    const exact = byMac.find((u) => JSON.stringify(u).toLowerCase().includes(nameLower));
    if (exact) return exact;
  }
  return null;
}

// ============================================================
// CHECK — só consulta o vencimento real (expire_account) no painel, sem
// criar/apagar nada. O painel já rastreia isso por usuário; antes a gente
// só chutava "1 ano a partir de hoje" no momento de configurar.
// ============================================================
export async function checkGerenciaApp({ baseUrl, email, password, searchName, macDevice }) {
  const BASE_URL = baseUrl.replace(/\/$/, "");
  const session = await getSession(BASE_URL, email, password);

  const byName = await searchUsersOnPanel(BASE_URL, session, searchName);
  const byMac = macDevice ? await searchUsersOnPanel(BASE_URL, session, macDevice) : [];
  const user = pickUserRecord(byName, byMac, searchName, macDevice);

  if (!user) {
    return {
      ok: false,
      error: `Usuário/MAC não encontrado no painel do GerenciaApp. (Buscado: ${searchName} / MAC: ${macDevice})`,
    };
  }

  return { ok: true, expireDate: user.expire_account || null };
}

export async function deleteGerenciaApp({ baseUrl, email, password, searchName, macDevice }) {
  const BASE_URL = baseUrl.replace(/\/$/, "");
  const session = await getSession(BASE_URL, email, password);

  async function searchUsers(term) {
    return searchUsersOnPanel(BASE_URL, session, term);
  }

  let userIdToDelete = null;

  const byName = await searchUsers(searchName);
  if (byName.length === 1) {
    userIdToDelete = byName[0].id;
  } else if (byName.length > 1 && macDevice) {
    const macNorm = normalizeMac(macDevice);
    const exact = byName.find((u) => normalizeMac(JSON.stringify(u)).includes(macNorm));
    if (exact) userIdToDelete = exact.id;
  }

  if (!userIdToDelete && macDevice) {
    const byMac = await searchUsers(macDevice);
    if (byMac.length === 1) {
      userIdToDelete = byMac[0].id;
    } else if (byMac.length > 1) {
      const nameLower = String(searchName || "").toLowerCase();
      const exact = byMac.find((u) => JSON.stringify(u).toLowerCase().includes(nameLower));
      if (exact) userIdToDelete = exact.id;
    }
  }

  if (!userIdToDelete) {
    return {
      ok: false,
      error: `Usuário/MAC não encontrado no painel do GerenciaApp. (Buscado: ${searchName} / MAC: ${macDevice})`,
    };
  }

  await new Promise((r) => setTimeout(r, 1000));

  const deleteRes = await pfetch(`${BASE_URL}/users/${userIdToDelete}`, {
    method: "DELETE",
    headers: {
      accept: "application/json, text/plain, */*",
      "x-requested-with": "XMLHttpRequest",
      "X-XSRF-TOKEN": session.xsrfToken,
      Cookie: session.cookieHeader,
    },
  });

  if (deleteRes.ok) return { ok: true };
  return { ok: false, error: `Falha ao apagar o registro ID ${userIdToDelete}.` };
}
