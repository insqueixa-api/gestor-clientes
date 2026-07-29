// app/api/integrations/apps/gerenciaapp/route.ts
//
// Modelo de dados do GerenciaApp: cada playlist é sua PRÓPRIA linha na
// tabela `users` do painel, todas compartilhando o campo `mac_device`.
//
//   - GET /users/{id}/edit devolve, em `props.playlists`, a lista COMPLETA
//     de todas as linhas-irmãs daquele MAC — não importa qual `id` das
//     irmãs você usa na URL, a resposta é sempre a família inteira (a
//     busca por `search=` só serve pra achar UM id de entrada pra essa
//     família; ela só devolve o registro mais recente, nunca todos — a
//     lista de verdade vem do /edit).
//   - POST /users/{id} (multipart, mesmos campos do form de edição, com um
//     `playlists[N][...]` por linha desejada) faz uma SINCRONIZAÇÃO: toda
//     linha-irmã cujo `id` NÃO está no array enviado é APAGADA; toda linha
//     cujo `id` está no array sobrevive. Na prática:
//       1. Reenviar o array completo + 1 item novo (sem `id`) cria uma
//          linha nova, mantém as existentes intactas (mesmos ids).
//       2. Reenviar o array completo menos 1 item apaga só aquela linha,
//          mantém as outras intactas.
//       3. ⚠️ Postar pro id de uma linha que você quer APAGAR, sem incluir
//          esse id no array, TAMBÉM apaga essa linha — mesmo sendo "o id da
//          URL". A regra de ouro: o array enviado tem que conter o id de
//          TODA linha que deve sobreviver, incluindo, se for o caso, o
//          próprio id pro qual você está postando.
//   - Mandar a FormData nativa direto pelo ProxyAgent do `undici` chega
//     VAZIA no servidor (422 "campo obrigatório" pra campo que foi
//     mandado). Contornado serializando a FormData num Buffer fixo (com
//     Content-Length) antes de mandar pelo proxy.
//
// Por isso essa rota faz, pra CREATE (adicionar sem apagar as outras) e
// DELETE (apagar só uma, preservando as outras):
//   1. Busca o MAC via GET /users?search=...&ajax_search=1 (JSON direto) —
//      só pra achar UM id qualquer daquele MAC.
//   2. GET /users/{id}/edit pra pegar a família completa de playlists.
//   3. Monta o array final (com ou sem a entrada alvo) e reenvia via POST
//      /users/{id-de-uma-linha-que-vai-sobreviver} — nunca posta pro id da
//      linha que está sendo removida.
// Se sobrar 0 playlists depois de remover (era a última do MAC), usa o
// DELETE /users/{id} clássico mesmo — não tem mais nada pra preservar.
//
// Se o MAC não tem NENHUMA linha ainda (create em MAC novo), usa o POST
// /users (store) clássico (X-Inertia-Version + array `playlists` no
// payload).
import { NextResponse } from "next/server";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";
import { extractDateOnly } from "@/lib/apps/panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

// Mesmo proxy residencial que a VM usava — precisa vir do ambiente da
// própria Vercel (GERENCIAAPP_PROXY_URL). Sem ele, cai pra chamada direta,
// que sofre bloqueio/challenge do Cloudflare a partir do IP da Vercel.
const PROXY_URL = String(process.env.GERENCIAAPP_PROXY_URL || "").trim();
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;

function pfetch(url: string, opts: Record<string, any> = {}) {
  return undiciFetch(url, { ...opts, ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {}) }) as unknown as Promise<Response>;
}

// Sessão em memória por conta — best-effort (só ajuda em invocações
// "quentes" na mesma instância serverless). Cookie do painel expira em 2h;
// guardamos por 100min.
const sessionCache = new Map<string, any>();
const SESSION_TTL_MS = 100 * 60 * 1000;

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

function cookieHeaderFrom(cookieMap: Record<string, string>): string {
  return Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function clearAvisos(baseUrl: string, cookieHeader: string, xsrfToken: string) {
  try {
    await pfetch(`${baseUrl}/save_session_aviso`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        "X-XSRF-TOKEN": xsrfToken,
        Cookie: cookieHeader,
        "User-Agent": UA,
      },
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // best-effort
  }
}

async function performLogin(baseUrl: string, email: string, password: string) {
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
  const xsrfToken = decodeURIComponent(merged["XSRF-TOKEN"] || xsrf1);
  return { cookieHeader: cookieHeaderFrom(merged), xsrfToken, expiresAt: Date.now() + SESSION_TTL_MS };
}

async function getSession(baseUrl: string, email: string, password: string) {
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

function invalidateSession(baseUrl: string, email: string) {
  sessionCache.delete(`${baseUrl}::${email}`);
}

// Sessão fica presa a um objeto mutável (cookieHeader/xsrfToken podem ser
// atualizados a cada resposta — o painel manda cookie novo em quase toda
// chamada).
function updateSession(session: any, res: Response) {
  const fresh = parseSetCookies(res.headers);
  if (Object.keys(fresh).length === 0) return;
  const existing: Record<string, string> = {};
  for (const part of String(session.cookieHeader || "").split("; ")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    existing[part.slice(0, eq)] = part.slice(eq + 1);
  }
  const merged: Record<string, string> = { ...existing, ...fresh };
  session.cookieHeader = cookieHeaderFrom(merged);
  if (fresh["XSRF-TOKEN"]) session.xsrfToken = decodeURIComponent(fresh["XSRF-TOKEN"]);
}

async function getInertiaVersion(baseUrl: string, session: any): Promise<string | null> {
  const res = await pfetch(`${baseUrl}/users`, {
    headers: { Accept: "text/html", Cookie: session.cookieHeader, "User-Agent": UA },
  });
  updateSession(session, res);
  const html = await res.text();
  const m = html.match(/data-page="([^"]+)"/);
  if (!m) return null;
  const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  try {
    return JSON.parse(decoded)?.version || null;
  } catch {
    return null;
  }
}

// Acha QUALQUER linha (id) pertencente a esse MAC. Não confiar na lista
// inteira que esse endpoint devolve — só mostra o registro mais recente,
// nunca todos. Serve só de ponto de entrada pro /edit, que aí sim devolve a
// família completa.
async function searchByMac(baseUrl: string, session: any, mac: string): Promise<any[]> {
  const url = `${baseUrl}/users?search=${encodeURIComponent(mac)}&search_id=&page=1&ajax_search=1`;
  const res = await pfetch(url, {
    headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", "X-XSRF-TOKEN": session.xsrfToken, Cookie: session.cookieHeader, "User-Agent": UA },
  });
  updateSession(session, res);
  if (!res.ok) return [];
  try {
    const json = await res.json();
    return json?.users || [];
  } catch {
    return [];
  }
}

async function getEditData(baseUrl: string, session: any, id: string | number): Promise<{ user: any; playlists: any[] }> {
  const res = await pfetch(`${baseUrl}/users/${id}/edit`, {
    headers: { Accept: "text/html", Cookie: session.cookieHeader, "User-Agent": UA },
  });
  updateSession(session, res);
  const html = await res.text();
  const m = html.match(/data-page="([^"]+)"/);
  if (!m) throw new Error(`Não consegui ler os dados de edição do GerenciaApp (id ${id}).`);
  const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const json = JSON.parse(decoded);
  return { user: json?.props?.user || {}, playlists: json?.props?.playlists || [] };
}

function findPlaylistByName(playlists: any[], name: string) {
  const targetLower = String(name || "").toLowerCase().trim();
  const exactMatches = playlists.filter((p) => String(p.server_name || "").toLowerCase().trim() === targetLower);
  if (exactMatches.length > 0) {
    // Duplicata por nome não deveria existir, mas se existir (resíduo de
    // uma falha anterior no meio de um delete-então-cria), prefere a mais
    // recente (maior id) — sem isso, ficava sempre mirando na entrada mais
    // antiga, nunca resolvendo a duplicata sozinho.
    return exactMatches.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
  }
  return (
    playlists.find(
      (p) =>
        String(p.server_name || "").toLowerCase().includes(targetLower) ||
        targetLower.includes(String(p.server_name || "").toLowerCase()),
    ) || null
  );
}

// A FormData nativa em stream direto pelo ProxyAgent do undici chega vazia
// no servidor (422 "campo obrigatório" pra campo que foi mandado). Serializa
// num Buffer fixo antes de mandar, com Content-Length explícito.
async function serializeFormData(fd: FormData): Promise<{ contentType: string; buffer: Buffer }> {
  const probe = new Request("http://x", { method: "POST", body: fd as any });
  const contentType = probe.headers.get("content-type") || "multipart/form-data";
  const buffer = Buffer.from(await probe.arrayBuffer());
  return { contentType, buffer };
}

// Sincroniza a família de playlists daquele MAC: toda linha cujo id NÃO
// está em `playlists` é apagada; toda linha cujo id está, sobrevive.
// `postToId` TEM que ser o id de uma linha que sobrevive (presente em
// `playlists`) — postar pro id de uma linha que está sendo removida também
// a apaga, mesmo sendo "o id da URL".
async function syncPlaylists(baseUrl: string, session: any, postToId: string | number, user: any, playlists: any[]) {
  const fd = new FormData();
  fd.append("mac_device", user.mac_device || "");
  fd.append("account_username", user.email || "");
  fd.append("account_password", "");
  fd.append("ranking_app_id", String(user.ranking_app_id ?? 10));
  fd.append("price", String(user.price ?? "0.00"));
  fd.append("plan_id", user.plan_id ?? "");
  fd.append("expire_date", user.expire_account || "");
  fd.append("is_trial", user.is_trial ? "1" : "0");
  playlists.forEach((p, i) => {
    fd.append(`playlists[${i}][local_id]`, String(i + 1));
    if (p.id) fd.append(`playlists[${i}][id]`, String(p.id));
    fd.append(`playlists[${i}][modo_selecao]`, String(p.modo_selecao ?? 1));
    fd.append(`playlists[${i}][server_name]`, p.server_name || "");
    fd.append(`playlists[${i}][xteam_username]`, p.xteam_username || "");
    fd.append(`playlists[${i}][xteam_password]`, p.xteam_password || "");
    fd.append(`playlists[${i}][dns]`, p.dns || "");
    fd.append(`playlists[${i}][m3u8_list]`, p.m3u8_list || "");
    fd.append(`playlists[${i}][url_epg]`, p.url_epg || "");
    fd.append(`playlists[${i}][username_login]`, p.username_login || "");
    fd.append(`playlists[${i}][password_login]`, p.password_login || "");
  });

  const { contentType, buffer } = await serializeFormData(fd);
  const res = await pfetch(`${baseUrl}/users/${postToId}`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": contentType,
      "Content-Length": String(buffer.length),
      "X-Requested-With": "XMLHttpRequest",
      "X-XSRF-TOKEN": session.xsrfToken,
      Cookie: session.cookieHeader,
      Referer: `${baseUrl}/users/${postToId}/edit`,
      "User-Agent": UA,
    },
    body: buffer,
  });
  updateSession(session, res);
  const text = await res.text();

  // Erro de validação vem como JSON {message, errors} com HTTP 422/302.
  if (!res.ok) {
    try {
      const json = JSON.parse(text);
      const errors = json?.errors || {};
      const firstErr = Object.values(errors)[0];
      if (firstErr) throw new Error(String(firstErr));
      if (json?.message) throw new Error(String(json.message));
    } catch (e: any) {
      if (e instanceof SyntaxError) throw new Error(`Falha ao sincronizar playlists (HTTP ${res.status}).`);
      throw e;
    }
  }
  return { status: res.status };
}

async function deleteWholeRecord(baseUrl: string, session: any, id: string | number) {
  const res = await pfetch(`${baseUrl}/users/${id}`, {
    method: "DELETE",
    headers: {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      "X-XSRF-TOKEN": session.xsrfToken,
      Cookie: session.cookieHeader,
      "User-Agent": UA,
    },
  });
  updateSession(session, res);
  if (!res.ok) throw new Error(`Falha ao apagar o registro ID ${id}.`);
}

// Create em MAC que ainda não tem NENHUMA linha — fluxo clássico "store"
// (X-Inertia-Version + array `playlists` no payload, além dos campos
// soltos).
async function createFreshRecord(baseUrl: string, session: any, payload: Record<string, any>) {
  const inertiaVersion = await getInertiaVersion(baseUrl, session);
  const enrichedPayload = {
    ...payload,
    playlists: [
      {
        modo_selecao: payload.modo_selecao ?? 1,
        name: payload.server_name,
        url: payload.m3u8_list,
        m3u8_list: payload.m3u8_list,
      },
    ],
  };

  const res = await pfetch(`${baseUrl}/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/html, application/xhtml+xml, application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-Inertia": "true",
      ...(inertiaVersion ? { "X-Inertia-Version": inertiaVersion } : {}),
      "X-XSRF-TOKEN": session.xsrfToken,
      Cookie: session.cookieHeader,
      "User-Agent": UA,
    },
    body: JSON.stringify(enrichedPayload),
  });
  updateSession(session, res);
  const text = await res.text();

  try {
    const json = JSON.parse(text);
    const errors = json?.props?.errors || {};
    const firstErr = Object.values(errors)[0];
    if (firstErr) throw new Error(String(firstErr));
  } catch (e: any) {
    if (!(e instanceof SyntaxError)) throw e;
  }
  return { status: res.status };
}

export async function POST(req: Request) {
  try {
    if (hasBadInternalHeader(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const internal = isInternalRequest(req);

    let supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdmin>;
    if (internal) {
      supabase = createAdmin(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
    } else {
      supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, base_url, macValue } = body;

    if (!action || (action !== "create" && action !== "delete" && action !== "check" && action !== "renew")) {
      return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete | check | renew" }, { status: 400 });
    }
    if (!base_url) {
      return NextResponse.json({ ok: false, error: "base_url é obrigatório." }, { status: 400 });
    }
    const mac = String(macValue || body.mac_device || "").trim();
    if (!mac) {
      return NextResponse.json({ ok: false, error: "macValue é obrigatório." }, { status: 400 });
    }

    const { data: integ, error: integErr } = await supabase
      .from("app_integrations")
      .select("login_email, login_password")
      .eq("app_name", "GERENCIAAPP")
      .eq("is_active", true)
      .maybeSingle();

    if (integErr || !integ?.login_email || !integ?.login_password) {
      return NextResponse.json(
        { ok: false, error: "Credenciais do GerenciaApp não configuradas (Configurações → Integrações)." },
        { status: 400 },
      );
    }

    const BASE_URL = String(base_url).replace(/\/$/, "");
    let session = await getSession(BASE_URL, integ.login_email, integ.login_password);

    if (action === "check") {
      const searchName = String(body.username || body.server_name || "").trim();
      const found = await searchByMac(BASE_URL, session, mac);
      if (!found.length) {
        return NextResponse.json({ ok: false, error: `MAC não encontrado no painel do GerenciaApp (${mac}).` }, { status: 404 });
      }
      const { playlists } = await getEditData(BASE_URL, session, found[0].id);
      const match = searchName ? findPlaylistByName(playlists, searchName) : playlists[0];
      if (!match) {
        return NextResponse.json({ ok: false, error: `Não achei a playlist "${searchName}" nesse MAC.` }, { status: 404 });
      }
      return NextResponse.json({ ok: true, expireDate: extractDateOnly(match.expire_account) });
    }

    // ✅ "renew" (pedido do Márcio, 28/07/2026): pra família GERENCIAAPP,
    // "renovar" NÃO precisa apagar e recriar playlist nenhuma — o
    // vencimento (`expire_date`) é um campo COMPARTILHADO por todo o MAC
    // (mesmo valor em todas as playlists-irmãs, confirmado ao vivo), então
    // só editar essa data já atualiza o vencimento de verdade, sem tocar em
    // MAC/playlist/M3U. Muito mais seguro que delete-então-create: elimina
    // o risco de duplicata/verificação por nome que o create tem (achado
    // em produção: um resíduo de duplicata de um teste anterior travava a
    // verificação do create, fazendo ele reportar falha mesmo quando a
    // playlist nova tinha sido criada com sucesso).
    if (action === "renew") {
      const existing = await searchByMac(BASE_URL, session, mac);
      if (!existing.length) {
        return NextResponse.json({ ok: false, error: `MAC não encontrado no painel do GerenciaApp (${mac}).` }, { status: 404 });
      }
      const { user, playlists } = await getEditData(BASE_URL, session, existing[0].id);

      // Estende a partir do vencimento atual se ainda não venceu (não perde
      // tempo já "pago"); a partir de hoje se já venceu. Mesmo padrão usado
      // no fulfillment de renovação paga (lib/client-portal/fulfillment.ts).
      const currentExpire = user.expire_account ? new Date(`${user.expire_account}T00:00:00`) : null;
      const now = new Date();
      const base = currentExpire && currentExpire.getTime() > now.getTime() ? currentExpire : now;
      const next = new Date(base);
      next.setFullYear(next.getFullYear() + 1);
      const newExpireDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;

      await syncPlaylists(BASE_URL, session, existing[0].id, { ...user, expire_account: newExpireDate }, playlists);

      let confirmed = false;
      for (let attempt = 1; attempt <= 3 && !confirmed; attempt++) {
        if (attempt > 1) await new Promise((r) => setTimeout(r, 1500));
        const after = await getEditData(BASE_URL, session, existing[0].id);
        if (after.user.expire_account === newExpireDate) confirmed = true;
      }
      if (!confirmed) {
        return NextResponse.json(
          { ok: false, error: "O painel respondeu, mas o vencimento não foi atualizado — confira manualmente no GerenciaApp." },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true, expireDate: extractDateOnly(newExpireDate), message: "Licença renovada com sucesso." });
    }

    if (action === "create") {
      if (!body.m3u8_list && !body.m3uUrl) {
        return NextResponse.json({ ok: false, error: "m3u8_list é obrigatório para create." }, { status: 400 });
      }
      const serverName = String(body.server_name || "").trim();
      if (!serverName) {
        return NextResponse.json({ ok: false, error: "server_name é obrigatório para create." }, { status: 400 });
      }

      let existing: any[];
      try {
        existing = await searchByMac(BASE_URL, session, mac);
      } catch {
        existing = [];
      }

      if (existing.length === 0) {
        // MAC novo — nenhuma linha ainda, usa o fluxo clássico de criação.
        let result;
        try {
          result = await createFreshRecord(BASE_URL, session, body);
        } catch (e: any) {
          if (String(e?.message || "").toLowerCase().includes("sessão") || String(e?.message || "").toLowerCase().includes("xsrf")) {
            invalidateSession(BASE_URL, integ.login_email);
            session = await getSession(BASE_URL, integ.login_email, integ.login_password);
            result = await createFreshRecord(BASE_URL, session, body);
          } else {
            throw e;
          }
        }

        let verified: any = null;
        for (let attempt = 1; attempt <= 3 && !verified; attempt++) {
          if (attempt > 1) await new Promise((r) => setTimeout(r, 1500));
          const after = await searchByMac(BASE_URL, session, mac);
          if (after.length) {
            const { playlists } = await getEditData(BASE_URL, session, after[0].id);
            verified = findPlaylistByName(playlists, serverName);
          }
        }
        if (!verified) {
          return NextResponse.json(
            { ok: false, error: `O painel respondeu (status ${result.status}) mas a playlist "${serverName}" não apareceu no MAC depois de criar — confira manualmente no GerenciaApp.` },
            { status: 502 },
          );
        }
        return NextResponse.json({ ok: true, expireDate: extractDateOnly(verified.expire_account), message: "Playlist configurada com sucesso." });
      }

      // MAC já tem linha(s) — acrescenta sem tocar nas existentes.
      const { user, playlists } = await getEditData(BASE_URL, session, existing[0].id);
      const newEntry = {
        server_name: serverName,
        m3u8_list: body.m3u8_list || body.m3uUrl || "",
        username_login: body.username_login || body.username || "",
        password_login: body.password_login || body.password || "",
        xteam_username: body.xteam_username || "",
        xteam_password: body.xteam_password || "",
        dns: body.dns || "",
        url_epg: body.url_epg || "",
        modo_selecao: body.modo_selecao ?? 1,
      };
      await syncPlaylists(BASE_URL, session, existing[0].id, user, [...playlists, newEntry]);

      let created: any = null;
      for (let attempt = 1; attempt <= 3 && !created; attempt++) {
        if (attempt > 1) await new Promise((r) => setTimeout(r, 1500));
        const after = await searchByMac(BASE_URL, session, mac);
        if (after.length) {
          const { playlists: afterPlaylists } = await getEditData(BASE_URL, session, after[0].id);
          const stillHasOriginals = playlists.every((orig) => afterPlaylists.some((p: any) => p.id === orig.id));
          const match = findPlaylistByName(afterPlaylists, serverName);
          if (stillHasOriginals && match && !playlists.some((orig) => orig.id === match.id)) {
            created = match;
          }
        }
      }

      if (!created) {
        return NextResponse.json(
          { ok: false, error: `A playlist "${serverName}" não apareceu (ou alguma existente sumiu) depois de tentar adicionar — confira manualmente no GerenciaApp antes de tentar de novo.` },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true, expireDate: extractDateOnly(created.expire_account), message: "Playlist configurada com sucesso." });
    }

    // action === "delete"
    const searchName = String(body.username || body.server_name || "").trim();
    if (!searchName) {
      return NextResponse.json({ ok: false, error: "Nome do servidor não informado." }, { status: 400 });
    }

    const existing = await searchByMac(BASE_URL, session, mac);
    if (!existing.length) {
      return NextResponse.json({ ok: false, error: `MAC não encontrado no painel do GerenciaApp (${mac}).` }, { status: 404 });
    }

    const { user, playlists } = await getEditData(BASE_URL, session, existing[0].id);
    const match = findPlaylistByName(playlists, searchName);
    if (!match) {
      return NextResponse.json(
        { ok: false, error: `Nenhuma playlist encontrada com o nome "${searchName}" nesse MAC (${playlists.length} no total).` },
        { status: 404 },
      );
    }

    const remaining = playlists.filter((p) => p.id !== match.id);
    if (remaining.length === 0) {
      // Era a última do MAC — nada mais pra preservar, apaga direto.
      await deleteWholeRecord(BASE_URL, session, match.id);
    } else {
      // Nunca postar pro id que está sendo removido — usa o id de uma
      // linha que vai sobreviver (ver comentário no topo do arquivo).
      await syncPlaylists(BASE_URL, session, remaining[0].id, user, remaining);
    }

    let stillThere = true;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 1500));
      const after = await searchByMac(BASE_URL, session, mac);
      if (!after.length) { stillThere = false; break; }
      const { playlists: afterPlaylists } = await getEditData(BASE_URL, session, after[0].id);
      const gone = !afterPlaylists.some((p: any) => p.id === match.id);
      const othersOk = remaining.every((orig) => afterPlaylists.some((p: any) => p.id === orig.id));
      if (gone && othersOk) { stillThere = false; break; }
    }

    if (stillThere) {
      return NextResponse.json(
        { ok: false, error: `O painel respondeu, mas a playlist "${searchName}" (id ${match.id}) ainda está lá, ou alguma outra do mesmo MAC sumiu — confira manualmente no GerenciaApp.` },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno." }, { status: 500 });
  }
}
