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

function looksLikeLoginHtml(text: string) {
  const t = String(text || "");
  return /\/login\b/i.test(t) && /csrf/i.test(t);
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
  });

  const html = await r1.text();
  const $ = cheerio.load(html);
  const formToken = $('input[name="_token"]').attr("value") || "";
  const metaToken = $('meta[name="csrf-token"]').attr("content") || "";
  const csrfToken = (metaToken || formToken).trim();

  if (!csrfToken) throw new Error("Não achei CSRF token no HTML de /login.");

  // 2) POST /login
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

/**
 * ✅ IMPORTANTÍSSIMO:
 * Depois do login, pegue o CSRF de /dashboard/iptv (é o que o browser usa).
 */
async function fetchCsrfFromDashboardIptv(fc: any, baseUrl: string) {
  const url = `${baseUrl}/dashboard/iptv`;
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
    throw new Error("Não consegui obter CSRF de /dashboard/iptv após login.");
  }
  return csrf;
}

async function eliteFetch(
  fc: any,
  baseUrl: string,
  pathWithQuery: string,
  init: RequestInit,
  csrf?: string
) {
  const url = baseUrl.replace(/\/+$/, "") + pathWithQuery;
  const refererIptv = `${baseUrl}/dashboard/iptv`;

  const headers = new Headers(init.headers || {});
  headers.set("accept", headers.get("accept") || "application/json, text/plain, */*");
  headers.set("x-requested-with", "XMLHttpRequest");
  headers.set("origin", baseUrl);
  headers.set("referer", headers.get("referer") || refererIptv);
  headers.set("user-agent", headers.get("user-agent") || "Mozilla/5.0");
  headers.set("cache-control", headers.get("cache-control") || "no-cache");
  headers.set("pragma", headers.get("pragma") || "no-cache");

  if (csrf) {
    // Browser usa x-csrf-token (igual seu curl)
    headers.set("x-csrf-token", csrf);
  }

  const finalInit: RequestInit = { ...init, headers, redirect: "follow" };
  return fc(url, finalInit);
}

/**
 * ✅ Fallback para descobrir o ID do trial:
 * usa o endpoint server-side do DataTables em /dashboard/iptv?...
 * e filtra por search[value]=trialnotes
 */
function buildDtQuery(searchValue: string) {
  const p = new URLSearchParams();

  p.set("draw", "1");
  p.set("start", "0");
  p.set("length", "15");
  p.set("search[value]", searchValue);
  p.set("search[regex]", "false");

  // order: id desc (coluna 1)
  p.set("order[0][column]", "1");
  p.set("order[0][dir]", "desc");
  p.set("order[0][name]", "");

  // colunas (baseado no teu curl — o backend costuma exigir isso)
  const cols = [
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

async function findTrialByNotes(fc: any, baseUrl: string, csrf: string, notes: string) {
  const qs = buildDtQuery(notes);
  const r = await eliteFetch(
    fc,
    baseUrl,
    `/dashboard/iptv?${qs}`,
    {
      method: "GET",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
      },
    },
    csrf
  );

  const parsed = await readSafeBody(r);
  if (!r.ok) {
    return { ok: false, status: r.status, raw: parsed.text?.slice(0, 900) || "" };
  }

  const data = parsed.json?.data;
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: true, found: false, rows: [] as any[] };
  }

  return { ok: true, found: true, rows: data };
}

// ----------------- handler -----------------
export async function POST(req: Request) {
  const trace: any[] = [];

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

    // obs: trialnotes (NOTAS) = o “apelido” pra você achar depois no painel
    const desiredNotes = String(body?.trialnotes || body?.desired_username || body?.username || "").trim();
    if (!desiredNotes) {
      return NextResponse.json({ ok: false, error: "Informe trialnotes (ou desired_username/username)." }, { status: 400 });
    }

    // username final:
    // - se o user mandou desired_username explícito, usa do jeito que vier
    // - senão, gera um username “padronizado”
    const finalUsername =
      String(body?.desired_username || "").trim() || buildEliteUsername(desiredNotes);

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

    // carrega integração do banco
    const { data: integ, error } = await sb
      .from("server_integrations")
      .select("id,tenant_id,provider,is_active,api_token,api_secret,api_base_url")
      .eq("id", integration_id)
      .single();

    if (error) throw error;
    if (!integ) throw new Error("Integração não encontrada.");
    if (String(integ.provider).toUpperCase() !== "ELITE") throw new Error("Integração não é ELITE.");
    if (!integ.is_active) throw new Error("Integração está inativa.");

    const loginUser = String(integ.api_token || "").trim();   // usuário/email
    const loginPass = String(integ.api_secret || "").trim();  // senha
    const baseUrl = String(integ.api_base_url || "").trim();

    if (!baseUrl || !loginUser || !loginPass) {
      throw new Error("ELITE exige api_base_url + usuário (api_token) + senha (api_secret).");
    }

    const base = normalizeBaseUrl(baseUrl);

    // 1) login
    const { fc } = await offoLogin(base, loginUser, loginPass);
    trace.push({ step: "login", ok: true });

    // 2) csrf pós-login (do /dashboard/iptv)
    const csrf = await fetchCsrfFromDashboardIptv(fc, base);
    trace.push({ step: "csrf_dashboard_iptv", ok: true });

    // 3) maketrial (nota)
    const createForm = new FormData();
    createForm.set("_token", csrf);
    createForm.set("trialx", "1");
    createForm.set("trialnotes", desiredNotes);

    const createRes = await eliteFetch(
      fc,
      base,
      "/api/iptv/maketrial",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          // content-type do FormData o fetch seta sozinho
        },
        body: createForm,
      },
      csrf
    );

    const createParsed = await readSafeBody(createRes);
    trace.push({
      step: "maketrial",
      status: createRes.status,
      ct: createRes.headers.get("content-type"),
      finalUrl: (createRes as any)?.url || null,
      preview: String(createParsed.text || "").slice(0, 250),
    });

    if (!createRes.ok) {
      // se veio HTML de login, é CSRF/cookie/referer
      const hint = looksLikeLoginHtml(createParsed.text) ? " (parece redirect/login → CSRF/referer)" : "";
      return NextResponse.json(
        {
          ok: false,
          error: `Elite maketrial failed${hint}`,
          trace,
          details_preview: String(createParsed.text || "").slice(0, 900),
        },
        { status: 502 }
      );
    }

    // 3.1) tenta id do response (às vezes não vem)
    let createdId =
      pickFirst(createParsed.json, ["id", "user_id", "data.id", "data.user_id", "user.id"]) ?? null;

    // 3.2) fallback: achar pelo datatable (search=value=trialnotes)
    let rowFromTable: any = null;
    if (!createdId) {
      const table = await findTrialByNotes(fc, base, csrf, desiredNotes);
      trace.push({
        step: "datatable_lookup",
        ok: table.ok,
        found: (table as any).found,
      });

      if ((table as any).ok && (table as any).found) {
        rowFromTable = (table as any).rows?.[0] || null;
        const idCandidate = rowFromTable?.id;
        if (idCandidate) createdId = String(idCandidate);
      }
    }

    if (!createdId) {
      return NextResponse.json({
        ok: true,
        provider: "ELITE",
        created: true,
        updated_username: false,
        username: finalUsername,
        note:
          "Trial criado, mas não consegui descobrir o ID automaticamente. Me mande o response do maketrial (raw) e/ou o JSON do /dashboard/iptv (datatable) para refinarmos o parse.",
        trace,
        raw_create: createParsed.json ?? createParsed.text,
      });
    }

    // 4) details (pegar password + bouquets)
    const detailsRes = await eliteFetch(
      fc,
      base,
      `/api/iptv/${createdId}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
        },
      },
      csrf
    );

    const detailsParsed = await readSafeBody(detailsRes);
    trace.push({
      step: "details",
      status: detailsRes.status,
      ct: detailsRes.headers.get("content-type"),
      preview: String(detailsParsed.text || "").slice(0, 250),
    });

    if (!detailsRes.ok) {
      return NextResponse.json({
        ok: true,
        provider: "ELITE",
        created: true,
        updated_username: false,
        external_user_id: String(createdId),
        username: finalUsername,
        note: "Trial criado, mas falhou ao ler detalhes (para aplicar update automático).",
        trace,
        details_preview: String(detailsParsed.text || "").slice(0, 900),
      });
    }

    const details = detailsParsed.json ?? {};
    const currentPassword =
      pickFirst(details, ["password", "data.password", "user.password", "data.user.password"]) ??
      rowFromTable?.password ??
      "";

    const bouquetsRaw =
      pickFirst(details, ["bouquet", "bouquets", "bouquet_ids", "data.bouquet", "data.bouquets", "data.bouquet_ids"]) ?? [];

    const bouquets: Array<string> = Array.isArray(bouquetsRaw) ? bouquetsRaw.map((x) => String(x)) : [];

    // 5) update username + notes (igual teu curl real: sem _token no body)
    const updForm = new FormData();
    updForm.set("user_id", String(createdId));
    updForm.set("usernamex", finalUsername);
    updForm.set("passwordx", String(currentPassword || ""));
    updForm.set("reseller_notes", desiredNotes);

    for (const b of bouquets) {
      updForm.append("bouquet[]", String(b));
    }

    const updRes = await eliteFetch(
      fc,
      base,
      `/api/iptv/update/${createdId}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
        },
        body: updForm,
      },
      csrf
    );

    const updParsed = await readSafeBody(updRes);
    trace.push({
      step: "update",
      status: updRes.status,
      ct: updRes.headers.get("content-type"),
      preview: String(updParsed.text || "").slice(0, 250),
    });

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
        trace,
        update_preview: String(updParsed.text || "").slice(0, 900),
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
      trace,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error", trace: trace.slice(-8) },
      { status: 500 }
    );
  }
}