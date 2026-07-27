// app/api/integrations/apps/gerenciaapp/route.ts
//
// Implementação direta (sem VM) do login/create/delete/check no GerenciaApp
// — migrado de whatsapp-service/src/gerenciaapp.js em 27/07/2026 depois de
// validar ao vivo (ciclo completo create→check→delete, numa conta real)
// que gerenciaapp.top responde normal a fetch direto do servidor, SEM
// precisar do proxy residencial que a VM usava. A suposição antiga de
// bloqueio de IP de datacenter não se confirmou nesse teste; oproxy fica
// mantido só na VM (whatsapp-service/.env) por precaução, sem uso aqui.
//
// Dois bugs reais corrigidos nessa migração (achados 27/07/2026, o Márcio
// configurou um cliente e o toast disse "sucesso" mas nada foi criado):
//   1. Toda chamada Inertia com X-Inertia:true precisa mandar
//      X-Inertia-Version batendo com a versão atual dos assets do painel —
//      sem isso, Laravel/Inertia devolve 409 com corpo VAZIO (sem detalhe
//      de erro), fácil de confundir com bloqueio/sucesso.
//   2. O formulário de criação mudou: agora exige um array `playlists`
//      (com `modo_selecao` DENTRO de cada item), não só os campos soltos
//      antigos na raiz do payload.
// Além disso, "parece sucesso" (200/302/303/redirected) não é confiável
// sozinho — Inertia devolve HTTP 200 com `props.errors` preenchido pra
// erro de validação. Por isso SEMPRE confirma buscando o registro recém-
// criado no painel antes de devolver ok:true pro create.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

// Sessão em memória por conta (email+base_url) — best-effort: em serverless
// só ajuda em invocações "quentes" na mesma instância; se não tiver cache,
// getSession loga de novo sem problema. Cookie do painel expira em 2h
// (Max-Age=7200 real); guardamos por 100min.
const sessionCache = new Map();
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
    await fetch(`${baseUrl}/save_session_aviso`, {
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
  const res1 = await fetch(`${baseUrl}/login`, { headers: { "User-Agent": UA } });
  const cookies1 = parseSetCookies(res1.headers);
  const xsrf1 = decodeURIComponent(cookies1["XSRF-TOKEN"] || "");
  if (!xsrf1) throw new Error("Não recebi XSRF-TOKEN do painel (GET /login).");

  const res2 = await fetch(`${baseUrl}/login`, {
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

async function getInertiaVersion(baseUrl: string, session: any): Promise<string | null> {
  const res = await fetch(`${baseUrl}/users`, {
    headers: { Accept: "text/html", Cookie: session.cookieHeader, "User-Agent": UA },
  });
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

function normalizeMac(mac: string): string {
  return String(mac || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

async function searchUsersOnPanel(baseUrl: string, session: any, term: string): Promise<any[]> {
  if (!term || !term.trim()) return [];
  const url = `${baseUrl}/users?page=1&search=${encodeURIComponent(term)}`;
  try {
    const res = await fetch(url, { headers: { Accept: "text/html", Cookie: session.cookieHeader, "User-Agent": UA } });
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

function pickUserRecord(byName: any[], byMac: any[], searchName: string, macDevice?: string) {
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

async function createGerenciaApp({
  baseUrl,
  email,
  password,
  payload,
}: {
  baseUrl: string;
  email: string;
  password: string;
  payload: Record<string, any>;
}) {
  const BASE_URL = baseUrl.replace(/\/$/, "");
  let session = await getSession(BASE_URL, email, password);
  const inertiaVersion = await getInertiaVersion(BASE_URL, session);

  // O painel exige o array `playlists` (com modo_selecao dentro de cada
  // item) além dos campos soltos antigos — mantemos os dois por segurança.
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

  const doCreate = (s: any) =>
    fetch(`${BASE_URL}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/html, application/xhtml+xml, application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Inertia": "true",
        ...(inertiaVersion ? { "X-Inertia-Version": inertiaVersion } : {}),
        "X-XSRF-TOKEN": s.xsrfToken,
        Cookie: s.cookieHeader,
        "User-Agent": UA,
      },
      body: JSON.stringify(enrichedPayload),
    });

  let res = await doCreate(session);

  if (res.url.includes("/login")) {
    invalidateSession(BASE_URL, email);
    session = await getSession(BASE_URL, email, password);
    res = await doCreate(session);
    if (res.url.includes("/login")) {
      throw new Error("Falha ao validar a sessão mesmo após novo login.");
    }
  }

  const text = await res.text();
  const looksOk = res.ok || res.status === 302 || res.status === 303 || res.redirected;

  // Inertia pode devolver HTTP 200 com `props.errors` preenchido — checa
  // ANTES de confiar no HTTP.
  if (looksOk) {
    try {
      const json = JSON.parse(text);
      const errors = json?.props?.errors || {};
      const firstErr = Object.values(errors)[0];
      if (firstErr) return { ok: false, error: String(firstErr) };
    } catch {
      // corpo não é JSON (302 puro sem body) — segue pra verificação por busca
    }
  }

  if (looksOk) {
    let verified: any = null;
    for (let attempt = 1; attempt <= 2 && !verified; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 1500));
      const found = await searchUsersOnPanel(BASE_URL, session, payload.server_name);
      const macNorm = normalizeMac(payload.mac_device);
      verified = found.find((u) => normalizeMac(JSON.stringify(u)).includes(macNorm)) || (found.length === 1 ? found[0] : null);
    }

    if (verified) return { ok: true, message: "Sucesso!" };

    return {
      ok: false,
      error: `O painel respondeu sem erro, mas o usuário "${payload.server_name}" não apareceu na busca depois de criar — confira manualmente no GerenciaApp (pode ser MAC duplicado ou outra validação que o painel não devolve como erro HTTP).`,
    };
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
      if (firstErr) errMsg = String(firstErr);
    } catch {
      errMsg = text.slice(0, 100);
    }
  }
  return { ok: false, error: errMsg };
}

async function checkGerenciaApp({
  baseUrl,
  email,
  password,
  searchName,
  macDevice,
}: {
  baseUrl: string;
  email: string;
  password: string;
  searchName: string;
  macDevice?: string;
}) {
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

async function deleteGerenciaApp({
  baseUrl,
  email,
  password,
  searchName,
  macDevice,
}: {
  baseUrl: string;
  email: string;
  password: string;
  searchName: string;
  macDevice?: string;
}) {
  const BASE_URL = baseUrl.replace(/\/$/, "");
  const session = await getSession(BASE_URL, email, password);

  let userIdToDelete: number | null = null;

  const byName = await searchUsersOnPanel(BASE_URL, session, searchName);
  if (byName.length === 1) {
    userIdToDelete = byName[0].id;
  } else if (byName.length > 1 && macDevice) {
    const macNorm = normalizeMac(macDevice);
    const exact = byName.find((u) => normalizeMac(JSON.stringify(u)).includes(macNorm));
    if (exact) userIdToDelete = exact.id;
  }

  if (!userIdToDelete && macDevice) {
    const byMac = await searchUsersOnPanel(BASE_URL, session, macDevice);
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

  const deleteRes = await fetch(`${BASE_URL}/users/${userIdToDelete}`, {
    method: "DELETE",
    headers: {
      accept: "application/json, text/plain, */*",
      "x-requested-with": "XMLHttpRequest",
      "X-XSRF-TOKEN": session.xsrfToken,
      Cookie: session.cookieHeader,
      "User-Agent": UA,
    },
  });

  if (deleteRes.ok) return { ok: true };
  return { ok: false, error: `Falha ao apagar o registro ID ${userIdToDelete}.` };
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
    const { action, base_url } = body;

    if (!action || (action !== "create" && action !== "delete" && action !== "check")) {
      return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete | check" }, { status: 400 });
    }
    if (!base_url) {
      return NextResponse.json({ ok: false, error: "base_url é obrigatório." }, { status: 400 });
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

    if (action === "create") {
      const result = await createGerenciaApp({
        baseUrl: base_url,
        email: integ.login_email,
        password: integ.login_password,
        payload: body,
      });
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    if (action === "check") {
      const result = await checkGerenciaApp({
        baseUrl: base_url,
        email: integ.login_email,
        password: integ.login_password,
        searchName: body.username,
        macDevice: body.macValue,
      });
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    const result = await deleteGerenciaApp({
      baseUrl: base_url,
      email: integ.login_email,
      password: integ.login_password,
      searchName: body.username,
      macDevice: body.macValue,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno." }, { status: 500 });
  }
}
