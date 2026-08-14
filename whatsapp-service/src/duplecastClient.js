// whatsapp-service/src/duplecastClient.js
//
// Duplecast (duplecast.com) — o Cloudflare bloqueia qualquer requisição sem
// motor de JavaScript ("Just a moment...", desafio automático). Testado ao
// vivo (14/08/2026): o FlareSolverr (container local, ver docker-compose.yml)
// resolve esse desafio numa única chamada e devolve um cookie cf_clearance
// que continua válido pras requisições SEGUINTES feitas DIRETO (sem passar
// pelo FlareSolverr de novo) — confirmado com login real + leitura de
// vencimento real, batendo com o valor salvo no banco. Só funciona reaproveitando
// o MESMO IP (por isso roda aqui na VM, nunca direto da Vercel) e o mesmo
// User-Agent devolvido pelo FlareSolverr.
//
// Fluxo por chamada: 1) FlareSolverr resolve o desafio na página de login
// (1 chamada, ~3-5s), 2) login por mac+device_key direto (fetch normal),
// 3) ação (create/check/delete) direto — mesma lógica/endpoints que já
// estavam provados na antiga rota server-side (app/api/integrations/apps/
// duplecast/route.ts), só que agora bootstrap dos cookies via FlareSolverr
// em vez de partir de uma sessão vazia (que o Cloudflare sempre barrava).

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || "http://flaresolverr:8191/v1";

function extractCsrfToken(html) {
  const m = html.match(/_csrf_token"\s+value="([^"]+)"/);
  return m ? m[1] : null;
}

async function solveChallengeOnce(url, maxTimeout) {
  const res = await fetch(FLARESOLVERR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url, maxTimeout }),
  });
  if (!res.ok) throw new Error(`FlareSolverr HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== "ok") throw new Error(`FlareSolverr: ${json.message || "falha desconhecida ao resolver o Cloudflare"}`);
  return {
    html: json.solution?.response || "",
    cookies: json.solution?.cookies || [],
    userAgent: json.solution?.userAgent || "",
  };
}

// ✅ Retry (14/08/2026): o tempo pra resolver o desafio do Cloudflare varia —
// normalmente 14-17s, mas achado ao vivo que ocasionalmente demora bem mais
// (ou nem resolve dentro do maxTimeout), fazendo o timeout de 55s do lado da
// Vercel estourar antes. 1ª tentativa com orçamento enxuto (20s — cobre o
// caso normal com folga); se falhar, 1 segunda tentativa com mais fôlego
// (25s). Total do pior caso (~46s) + resto do fluxo (login+ação, poucos
// segundos) ainda cabe dentro de maxDuration=60s da rota na Vercel.
async function solveChallenge(url) {
  try {
    return await solveChallengeOnce(url, 20000);
  } catch (firstErr) {
    console.error("[DUPLECAST] 1ª tentativa de resolver o Cloudflare falhou, tentando de novo:", firstErr?.message);
    try {
      return await solveChallengeOnce(url, 25000);
    } catch (secondErr) {
      throw new Error(`Cloudflare não resolveu após 2 tentativas: ${secondErr?.message}`);
    }
  }
}

class CookieJar {
  constructor(initial = []) {
    this.store = new Map(initial.map((c) => [c.name, c.value]));
  }
  absorb(headers) {
    const rawList =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : (headers.get("set-cookie") || "").split(/,(?=[^ ])/).filter(Boolean);
    for (const raw of rawList) {
      const [nameVal] = raw.split(";");
      const eqIdx = nameVal.indexOf("=");
      if (eqIdx === -1) continue;
      const name = nameVal.slice(0, eqIdx).trim();
      const value = nameVal.slice(eqIdx + 1).trim();
      if (name) this.store.set(name, value);
    }
  }
  toString() {
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function baseHeaders(jar, userAgent, referer, isPost = false, origin = "") {
  return {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "pt,en;q=0.9,pt-BR;q=0.8",
    "user-agent": userAgent,
    referer,
    cookie: jar.toString(),
    ...(isPost ? { "content-type": "application/x-www-form-urlencoded", origin } : {}),
  };
}

async function deviceLogin(siteRoot, mac, deviceKey) {
  const loginUrl = `${siteRoot}/plugin/duplecast/device_login/`;
  const { html, cookies, userAgent } = await solveChallenge(loginUrl);
  const token = extractCsrfToken(html);
  if (!token) throw new Error("CSRF token não encontrado na página de login do dispositivo (o Cloudflare pode ter mudado o desafio).");

  const jar = new CookieJar(cookies);

  const params = new URLSearchParams();
  params.set("_csrf_token", token);
  params.set("mac", mac);
  params.set("device_key", deviceKey);

  const postRes = await fetch(loginUrl, {
    method: "POST",
    headers: baseHeaders(jar, userAgent, loginUrl, true, siteRoot),
    body: params.toString(),
    redirect: "manual",
  });
  jar.absorb(postRes.headers);

  if (postRes.status !== 302 || String(postRes.headers.get("location") || "").includes("device_login")) {
    throw new Error("Login por Device ID/Device Key falhou no Duplecast. Confira o Device Key cadastrado nesse app.");
  }

  return { jar, userAgent };
}

async function fetchDeviceMain(siteRoot, jar, userAgent) {
  const url = `${siteRoot}/plugin/duplecast/device_main/`;
  const res = await fetch(url, { headers: baseHeaders(jar, userAgent, url) });
  jar.absorb(res.headers);
  return res.text();
}

// "Expire on 19/09/2026" (dd/mm/yyyy) → "2026-09-19"
function parseExpireDate(html) {
  const m = html.match(/Expire on\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Dispositivo em trial (15 dias grátis) nunca tem "Expire on" preenchido —
// só "Status : trial" em vez de "Status : valid".
function parseIsTrial(html) {
  return /Status\s*:\s*trial/i.test(html);
}

function parsePlaylistRows(html) {
  const rowMatches = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  const out = [];
  for (const rowMatch of rowMatches) {
    const row = rowMatch[1];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").trim());
    if (cells.length < 3 || cells[0] !== "xtream") continue;
    const idMatch = row.match(/data-id="(\d+)"/);
    if (!idMatch) continue;
    out.push({ id: idMatch[1], name: cells[1], protected: !/UnProtected/i.test(cells[2]) });
  }
  return out;
}

async function createPlaylist(siteRoot, jar, userAgent, { m3uName, m3uUrl, pin }) {
  const addUrl = `${siteRoot}/plugin/duplecast/device_main/add/`;
  const getRes = await fetch(addUrl, {
    headers: baseHeaders(jar, userAgent, `${siteRoot}/plugin/duplecast/device_main/`),
  });
  jar.absorb(getRes.headers);
  const html = await getRes.text();
  const token = extractCsrfToken(html);
  if (!token) throw new Error("CSRF token não encontrado no formulário de criação.");

  const params = new URLSearchParams();
  params.set("_csrf_token", token);
  params.set("form_action", "generate_m3u_playlist");
  params.set("m3u_name", m3uName || "Playlist");
  params.set("m3u_playlist", m3uUrl);
  params.set("epg_url", "");
  params.set("note", "");
  if (pin) {
    params.set("locked", "1");
    params.set("pin", pin);
    params.set("confirm_pin", pin);
  }

  const postRes = await fetch(addUrl, {
    method: "POST",
    headers: baseHeaders(jar, userAgent, addUrl, true, siteRoot),
    body: params.toString(),
    redirect: "manual",
  });
  jar.absorb(postRes.headers);

  const ok = postRes.status === 302 || postRes.status === 200;
  if (!ok) throw new Error(`Falha ao criar playlist no Duplecast (HTTP ${postRes.status}).`);
}

async function playlistExists(siteRoot, jar, userAgent, id) {
  const html = await fetchDeviceMain(siteRoot, jar, userAgent);
  return parsePlaylistRows(html).some((r) => r.id === id);
}

// Playlist "Protected" exige PIN certo pra apagar de verdade — sem ele o
// Duplecast ainda responde 302 (redireciona pra device_main/), só que SEM
// apagar nada. Nunca confia no status HTTP: sempre reconsulta a lista depois
// pra confirmar que a playlist sumiu de verdade.
async function deletePlaylistByName(siteRoot, jar, userAgent, searchName, pin) {
  const mainHtml = await fetchDeviceMain(siteRoot, jar, userAgent);
  let token = extractCsrfToken(mainHtml);
  if (!token) throw new Error("CSRF token não encontrado na página do dispositivo.");

  const rows = parsePlaylistRows(mainHtml);
  const targetLower = searchName.toLowerCase();
  const target =
    rows.find((r) => r.name.toLowerCase() === targetLower) ||
    rows.find((r) => r.name.toLowerCase().includes(targetLower) || targetLower.includes(r.name.toLowerCase())) ||
    (rows.length === 1 ? rows[0] : null);

  if (!target) {
    const err = new Error(`Nenhuma playlist encontrada com o nome '${searchName}' nesse dispositivo (${rows.length} playlist(s) no total).`);
    err.notFound = true;
    throw err;
  }

  const delUrl = `${siteRoot}/plugin/duplecast/device_main/delete/${target.id}/`;
  const attempt = async (withPin) => {
    const params = new URLSearchParams();
    params.set("_csrf_token", token);
    params.set("0", "");
    if (withPin) params.set("pin", withPin);
    params.set("submit", "Yes");
    await fetch(delUrl, {
      method: "POST",
      headers: baseHeaders(jar, userAgent, `${siteRoot}/plugin/duplecast/device_main/`, true, siteRoot),
      body: params.toString(),
      redirect: "manual",
    });
  };

  await attempt(target.protected && pin ? pin : "");
  let stillThere = await playlistExists(siteRoot, jar, userAgent, target.id);

  // Retry sem PIN — mesma exceção rara já vista antes (playlist marcada
  // protegida com PIN diferente do cadastrado).
  if (stillThere && target.protected && pin) {
    await attempt("");
    stillThere = await playlistExists(siteRoot, jar, userAgent, target.id);
  }

  if (stillThere) {
    throw new Error(
      target.protected
        ? "Não foi possível apagar — playlist protegida por PIN incorreto."
        : "Não foi possível apagar a playlist.",
    );
  }
}

// Ponto de entrada único, chamado pela rota /duplecast/action.
export async function runDuplecastAction({ action, baseUrl, macValue, deviceKey, m3uName, m3uUrl, pin, searchName }) {
  if (!baseUrl) throw new Error("baseUrl é obrigatório.");
  if (!macValue || !deviceKey) throw new Error("macValue e deviceKey são obrigatórios.");

  const siteRoot = String(baseUrl).replace(/\/$/, "");
  const { jar, userAgent } = await deviceLogin(siteRoot, macValue, deviceKey);

  if (action === "check") {
    const html = await fetchDeviceMain(siteRoot, jar, userAgent);
    const expireDate = parseExpireDate(html);
    const isTrial = !expireDate && parseIsTrial(html);
    return { expireDate, isTrial };
  }

  if (action === "create") {
    if (!m3uUrl) throw new Error("m3uUrl é obrigatório para create.");
    let cleanPin = String(pin || "").replace(/\D/g, "");
    if (cleanPin.length < 4) cleanPin = "";
    await createPlaylist(siteRoot, jar, userAgent, { m3uName, m3uUrl, pin: cleanPin });

    let expireDate = null;
    try {
      const mainHtml = await fetchDeviceMain(siteRoot, jar, userAgent);
      expireDate = parseExpireDate(mainHtml);
    } catch {
      // best-effort — não bloqueia o create
    }
    return { expireDate };
  }

  if (action === "delete") {
    if (!searchName) throw new Error("searchName é obrigatório para delete.");
    let cleanPin = String(pin || "").replace(/\D/g, "");
    if (cleanPin.length < 4) cleanPin = "";
    await deletePlaylistByName(siteRoot, jar, userAgent, searchName, cleanPin);
    return {};
  }

  throw new Error("action inválida. Use: create | delete | check");
}
