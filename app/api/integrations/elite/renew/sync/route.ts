import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CookieJar } from "tough-cookie";
import fetchCookie from "fetch-cookie";
import * as cheerio from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ_SP = "America/Sao_Paulo";

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

function getBearer(req: Request) {
  const a = req.headers.get("authorization") || "";
  if (a.toLowerCase().startsWith("bearer ")) return a.slice(7).trim();
  return "";
}

function getInternalSecret(req: Request) {
  return String(req.headers.get("x-internal-secret") || "").trim();
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

// ----------------- vencimento: parse + timezone -----------------
type TZParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function getPartsInTimeZone(d: Date, tz: string): TZParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(d);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value || "0");

  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function zonedLocalToUtcMs(local: { year: number; month: number; day: number; hour: number; minute: number; second?: number }, tz: string) {
  const desiredAsIfUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second ?? 0);
  let utcMs = desiredAsIfUtc;
  for (let i = 0; i < 3; i++) {
    const got = getPartsInTimeZone(new Date(utcMs), tz);
    const gotAsIfUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
    const diff = desiredAsIfUtc - gotAsIfUtc;
    utcMs += diff;
    if (Math.abs(diff) < 1000) break;
  }
  return utcMs;
}

function parseFormattedBrDateTimeToIso(spText: unknown, tz = TZ_SP) {
  const s = String(spText ?? "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;

  const utcMs = zonedLocalToUtcMs({ year, month, day, hour, minute, second }, tz);
  return new Date(utcMs).toISOString();
}

// ----------------- login ELITE -----------------
async function offoLogin(baseUrlRaw: string, username: string, password: string, tz = TZ_SP) {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  const jar = new CookieJar();
  const fc = fetchCookie(fetch, jar);
  const loginUrl = `${baseUrl}/login`;

  const r1 = await fc(loginUrl, {
    method: "GET",
    headers: {
      accept: "text/html",
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
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      origin: baseUrl,
      referer: loginUrl,
      "user-agent": "Mozilla/5.0",
    },
    body: body.toString(),
    redirect: "follow",
  });

  const finalUrl = (r2 as any)?.url || "";
  if (String(finalUrl).includes("/login")) {
    throw new Error("Login falhou (voltou para /login).");
  }

  return { fc, baseUrl, tz };
}

async function fetchCsrfFromDashboard(fc: any, baseUrl: string, dashboardPath: string) {
  const url = `${baseUrl}${dashboardPath}`;
  const r = await fc(url, {
    method: "GET",
    headers: { accept: "text/html", "user-agent": "Mozilla/5.0", referer: url },
    redirect: "follow",
  });

  const html = await r.text();
  const $ = cheerio.load(html);
  const metaToken = $('meta[name="csrf-token"]').attr("content") || "";
  const formToken = $('input[name="_token"]').attr("value") || "";
  const csrf = (metaToken || formToken).trim();

  if (!csrf) throw new Error(`Não consegui obter CSRF de ${dashboardPath}`);
  return csrf;
}

async function eliteFetch(fc: any, baseUrl: string, pathWithQuery: string, init: RequestInit, csrf: string, dashboardPath: string) {
  const url = baseUrl.replace(/\/+$/, "") + pathWithQuery;
  const refererUrl = `${baseUrl}${dashboardPath}`;
  const headers = new Headers(init.headers || {});
  headers.set("accept", headers.get("accept") || "application/json");
  headers.set("x-requested-with", "XMLHttpRequest");
  headers.set("referer", refererUrl);
  headers.set("user-agent", "Mozilla/5.0");
  if (csrf) headers.set("x-csrf-token", csrf);

  return fc(url, { ...init, headers, redirect: "follow" });
}

function buildDtQuery(searchValue: string, isP2P: boolean) {
  const p = new URLSearchParams();
  p.set("draw", "1");
  p.set("start", "0");
  p.set("length", "15");
  p.set("search[value]", searchValue);
  p.set("search[regex]", "false");
  p.set("order[0][column]", "1");
  p.set("order[0][dir]", "desc");
  p.set("order[0][name]", "");

  // ✅ MAPA EXATO EXTRAÍDO DO SEU CURL (13 COLUNAS)
  const cols = isP2P
    ? [
        { data: "id", name: "", searchable: "false", orderable: "false" },
        { data: "id", name: "", searchable: "true", orderable: "true" },
        { data: "", name: "", searchable: "false", orderable: "false" },
        { data: "name", name: "", searchable: "true", orderable: "true" },
        { data: "email", name: "", searchable: "true", orderable: "true" },
        { data: "exField2", name: "", searchable: "true", orderable: "true" }, // Senha P2P
        { data: "formatted_created_at", name: "regTime", searchable: "false", orderable: "true" },
        { data: "formatted_exp_date", name: "endTime", searchable: "false", orderable: "true" }, // Vencimento P2P
        { data: "owner_username", name: "regUser.username", searchable: "true", orderable: "false" },
        { data: "exField4", name: "", searchable: "true", orderable: "true" },
        { data: "type", name: "", searchable: "true", orderable: "true" },
        { data: "status", name: "", searchable: "true", orderable: "true" },
        { data: "action", name: "", searchable: "false", orderable: "false" },
      ]
    : [
        { data: "", name: "", searchable: "false", orderable: "false" },
        { data: "id", name: "", searchable: "true", orderable: "true" },
        { data: "", name: "", searchable: "false", orderable: "false" },
        { data: "username", name: "", searchable: "true", orderable: "true" },
        { data: "password", name: "", searchable: "true", orderable: "true" }, // Senha IPTV
        { data: "formatted_created_at", name: "created_at", searchable: "false", orderable: "true" },
        { data: "formatted_exp_date", name: "exp_date", searchable: "false", orderable: "true" }, // Vencimento IPTV
        { data: "max_connections", name: "", searchable: "true", orderable: "true" },
        { data: "owner_username", name: "regUser.username", searchable: "true", orderable: "false" },
        { data: "reseller_notes", name: "", searchable: "true", orderable: "true" },
        { data: "is_trial", name: "", searchable: "true", orderable: "true" },
        { data: "enabled", name: "", searchable: "true", orderable: "true" },
        { data: "", name: "", searchable: "false", orderable: "false" },
      ];

  cols.forEach((c, i) => {
    p.set(`columns[${i}][data]`, c.data);
    p.set(`columns[${i}][name]`, c.name);
    p.set(`columns[${i}][searchable]`, c.searchable);
    p.set(`columns[${i}][orderable]`, c.orderable);
    p.set(`columns[${i}][search][value]`, "");
    p.set(`columns[${i}][search][regex]`, "false");
  });

  return p.toString();
}

async function findRowBySearch(fc: any, baseUrl: string, csrf: string, searchValue: string, dashboardPath: string, isP2P: boolean) {
  const qs = buildDtQuery(searchValue, isP2P);
  const r = await eliteFetch(
    fc, baseUrl, `${dashboardPath}?${qs}`, { method: "GET" }, csrf, dashboardPath
  );
  const parsed = await readSafeBody(r);
  if (!r.ok) return { ok: false, rows: [] };
  const data = parsed.json?.data;
  return { ok: true, rows: Array.isArray(data) ? data : [] };
}

// ----------------- handler -----------------
export async function POST(req: Request) {
  const trace: any[] = [];

  try {
    const internalSecret = getInternalSecret(req);
    const expectedSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
    const isInternal = !!expectedSecret && internalSecret === expectedSecret;

    const token = getBearer(req);
    if (!isInternal && !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    let external_user_id = String(body?.external_user_id || "").trim();
    let integration_id = String(body?.integration_id || "").trim();
    let tech = String(body?.technology || "").trim().toUpperCase();
    const targetUsername = String(body?.username || "").trim();

    if (!integration_id) return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });
    if (!external_user_id && !targetUsername) return NextResponse.json({ ok: false, error: "external_user_id ou username obrigatório." }, { status: 400 });

    const sb = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    // Validar se o utilizador está logado (se a chamada vier do Front-end)
    if (!isInternal) {
      const { data: userRes, error: userErr } = await sb.auth.getUser(token);
      if (userErr || !userRes?.user) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    // Pega o Tenant diretamente da requisição que você enviou (Front ou Webhook)
    const tenantId = String(body?.tenant_id || "").trim();

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "tenant_id obrigatório no body." }, { status: 400 });
    }

    // 1. Busca Integração
    const { data: integ, error: integError } = await sb
      .from("server_integrations")
      .select("provider,is_active,api_token,api_secret,api_base_url") 
      .eq("id", integration_id)
      .eq("tenant_id", tenantId)
      .single();

    if (integError || !integ) throw new Error("Integração não encontrada.");
    if (!(integ as any).is_active) throw new Error("Integração inativa.");

    const isP2P = tech === "P2P";
    const dashboardPath = isP2P ? "/dashboard/p2p" : "/dashboard/iptv";
    
    const loginUser = String(integ.api_token);
    const loginPass = String(integ.api_secret);
    const baseUrl = String(integ.api_base_url);

    // 2. Login
    const base = normalizeBaseUrl(baseUrl);
    const { fc } = await offoLogin(base, loginUser, loginPass, TZ_SP);
    const csrf = await fetchCsrfFromDashboard(fc, base, dashboardPath);

    let real_external_id = external_user_id;

    // Se o ID for texto puro (Nome), descobre o ID real primeiro
    if (isP2P && (!/^\d+$/.test(real_external_id) || real_external_id.length > 9)) {
       const fixTable = await findRowBySearch(fc, base, csrf, real_external_id, dashboardPath, isP2P);
       if (fixTable.ok && fixTable.rows?.length > 0) {
           real_external_id = String(fixTable.rows[0].id);
       }
    }

    // 3. Busca os Detalhes da Conta (Onde a data mora)
    const detailsApiPath = isP2P ? `/api/p2p/${real_external_id}` : `/api/iptv/${real_external_id}`;
    
    const detailsRes = await eliteFetch(fc, base, detailsApiPath, { method: "GET" }, csrf, dashboardPath);
    const detailsParsed = await readSafeBody(detailsRes);
    
    const details = detailsParsed.json ?? {};
    
    // 4. Captura Data e Senha (Caso P2P tenha mudado)
    let expSpText = pickFirst(details, ["formatted_exp_date", "data.formatted_exp_date", "user.formatted_exp_date"]);
    let currentPassword = pickFirst(details, ["password", "exField2", "data.password", "data.exField2", "user.password"]);
    
    // Fallback para a Tabela caso a API de details falhe
    if (!expSpText) {
       const searchTarget = isP2P ? real_external_id : targetUsername;
       const fallbackTable = await findRowBySearch(fc, base, csrf, searchTarget, dashboardPath, isP2P);
       if (fallbackTable.ok && fallbackTable.rows?.length > 0) {
          const row = fallbackTable.rows.find((r: any) => String(r?.id) === real_external_id) || fallbackTable.rows[0];
          expSpText = row?.formatted_exp_date;
          if (!currentPassword) currentPassword = row?.password || row?.exField2;
       }
    }

    // 5. Converte para ISO
    let finalExpIso = null;
    const rawExpDateNum = pickFirst(details, ["exp_date", "data.exp_date", "user.exp_date"]);
    
    if (typeof rawExpDateNum === "number" || (typeof rawExpDateNum === "string" && /^\d{10}$/.test(rawExpDateNum))) {
      finalExpIso = new Date(Number(rawExpDateNum) * 1000).toISOString();
    } else if (expSpText) {
      finalExpIso = parseFormattedBrDateTimeToIso(expSpText, TZ_SP);
    }

    if (!finalExpIso) throw new Error("Não foi possível resgatar a data de vencimento da Elite.");

    // Retorna os dados puros, sem fazer updates na tela!
    return NextResponse.json({
      ok: true,
      expires_at_iso: finalExpIso,
      exp_date: finalExpIso,
      password: currentPassword || undefined
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}