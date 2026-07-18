// src/gerenciaapp.js
// Replica em HTTP puro (sem browser/extensão) o fluxo de login + criar/remover
// usuário no painel GerenciaApp (Laravel + Inertia, auth via cookie XSRF).
// Mantém uma sessão em cache por api_url (o cookie de sessão do Laravel dura
// ~2h) para não logar de novo a cada chamada.

const SESSION_TTL_MS = 100 * 60 * 1000; // um pouco abaixo do Max-Age=7200 do painel
const sessions = new Map(); // api_url -> { jar, expiresAt }

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

async function login(apiUrl, email, password) {
  const res1 = await fetch(`${apiUrl}/login`, { redirect: "manual" });
  let jar = parseSetCookies(res1);

  const res2 = await fetch(`${apiUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/html, application/xhtml+xml, application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-XSRF-TOKEN": xsrfHeader(jar),
      Cookie: cookieHeader(jar),
    },
    body: JSON.stringify({ email, password, remember: true }),
  });
  jar = { ...jar, ...parseSetCookies(res2) };

  if (res2.status !== 302) {
    throw new Error(`Login no GerenciaApp falhou (status ${res2.status}). Verifique login_email/login_password.`);
  }
  return jar;
}

async function getSession(apiUrl, email, password) {
  const cached = sessions.get(apiUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.jar;

  const jar = await login(apiUrl, email, password);
  sessions.set(apiUrl, { jar, expiresAt: Date.now() + SESSION_TTL_MS });
  return jar;
}

function invalidateSession(apiUrl) {
  sessions.delete(apiUrl);
}

async function clearAvisos(apiUrl, jar) {
  try {
    await fetch(`${apiUrl}/save_session_aviso`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        "X-XSRF-TOKEN": xsrfHeader(jar),
        Cookie: cookieHeader(jar),
      },
    });
  } catch {
    // best-effort, igual ao clearGerenciaAppAvisos da extensão
  }
}

async function searchUsers(apiUrl, jar, term) {
  if (!term || !term.trim()) return [];
  const res = await fetch(`${apiUrl}/users?page=1&search=${encodeURIComponent(term)}`, {
    headers: { Accept: "text/html", Cookie: cookieHeader(jar) },
  });
  if (!res.ok || res.url.includes("/login")) return { expired: !res.ok || res.url.includes("/login"), users: [] };

  const html = await res.text();
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

// ── CREATE ──────────────────────────────────────────────────────────────
export async function gerenciaAppCreate(apiUrl, email, password, payload) {
  let jar = await getSession(apiUrl, email, password);
  await clearAvisos(apiUrl, jar);

  const doCreate = async (jarToUse) => {
    const res = await fetch(`${apiUrl}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/html, application/xhtml+xml, application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Inertia": "true",
        "X-XSRF-TOKEN": xsrfHeader(jarToUse),
        Cookie: cookieHeader(jarToUse),
      },
      body: JSON.stringify(payload),
    });
    return res;
  };

  let res = await doCreate(jar);

  // Sessão pode ter expirado entre o cache e agora — reloga uma vez e tenta de novo.
  if (res.url.includes("/login")) {
    invalidateSession(apiUrl);
    jar = await getSession(apiUrl, email, password);
    await clearAvisos(apiUrl, jar);
    res = await doCreate(jar);
  }

  const ok = res.ok || res.status === 302 || res.redirected;
  if (!ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status} ao criar no GerenciaApp.`, detail: text.slice(0, 300) };
  }
  return { ok: true, message: "Aplicativo configurado com sucesso!" };
}

// ── DELETE ──────────────────────────────────────────────────────────────
export async function gerenciaAppDelete(apiUrl, email, password, { username, macValue }) {
  let jar = await getSession(apiUrl, email, password);
  await clearAvisos(apiUrl, jar);

  const searchName = username;
  if (!searchName || !searchName.trim()) {
    return { ok: false, error: "Nome do servidor (username) não informado." };
  }

  let userIdToDelete = null;

  // 1. Busca por finalServerName
  let { expired, users: byName } = await searchUsers(apiUrl, jar, searchName);
  if (expired) {
    invalidateSession(apiUrl);
    jar = await getSession(apiUrl, email, password);
    await clearAvisos(apiUrl, jar);
    ({ users: byName } = await searchUsers(apiUrl, jar, searchName));
  }

  if (byName.length === 1) {
    userIdToDelete = byName[0].id;
  } else if (byName.length > 1 && macValue) {
    const macNorm = normalizeMac(macValue);
    const exact = byName.find((u) => normalizeMac(JSON.stringify(u)).includes(macNorm));
    if (exact) userIdToDelete = exact.id;
  }

  // 2. Fallback: busca direto pelo MAC
  if (!userIdToDelete && macValue) {
    const { users: byMac } = await searchUsers(apiUrl, jar, macValue);
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

  const res = await fetch(`${apiUrl}/users/${userIdToDelete}`, {
    method: "DELETE",
    headers: {
      accept: "application/json, text/plain, */*",
      "x-requested-with": "XMLHttpRequest",
      "X-XSRF-TOKEN": xsrfHeader(jar),
      Cookie: cookieHeader(jar),
    },
  });

  if (!res.ok) {
    return { ok: false, error: `Falha ao apagar o registro ID ${userIdToDelete}.` };
  }
  return { ok: true, message: "Configuração apagada do painel." };
}
