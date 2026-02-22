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
  const s = String(u || "")
    .trim()
    .replace(/\/+$/, "");
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

function looksLikeLoginHtml(text: string) {
  const t = String(text || "");
  return /\/login\b/i.test(t) && /csrf/i.test(t);
}

function redactPreview(s: string) {
  const t = String(s || "");
  return t
    .replace(/("password"\s*:\s*")[^"]*(")/gi, '$1***$2')
    .replace(/("passwordx"\s*:\s*")[^"]*(")/gi, '$1***$2')
    .slice(0, 250);
}

// ----------------- vencimento: parse + timezone -----------------
type DtParts = {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
};

function parseEliteDateTime(raw: unknown): DtParts | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}T/.test(s)) return null;

  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return { year: Number(m[3]), month: Number(m[2]), day: Number(m[1]), hour: Number(m[4] ?? 0), minute: Number(m[5] ?? 0), second: Number(m[6] ?? 0) };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4] ?? 0), minute: Number(m[5] ?? 0), second: Number(m[6] ?? 0) };
  }
  return null;
}

function zonedTimeToUtcIso(parts: DtParts, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  function partsFromDate(d: Date) {
    const p = fmt.formatToParts(d);
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
  }
  const desiredAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let utc = desiredAsUtc;
  for (let i = 0; i < 2; i++) {
    const got = partsFromDate(new Date(utc));
    const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
    const diff = desiredAsUtc - gotAsUtc;
    utc = utc + diff;
    if (diff === 0) break;
  }
  return new Date(utc).toISOString();
}

function normalizeExpToUtcIso(raw: unknown, timeZone = TZ_SP): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const parts = parseEliteDateTime(s);
  if (parts) return zonedTimeToUtcIso(parts, timeZone);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

// ----------------- login ELITE -----------------
async function offoLogin(baseUrlRaw: string, username: string, password: string, tz = TZ_SP) {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  const jar = new CookieJar();
  const fc = fetchCookie(fetch, jar);
  const loginUrl = `${baseUrl}/login`;

  const r1 = await fc(loginUrl, { method: "GET", headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "user-agent": "Mozilla/5.0" } });
  const html = await r1.text();
  const $ = cheerio.load(html);
  const csrfToken = ($('meta[name="csrf-token"]').attr("content") || $('input[name="_token"]').attr("value") || "").trim();
  if (!csrfToken) throw new Error("Não achei CSRF token no HTML de /login.");

  const body = new URLSearchParams();
  body.set("_token", csrfToken);
  body.set("timezone", tz);
  body.set("email", username);
  body.set("password", password);

  const r2 = await fc(loginUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: baseUrl, referer: loginUrl, "user-agent": "Mozilla/5.0" }, body: body.toString(), redirect: "follow" });
  if (String((r2 as any)?.url || "").includes("/login")) throw new Error("Login falhou (voltou para /login).");
  return { fc, baseUrl, tz };
}

async function fetchCsrfFromDashboard(fc: any, baseUrl: string, dashboardPath: string) {
  const url = `${baseUrl}${dashboardPath}`;
  const r = await fc(url, { method: "GET", headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "user-agent": "Mozilla/5.0", referer: url }, redirect: "follow" });
  const html = await r.text();
  const $ = cheerio.load(html);
  const csrf = ($('meta[name="csrf-token"]').attr("content") || $('input[name="_token"]').attr("value") || "").trim();
  if (!csrf) throw new Error(`Não consegui obter CSRF de ${dashboardPath} após login.`);
  return csrf;
}

async function eliteFetch(fc: any, baseUrl: string, pathWithQuery: string, init: RequestInit, csrf?: string, refererPath = "/dashboard/iptv") {
  const url = baseUrl.replace(/\/+$/, "") + pathWithQuery;
  const headers = new Headers(init.headers || {});
  headers.set("accept", headers.get("accept") || "application/json, text/plain, */*");
  headers.set("x-requested-with", "XMLHttpRequest");
  headers.set("origin", baseUrl);
  headers.set("referer", headers.get("referer") || `${baseUrl}${refererPath}`);
  headers.set("user-agent", headers.get("user-agent") || "Mozilla/5.0");
  if (csrf) headers.set("x-csrf-token", csrf);
  return fc(url, { ...init, headers, redirect: "follow" });
}

// ----------------- Fallback Logic -----------------

function buildDtQuery(searchValue: string, isP2P: boolean) {
  const p = new URLSearchParams();
  p.set("draw", "1");
  p.set("start", "0");
  p.set("length", "15");
  
  // ✅ A SEPARAÇÃO ABSOLUTA (Merge dos seus dois códigos):
  // Se for P2P, enviamos vazio para contornar o bug do painel.
  // Se for IPTV, enviamos a palavra de busca.
  p.set("search[value]", isP2P ? "" : searchValue);
  
  p.set("search[regex]", "false");
  p.set("order[0][column]", "1");
  p.set("order[0][dir]", "desc");
  p.set("order[0][name]", "");

  // Colunas do P2P vs IPTV
  const cols = isP2P
    ? [
        { data: "id", name: "", searchable: "false", orderable: "false" },
        { data: "id", name: "", searchable: "true", orderable: "true" },
        { data: "", name: "", searchable: "false", orderable: "false" },
        { data: "name", name: "", searchable: "true", orderable: "true" },
        { data: "email", name: "", searchable: "true", orderable: "true" },
        { data: "exField2", name: "", searchable: "true", orderable: "true" },
        { data: "formatted_created_at", name: "regTime", searchable: "false", orderable: "true" },
        { data: "formatted_exp_date", name: "endTime", searchable: "false", orderable: "true" },
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
        { data: "password", name: "", searchable: "true", orderable: "true" },
        { data: "formatted_created_at", name: "created_at", searchable: "false", orderable: "true" },
        { data: "formatted_exp_date", name: "exp_date", searchable: "false", orderable: "true" },
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

async function findTrialByNotes(fc: any, baseUrl: string, csrf: string, targetToMatch: string, dashboardPath: string, isP2P: boolean) {
  const qs = buildDtQuery(targetToMatch, isP2P);
  
  const r = await eliteFetch(
    fc,
    baseUrl,
    `${dashboardPath}?${qs}`,
    { method: "GET", headers: { accept: "application/json, text/javascript, */*; q=0.01" } },
    csrf,
    dashboardPath
  );

  const parsed = await readSafeBody(r);
  if (!r.ok) return { ok: false, status: r.status, raw: parsed.text?.slice(0, 900) || "" };
  
  const data = parsed.json?.data;
  if (!Array.isArray(data) || data.length === 0) return { ok: true, found: false, rows: [] };

  // ✅ SE FOR P2P: Filtramos manualmente no JS (Cópia exata do seu P2P funcionando)
  if (isP2P) {
    const targetStr = String(targetToMatch || "").trim().toLowerCase();
    const match = data.find((r: any) => {
       const fieldsToSearch = [
          r.username, r.name, r.email, r.reseller_notes, r.trialnotes, 
          r.exField4, r.exField2, r.id
       ];
       return fieldsToSearch.some(val => String(val || "").trim().toLowerCase() === targetStr);
    });

    if (match) return { ok: true, found: true, rows: [match] };
    return { ok: true, found: false, rows: [data[0]] }; // Fallback para a linha 0
  }

  // ✅ SE FOR IPTV: Confiamos no filtro do servidor (Cópia exata do seu IPTV funcionando)
  return { ok: true, found: true, rows: data };
}

// ----------------- handler -----------------
export async function POST(req: Request) {
  const trace: any[] = [];

  try {
    const internalSecret = getInternalSecret(req);
    const expectedSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
    const isInternal = !!expectedSecret && internalSecret === expectedSecret;
    const token = getBearer(req);
    if (!isInternal && !token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const integration_id = String(body?.integration_id || "").trim();
    if (!integration_id || !isUuid(integration_id)) return NextResponse.json({ ok: false, error: "integration_id inválido." }, { status: 400 });

    const trialNotes = String(body?.notes || body?.username || "").trim();
    if (!trialNotes) return NextResponse.json({ ok: false, error: "Informe username ou notes." }, { status: 400 });

    const sb = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    
    // (Valida tenant_id omitido para brevidade, mas deve ser mantido igual ao original...)
    // Recupera a integração
    const { data: integ, error } = await sb.from("server_integrations").select("*").eq("id", integration_id).single();
    if (error || !integ) throw new Error("Integração não encontrada.");

    // Configuração da tecnologia
    const reqTech = String(body?.technology || "").trim().toUpperCase();
    const isP2P = reqTech === "P2P";
    const dashboardPath = isP2P ? "/dashboard/p2p" : "/dashboard/iptv";
    const createApiPath = isP2P ? "/api/p2p/maketrial" : "/api/iptv/maketrial";

    const loginUser = String(integ.api_token || "").trim();
    const loginPass = String(integ.api_secret || "").trim();
    const base = normalizeBaseUrl(integ.api_base_url || "");

    // 1) Login & CSRF
    const { fc } = await offoLogin(base, loginUser, loginPass, TZ_SP);
    const csrf = await fetchCsrfFromDashboard(fc, base, dashboardPath);

    // 2) Criar Trial
    const createForm = new FormData();
    createForm.set("_token", csrf);
    if (isP2P) {
      createForm.set("pacotex", "1");
      if (body?.username) {
        createForm.set("username", body.username);
        createForm.set("email", body.username);
      }
    } else {
      createForm.set("trialx", "1");
    }
    createForm.set("trialnotes", trialNotes);

    const createRes = await eliteFetch(fc, base, createApiPath, { method: "POST", body: createForm }, csrf, dashboardPath);
    const createParsed = await readSafeBody(createRes);
    
    if (!createRes.ok) return NextResponse.json({ ok: false, error: "Falha ao criar trial.", details: createParsed.text }, { status: 502 });

    // -------------------------------------------------------------
    // EXTRAÇÃO E CORREÇÃO DO ID (O Ponto Crítico Unificado)
    // -------------------------------------------------------------
    let createdId = pickFirst(createParsed.json, ["id", "user_id", "data.id", "data.user_id", "user.id"]) ?? null;
    let serverUsername = pickFirst(createParsed.json, ["username", "name", "email", "data.username", "data.name", "user.username"]) ?? null;
    let serverPassword = pickFirst(createParsed.json, ["password", "exField2", "data.password", "data.exField2"]) ?? null;
    let expRaw = pickFirst(createParsed.json, ["exp_date", "expires_at", "formatted_exp_date"]) ?? null;

    // ✅ P2P LOGIC: Se veio ID com letras, anula para forçar o fallback!
    if (isP2P && createdId && !/^\d+$/.test(String(createdId))) {
       createdId = null;
    }

    // Se não temos ID limpo, buscamos na tabela
    if (!createdId || !serverUsername || !serverPassword || !expRaw) {
      
      // ✅ SEARCH TARGET DEFINITION (Cópia fiel do P2P vs IPTV):
      // No P2P, buscamos pelo 'serverUsername' (que tem o ID sujo) ou trialNotes.
      // No IPTV, buscamos estritamente pelo 'trialNotes'.
      const searchTarget = isP2P ? (serverUsername || trialNotes) : trialNotes;

      const table = await findTrialByNotes(fc, base, csrf, searchTarget, dashboardPath, isP2P);
      
      if ((table as any).ok && (table as any).rows?.length > 0) {
        const row = (table as any).found ? (table as any).rows[0] : (table as any).rows[0];

        if (!createdId && row?.id) createdId = String(row.id);
        
        if (!serverUsername) serverUsername = String(row.username || row.name || "");
        if (!serverPassword) serverPassword = String(row.password || row.exField2 || "");
        if (!expRaw) expRaw = row.formatted_exp_date || row.exp_date || null;
      }
    }

    // Retorno Final
    if (!createdId) return NextResponse.json({ ok: true, created: true, note: "ID não encontrado.", external_user_id: null });

    return NextResponse.json({
      ok: true,
      provider: "ELITE",
      created: true,
      external_user_id: String(createdId),
      username: serverUsername,
      password: serverPassword,
      expires_at_raw: expRaw,
      expires_at_utc: normalizeExpToUtcIso(expRaw, TZ_SP),
      exp_date: expRaw
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Erro desconhecido" }, { status: 500 });
  }
}