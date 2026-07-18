// src/gerenciaapp.js
// Replica o fluxo de login + criar/remover usuário no painel GerenciaApp
// (Laravel + Inertia, auth via cookie XSRF), sem navegador/extensão.
//
// O painel fica atrás de Cloudflare, e o IP da VM (datacenter) leva Managed
// Challenge ("Just a moment...") — IP residencial (extensão) passa direto.
// Solução: usar o FlareSolverr (Chrome headless de verdade, container à
// parte) SÓ pra resolver o desafio inicial e extrair os cookies + User-Agent
// do Chrome real que ele usou. Como o FlareSolverr roda na mesma VM (mesmo
// IP de saída), essas credenciais servem pras chamadas seguintes via fetch
// puro — inclusive DELETE, que o FlareSolverr não suporta nativamente.
//
// Mantém a sessão (jar + user-agent) em cache por api_url e reloga sozinho
// se detectar sessão expirada ou desafio novo no meio do caminho.

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || "http://flaresolverr:8191/v1";
const SESSION_TTL_MS = 100 * 60 * 1000; // um pouco abaixo do Max-Age=7200 do painel
const sessions = new Map(); // api_url -> { jar, userAgent, expiresAt }

function parseSetCookies(res) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")]
        : [];
  const jar = {};
  for (const c of raw) {
    const first = c.split(";")[0];
    const idx = first.indexOf("=");
    if (idx === -1) continue;
    jar[first.slice(0, idx)] = first.slice(idx + 1);
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function xsrfHeader(jar) {
  return jar["XSRF-TOKEN"] ? decodeURIComponent(jar["XSRF-TOKEN"]) : "";
}

function isChallengeResponse(res, text) {
  if (res.headers.get("cf-mitigated")) return true;
  if (res.status === 403 && /just a moment|cf-turnstile|cf_chl_opt/i.test(text || "")) return true;
  return false;
}

// ── Resolve o desafio do Cloudflare via FlareSolverr e devolve cookies + UA ──
async function solveChallenge(apiUrl) {
  const res = await fetch(FLARESOLVERR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url: `${apiUrl}/login`, maxTimeout: 60000 }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.status !== "ok" || !data.solution) {
    throw new Error(`FlareSolverr falhou ao resolver o desafio: ${data.message || res.status}`);
  }
  const jar = {};
  for (const c of data.solution.cookies || []) jar[c.name] = c.value;
  return { jar, userAgent: data.solution.userAgent };
}

async function login(apiUrl, email, password) {
  const { jar: challengeJar, userAgent } = await solveChallenge(apiUrl);

  const res2 = await fetch(`${apiUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/html, application/xhtml+xml, application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-XSRF-TOKEN": xsrfHeader(challengeJar),
      Cookie: cookieHeader(challengeJar),
      "User-Agent": userAgent,
    },
    body: JSON.stringify({ email, password, remember: true }),
  });
  const jar = { ...challengeJar, ...parseSetCookies(res2) };

  if (res2.status !== 302) {
    const text = await res2.text().catch(() => "");
    if (isChallengeResponse(res2, text)) {
      throw new Error("Cloudflare desafiou de novo no POST de login (FlareSolverr não cobriu esse passo).");
    }
    throw new Error(`Login no GerenciaApp falhou (status ${res2.status}). Verifique login_email/login_password.`);
  }
  return { jar, userAgent };
}

async function getSession(apiUrl, email, password) {
  const cached = sessions.get(apiUrl);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const session = await login(apiUrl, email, password);
  const entry = { ...session, expiresAt: Date.now() + SESSION_TTL_MS };
  sessions.set(apiUrl, entry);
  return entry;
}

function invalidateSession(apiUrl) {
  sessions.delete(apiUrl);
}

async function clearAvisos(apiUrl, session) {
  try {
    await fetch(`${apiUrl}/save_session_aviso`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        "X-XSRF-TOKEN": xsrfHeader(session.jar),
        Cookie: cookieHeader(session.jar),
        "User-Agent": session.userAgent,
      },
    });
  } catch {
    // best-effort, igual ao clearGerenciaAppAvisos da extensão
  }
}

async function searchUsers(apiUrl, session, term) {
  if (!term || !term.trim()) return { expired: false, users: [] };
  const res = await fetch(`${apiUrl}/users?page=1&search=${encodeURIComponent(term)}`, {
    headers: { Accept: "text/html", Cookie: cookieHeader(session.jar), "User-Agent": session.userAgent },
  });
  const html = await res.text().catch(() => "");
  if (!res.ok || res.url.includes("/login") || isChallengeResponse(res, html)) {
    return { expired: true, users: [] };
  }

  const match = html.match(/data-page="([^"]+)"/);
  if (!match) return { expired: false, users: [] };

  const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const json = JSON.parse(decoded);
  let users = [];
  if (json.props?.users?.data) users = json.props.users.data;
  else if (Array.isArray(json.props?.users)) users = json.props.users;
  else if (json.data && Array.isArray(json.data)) users = json.data;
  return { expired: false, users };
}

function normalizeMac(mac) {
  return String(mac || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

async function withFreshSession(apiUrl, email, password, run) {
  let session = await getSession(apiUrl, email, password);
  let result = await run(session);
  if (result.expired) {
    invalidateSession(apiUrl);
    session = await getSession(apiUrl, email, password);
    result = await run(session);
  }
  return result;
}

// ── CREATE ──────────────────────────────────────────────────────────────
export async function gerenciaAppCreate(apiUrl, email, password, payload) {
  const doCreate = async (session) => {
    await clearAvisos(apiUrl, session);
    const res = await fetch(`${apiUrl}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/html, application/xhtml+xml, application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Inertia": "true",
        "X-XSRF-TOKEN": xsrfHeader(session.jar),
        Cookie: cookieHeader(session.jar),
        "User-Agent": session.userAgent,
      },
      body: JSON.stringify(payload),
    });
    const ok = res.ok || res.status === 302 || res.redirected;
    const expired = !ok && res.url.includes("/login");
    return { ok, expired, res };
  };

  const { ok, res } = await withFreshSession(apiUrl, email, password, doCreate);
  if (!ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status} ao criar no GerenciaApp.`, detail: text.slice(0, 300) };
  }
  return { ok: true, message: "Aplicativo configurado com sucesso!" };
}

// ── DELETE ──────────────────────────────────────────────────────────────
export async function gerenciaAppDelete(apiUrl, email, password, { username, macValue }) {
  const searchName = username;
  if (!searchName || !searchName.trim()) {
    return { ok: false, error: "Nome do servidor (username) não informado." };
  }

  const doSearch = async (session) => {
    await clearAvisos(apiUrl, session);
    const { expired, users } = await searchUsers(apiUrl, session, searchName);
    return { expired, ok: !expired, users };
  };

  const { users: byName, ok: searchOk } = await withFreshSession(apiUrl, email, password, doSearch);
  if (!searchOk) {
    return { ok: false, error: "Não foi possível consultar o painel do GerenciaApp (sessão indisponível)." };
  }

  let userIdToDelete = null;
  if (byName.length === 1) {
    userIdToDelete = byName[0].id;
  } else if (byName.length > 1 && macValue) {
    const macNorm = normalizeMac(macValue);
    const exact = byName.find((u) => normalizeMac(JSON.stringify(u)).includes(macNorm));
    if (exact) userIdToDelete = exact.id;
  }

  if (!userIdToDelete && macValue) {
    const session = await getSession(apiUrl, email, password);
    const { users: byMac } = await searchUsers(apiUrl, session, macValue);
    if (byMac.length === 1) {
      userIdToDelete = byMac[0].id;
    } else if (byMac.length > 1) {
      const nameLower = searchName.toLowerCase();
      const exact = byMac.find((u) => JSON.stringify(u).toLowerCase().includes(nameLower));
      if (exact) userIdToDelete = exact.id;
    }
  }

  if (!userIdToDelete) {
    return { ok: false, error: `Usuário/MAC não encontrado no painel do GerenciaApp. (Buscado: ${searchName} / MAC: ${macValue || ""})` };
  }

  const session = await getSession(apiUrl, email, password);
  const res = await fetch(`${apiUrl}/users/${userIdToDelete}`, {
    method: "DELETE",
    headers: {
      accept: "application/json, text/plain, */*",
      "x-requested-with": "XMLHttpRequest",
      "X-XSRF-TOKEN": xsrfHeader(session.jar),
      Cookie: cookieHeader(session.jar),
      "User-Agent": session.userAgent,
    },
  });

  if (!res.ok) {
    return { ok: false, error: `Falha ao apagar o registro ID ${userIdToDelete}.` };
  }
  return { ok: true, message: "Configuração apagada do painel." };
}
