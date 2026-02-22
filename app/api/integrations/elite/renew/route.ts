import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CookieJar } from "tough-cookie";
import fetchCookie from "fetch-cookie";
import * as cheerio from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ_SP = "America/Sao_Paulo";

// ----------------- HELPERS BASE -----------------
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

function getBearer(req: Request) {
  const a = req.headers.get("authorization") || "";
  if (a.toLowerCase().startsWith("bearer ")) return a.slice(7).trim();
  return "";
}

function getInternalSecret(req: Request) {
  return String(req.headers.get("x-internal-secret") || "").trim();
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
}

async function readSafeBody(res: Response) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null as any, text };
  }
}

function looksLikeLoginHtml(text: string) {
  const t = String(text || "");
  return /\/login\b/i.test(t) && /csrf/i.test(t);
}

function redactPreview(s: string) {
  const t = String(s || "");
  return t.replace(/("password"\s*:\s*")[^"]*(")/gi, '$1***$2').slice(0, 250);
}

// ----------------- LOGIN E CONEXÃO ELITE -----------------
async function offoLogin(baseUrlRaw: string, username: string, password: string, tz = TZ_SP) {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  const jar = new CookieJar();
  const fc = fetchCookie(fetch, jar);
  const loginUrl = `${baseUrl}/login`;

  const r1 = await fc(loginUrl, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "Mozilla/5.0",
    },
  });

  const html = await r1.text();
  const $ = cheerio.load(html);
  const formToken = $('input[name="_token"]').attr("value") || "";
  const metaToken = $('meta[name="csrf-token"]').attr("content") || "";
  const csrfToken = (metaToken || formToken).trim();

  if (!csrfToken) throw new Error("Não achei CSRF token no HTML de /login.");

  const body = new URLSearchParams();
  body.set("_token", csrfToken);
  body.set("timezone", tz);
  body.set("email", username);
  body.set("password", password);

  const r2 = await fc(loginUrl, {
    method: "POST",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "content-type": "application/x-www-form-urlencoded",
      origin: baseUrl,
      referer: loginUrl,
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "Mozilla/5.0",
    },
    body: body.toString(),
    redirect: "follow",
  });

  const finalUrl = (r2 as any)?.url || "";
  if (String(finalUrl).includes("/login")) {
    throw new Error("Login falhou (voltou para /login). Verifique usuário/senha.");
  }

  return { fc, baseUrl, tz };
}

async function fetchCsrfFromDashboard(fc: any, baseUrl: string, dashboardPath: string) {
  const url = `${baseUrl}${dashboardPath}`;
  const r = await fc(url, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "Mozilla/5.0",
      referer: url,
    },
    redirect: "follow",
  });

  const html = await r.text();
  const $ = cheerio.load(html);
  const metaToken = $('meta[name="csrf-token"]').attr("content") || "";
  const formToken = $('input[name="_token"]').attr("value") || "";
  const csrf = (metaToken || formToken).trim();

  if (!csrf) {
    throw new Error(`Não consegui obter CSRF de ${dashboardPath} após login.`);
  }
  return csrf;
}

async function eliteFetch(fc: any, baseUrl: string, pathWithQuery: string, init: RequestInit, csrf?: string, refererPath = "/dashboard/iptv") {
  const url = baseUrl.replace(/\/+$/, "") + pathWithQuery;
  const refererUrl = `${baseUrl}${refererPath}`;

  const headers = new Headers(init.headers || {});
  headers.set("accept", headers.get("accept") || "application/json, text/plain, */*");
  headers.set("x-requested-with", "XMLHttpRequest");
  headers.set("origin", baseUrl);
  headers.set("referer", headers.get("referer") || refererUrl);
  headers.set("user-agent", headers.get("user-agent") || "Mozilla/5.0");
  headers.set("cache-control", headers.get("cache-control") || "no-cache");
  headers.set("pragma", headers.get("pragma") || "no-cache");

  if (csrf) {
    headers.set("x-csrf-token", csrf);
  }

  const finalInit: RequestInit = { ...init, headers, redirect: "follow" };
  return fc(url, finalInit);
}

// ----------------- HANDLER PRINCIPAL -----------------
export async function POST(req: Request) {
  const trace: any[] = [];

  try {
    const internalSecret = getInternalSecret(req);
    const expectedSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
    const isInternal = !!expectedSecret && internalSecret === expectedSecret;

    const token = getBearer(req);
    if (!isInternal && !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized (missing bearer)" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({} as any));
    const integration_id = String(body?.integration_id || "").trim();
    const external_user_id = String(body?.external_user_id || "").trim();
    const months = String(body?.months || "1").trim(); // Padrão é 1 mês
    
    // Suporta IPTV e P2P
    const reqTech = String(body?.technology || "IPTV").trim().toUpperCase();

    if (!integration_id || !external_user_id) {
      return NextResponse.json({ ok: false, error: "integration_id e external_user_id são obrigatórios." }, { status: 400 });
    }

    const tenantIdFromBody = String(body?.tenant_id || "").trim();

    // supabase (service)
    const sb = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    let tenantIdFromToken = "";
    if (!isInternal) {
      const { data: userRes, error: userErr } = await sb.auth.getUser(token);
      if (userErr || !userRes?.user) {
        return NextResponse.json({ ok: false, error: "Unauthorized (invalid bearer)" }, { status: 401 });
      }

      const um: any = (userRes.user.user_metadata as any) || {};
      const am: any = (userRes.user.app_metadata as any) || {};
      tenantIdFromToken = String(um?.tenant_id || am?.tenant_id || "").trim();

      if (tenantIdFromToken && tenantIdFromBody && tenantIdFromToken !== tenantIdFromBody) {
        return NextResponse.json({ ok: false, error: "tenant_id inválido." }, { status: 403 });
      }
    }

    const tenantId = tenantIdFromToken || tenantIdFromBody;

    // ✅ Carrega a integração Elite
    const { data: integ, error } = await sb
      .from("server_integrations")
      .select("id,tenant_id,provider,is_active,api_token,api_secret,api_base_url")
      .eq("id", integration_id)
      .eq("tenant_id", tenantId)
      .single();

    if (error || !integ) throw new Error("Integração não encontrada.");
    if (String(integ.provider).toUpperCase() !== "ELITE") throw new Error("Integração não é ELITE.");
    if (!integ.is_active) throw new Error("Integração inativa.");

    const loginUser = String(integ.api_token || "").trim();
    const loginPass = String(integ.api_secret || "").trim();
    const baseUrl = String(integ.api_base_url || "").trim();
    const base = normalizeBaseUrl(baseUrl);

    // 1) Login
    const { fc } = await offoLogin(base, loginUser, loginPass, TZ_SP);
    trace.push({ step: "login", ok: true });

    // 2) Pegar CSRF
    const isP2P = reqTech === "P2P";
    const dashboardPath = isP2P ? "/dashboard/p2p" : "/dashboard/iptv";
    const csrf = await fetchCsrfFromDashboard(fc, base, dashboardPath);
    trace.push({ step: "csrf_dashboard", ok: true });

    // 3) RENOVAÇÃO (Endpoint Dinâmico baseado na tecnologia)
    const renewApiPath = isP2P ? `/api/p2p/renewmulti/${external_user_id}` : `/api/iptv/renewmulti/${external_user_id}`;
    
    // ✅ Formato exato do CURL: JSON payload
    const payload = JSON.stringify({
      user_id: external_user_id,
      months: months
    });

    const renewRes = await eliteFetch(
      fc,
      base,
      renewApiPath,
      {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "timezone": TZ_SP
        },
        body: payload,
      },
      csrf,
      dashboardPath
    );

    const parsed = await readSafeBody(renewRes);
    trace.push({ step: "renew_request", status: renewRes.status, preview: redactPreview(parsed.text) });

    if (!renewRes.ok || parsed.json?.error) {
      const hint = looksLikeLoginHtml(parsed.text) ? " (Sessão inválida/Redirect)" : "";
      throw new Error(`Falha na renovação${hint}. Status: ${renewRes.status}. Detalhes: ${parsed.text.slice(0, 300)}`);
    }

    return NextResponse.json({
      ok: true,
      provider: "ELITE",
      action: "renew",
      external_user_id,
      months,
      trace
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error", trace },
      { status: 500 }
    );
  }
}