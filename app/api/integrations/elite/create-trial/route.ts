import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CookieJar } from "tough-cookie";
import fetchCookie from "fetch-cookie";
import * as cheerio from "cheerio";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ----------------- helpers base -----------------
function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function normalizeBaseUrl(u: string) {
  const s = String(u || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) throw new Error("api_base_url inválida (precisa começar com http/https).");
  return s;
}

function getOrigin(u: string) {
  try {
    return new URL(u).origin;
  } catch {
    return u;
  }
}

function getBearer(req: Request) {
  const a = req.headers.get("authorization") || "";
  if (a.toLowerCase().startsWith("bearer ")) return a.slice(7).trim();
  return "";
}

function randDigits(n: number) {
  let out = "";
  for (let i = 0; i < n; i++) out += String(crypto.randomInt(0, 10));
  return out;
}

function normalizeBaseUsername(v: unknown) {
  const raw = String(v ?? "").trim();
  return raw.replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * Regra:
 * - Se base >= 12: base + 3 números
 * - Se base < 12: completa até 15
 */
function buildEliteUsername(baseInput: unknown) {
  const base = normalizeBaseUsername(baseInput);
  if (base.length >= 12) return base + randDigits(3);

  const targetLen = 15;
  const need = Math.max(0, targetLen - base.length);
  return base + randDigits(need);
}

async function readSafeBody(res: Response) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null as any, text };
  }
}

function pickFirst(obj: any, paths: string[]) {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const k of parts) {
      if (cur && typeof cur === "object" && k in cur) cur = cur[k];
      else {
        ok = false;
        break;
      }
    }
    if (ok && cur !== undefined && cur !== null) return cur;
  }
  return null;
}

function extractCsrfFromHtml(html: string) {
  const $ = cheerio.load(html);
  const formToken = $('input[name="_token"]').attr("value") || "";
  const metaToken = $('meta[name="csrf-token"]').attr("content") || "";
  const csrf = (metaToken || formToken).trim();
  return csrf || "";
}

async function fetchHtml(fc: any, url: string, referer?: string) {
  const r = await fc(url, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "Mozilla/5.0",
      ...(referer ? { referer } : {}),
    },
    redirect: "follow",
  });

  const text = await r.text();
  return { ok: r.ok, status: r.status, url: (r as any)?.url || url, text, headers: r.headers };
}

function looksLikeLogin(html: string) {
  const t = String(html || "").toLowerCase();
  return t.includes('name="password"') && t.includes('name="email"') && t.includes("/login");
}

function looksLikeCsrfExpired(html: string) {
  const t = String(html || "").toLowerCase();
  return t.includes("419") || t.includes("page expired") || t.includes("csrf") || t.includes("token mismatch");
}

async function getCookieValue(jar: CookieJar, url: string, name: string) {
  const cookies = await new Promise<any[]>((resolve, reject) => {
    jar.getCookies(url, (err, arr) => (err ? reject(err) : resolve(arr || [])));
  });
  const found = cookies.find((c) => String(c.key).toLowerCase() === name.toLowerCase());
  return found ? String(found.value || "") : "";
}

// ----------------- login ELITE -----------------
async function offoLogin(baseUrlRaw: string, username: string, password: string, tz = "America/Sao_Paulo") {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);

  const jar = new CookieJar();
  const fc = fetchCookie(fetch, jar);

  const loginUrl = `${baseUrl}/login`;

  // 1) GET /login (pegar CSRF)
  const r1 = await fc(loginUrl, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "Mozilla/5.0",
    },
    redirect: "follow",
  });

  const loginHtml = await r1.text();
  const csrfLogin = extractCsrfFromHtml(loginHtml);
  if (!csrfLogin) throw new Error("Não achei CSRF token no HTML de /login.");

  // 2) POST /login
  const body = new URLSearchParams();
  body.set("_token", csrfLogin);
  body.set("timezone", tz);
  body.set("email", username);
  body.set("password", password);

  const r2 = await fc(loginUrl, {
    method: "POST",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "content-type": "application/x-www-form-urlencoded",
      origin: getOrigin(baseUrl),
      referer: loginUrl,
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "Mozilla/5.0",
    },
    body: body.toString(),
    redirect: "follow",
  });

  const finalUrl = (r2 as any)?.url || "";
  const postHtml = await r2.text();

  if (String(finalUrl).includes("/login") || looksLikeLogin(postHtml)) {
    throw new Error("Login falhou (voltou para /login). Verifique usuário/senha.");
  }

  // 3) ✅ PRIME autenticado: pega CSRF do layout logado (muito comum ser diferente do login)
  const dashUrl = `${baseUrl}/dashboard`;
  const dash = await fetchHtml(fc, dashUrl, dashUrl);

  // se /dashboard redirecionou pra login, o login não “colou”
  if (String(dash.url).includes("/login") || looksLikeLogin(dash.text)) {
    throw new Error("Sessão não persistiu após login (dashboard voltou pra login).");
  }

  const csrfAuth = extractCsrfFromHtml(dash.text) || csrfLogin;

  return {
    fc,
    jar,
    baseUrl,
    tz,
    csrfLogin,
    csrfAuth,
    dashboardUrl: dash.url || dashUrl,
  };
}

async function eliteFetch(
  fc: any,
  jar: CookieJar,
  baseUrl: string,
  path: string,
  init: RequestInit,
  csrfMeta?: string,
  referer?: string
) {
  const base = baseUrl.replace(/\/+$/, "");
  const url = base + path;
  const origin = getOrigin(base);

  const headers = new Headers(init.headers || {});
  headers.set("accept", headers.get("accept") || "application/json, text/plain, */*");
  headers.set("x-requested-with", "XMLHttpRequest");
  headers.set("origin", origin);
  headers.set("referer", referer || `${base}/dashboard`);

  // ✅ CSRF padrão Laravel: meta token no X-CSRF-TOKEN
  if (csrfMeta) {
    headers.set("x-csrf-token", csrfMeta);      // compat
    headers.set("X-CSRF-TOKEN", csrfMeta);      // padrão
  }

  // ✅ X-XSRF-TOKEN deve ser o cookie XSRF-TOKEN (geralmente URL-encoded)
  const xsrfCookie = await getCookieValue(jar, base, "XSRF-TOKEN").catch(() => "");
  if (xsrfCookie) {
    const decoded = decodeURIComponent(xsrfCookie);
    headers.set("x-xsrf-token", decoded);       // compat
    headers.set("X-XSRF-TOKEN", decoded);       // padrão
  }

  const finalInit: RequestInit = { ...init, headers, redirect: "follow" };
  return fc(url, finalInit);
}

// ----------------- handler -----------------
export async function POST(req: Request) {
  try {
    const token = getBearer(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized (missing bearer)" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({} as any));
    const integration_id = String(body?.integration_id || "").trim();
    if (!integration_id) {
      return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });
    }

    // input base p/ gerar username
    const desiredBase = body?.desired_username ?? body?.username ?? body?.trialnotes ?? "";

    // supabase (service) + valida usuário via JWT do client
    const sb = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const { data: userRes, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized (invalid bearer)" }, { status: 401 });
    }

    // ✅ carrega integração do banco
    const { data: integ, error } = await sb
      .from("server_integrations")
      .select("id,tenant_id,provider,is_active,api_token,api_secret,api_base_url")
      .eq("id", integration_id)
      .single();

    if (error) throw error;
    if (!integ) throw new Error("Integração não encontrada.");
    if (String(integ.provider).toUpperCase() !== "ELITE") throw new Error("Integração não é ELITE.");
    if (!integ.is_active) throw new Error("Integração está inativa.");

    const loginUser = String(integ.api_token || "").trim();
    const loginPass = String(integ.api_secret || "").trim();
    const baseUrl = String(integ.api_base_url || "").trim();

    if (!baseUrl || !loginUser || !loginPass) {
      throw new Error("ELITE exige api_base_url + usuário (api_token) + senha (api_secret).");
    }

    // ✅ login + csrf autenticado + jar
    const { fc, jar, baseUrl: base, csrfAuth, dashboardUrl } = await offoLogin(baseUrl, loginUser, loginPass);

    // 2) gerar username final
    const finalUsername = buildEliteUsername(desiredBase);

    // 3) maketrial (URL-ENCODED)
    const createBody = new URLSearchParams();
    createBody.set("_token", csrfAuth);
    createBody.set("trialx", "1");
    createBody.set("trialnotes", finalUsername);

    const createRes = await eliteFetch(
      fc,
      jar,
      base,
      "/api/iptv/maketrial",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: createBody.toString(),
      },
      csrfAuth,
      dashboardUrl
    );

    const createParsed = await readSafeBody(createRes);
    const createFinalUrl = (createRes as any)?.url || "";

    if (!createRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: "maketrial",
          status: createRes.status,
          finalUrl: createFinalUrl,
          contentType: createRes.headers.get("content-type"),
          csrf_hint: looksLikeCsrfExpired(createParsed.text) ? "Parece 419/CSRF" : null,
          login_hint: String(createFinalUrl).includes("/login") || looksLikeLogin(createParsed.text) ? "Voltou pra login" : null,
          details_preview: String(createParsed.text || "").slice(0, 1200),
        },
        { status: 502 }
      );
    }

    const createdId =
      pickFirst(createParsed.json, ["id", "user_id", "data.id", "data.user_id", "user.id", "user_id.id"]) ?? null;

    if (!createdId) {
      return NextResponse.json({
        ok: true,
        provider: "ELITE",
        created: true,
        updated_username: false,
        username: finalUsername,
        note: "Trial criado, mas o endpoint não retornou user_id/id. Me mande o raw_create para eu habilitar fallback de busca/lista.",
        raw_create: createParsed.json ?? createParsed.text,
      });
    }

    // 4) details
    const detailsRes = await eliteFetch(
      fc,
      jar,
      base,
      `/api/iptv/${createdId}`,
      { method: "GET" },
      csrfAuth,
      dashboardUrl
    );

    const detailsParsed = await readSafeBody(detailsRes);
    const detailsFinalUrl = (detailsRes as any)?.url || "";

    if (!detailsRes.ok) {
      return NextResponse.json({
        ok: true,
        provider: "ELITE",
        created: true,
        updated_username: false,
        external_user_id: String(createdId),
        username: finalUsername,
        note: "Trial criado, mas falhou ao ler detalhes para aplicar update automático.",
        details_status: detailsRes.status,
        details_finalUrl: detailsFinalUrl,
        details_preview: String(detailsParsed.text || "").slice(0, 1200),
      });
    }

    const details = detailsParsed.json ?? {};
    const currentPassword =
      pickFirst(details, ["password", "data.password", "user.password", "data.user.password"]) ?? "";

    const bouquetsRaw =
      pickFirst(details, ["bouquet", "bouquets", "bouquet_ids", "data.bouquet", "data.bouquets", "data.bouquet_ids"]) ??
      [];

    const bouquets: Array<string> = Array.isArray(bouquetsRaw) ? bouquetsRaw.map((x) => String(x)) : [];

    // 5) update (URL-ENCODED)
    const updBody = new URLSearchParams();
    updBody.set("_token", csrfAuth);
    updBody.set("user_id", String(createdId));
    updBody.set("usernamex", finalUsername);
    updBody.set("passwordx", String(currentPassword));
    updBody.set("reseller_notes", finalUsername);
    for (const b of bouquets) updBody.append("bouquet[]", String(b));

    const updRes = await eliteFetch(
      fc,
      jar,
      base,
      `/api/iptv/update/${createdId}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: updBody.toString(),
      },
      csrfAuth,
      dashboardUrl
    );

    const updParsed = await readSafeBody(updRes);
    const updFinalUrl = (updRes as any)?.url || "";

    if (!updRes.ok) {
      return NextResponse.json({
        ok: true,
        provider: "ELITE",
        created: true,
        updated_username: false,
        external_user_id: String(createdId),
        username: finalUsername,
        password: String(currentPassword || ""),
        note: "Trial criado, mas falhou ao aplicar update automático do username.",
        update_status: updRes.status,
        update_finalUrl: updFinalUrl,
        update_preview: String(updParsed.text || "").slice(0, 1200),
      });
    }

    return NextResponse.json({
      ok: true,
      provider: "ELITE",
      created: true,
      updated_username: true,
      external_user_id: String(createdId),
      username: finalUsername,
      password: String(currentPassword || ""),
      raw_create: createParsed.json ?? null,
      raw_update: updParsed.json ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}