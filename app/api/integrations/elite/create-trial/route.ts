import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ_SP = "America/Sao_Paulo";
const FLARESOLVERR_URL = "http://136.112.249.42:8191/v1";

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

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
}

function pickFirst(obj: any, paths: string[]) {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const k of parts) {
      if (cur && typeof cur === "object" && k in cur) cur = cur[k];
      else { ok = false; break; }
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
  return String(s || "")
    .replace(/("password"\s*:\s*")[^"]*(")/gi, '$1***$2')
    .replace(/("passwordx"\s*:\s*")[^"]*(")/gi, '$1***$2')
    .slice(0, 250);
}

// ----------------- vencimento: parse + timezone -----------------
type DtParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function parseEliteDateTime(raw: unknown): DtParts | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}T/.test(s)) return null;

  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]), hour: Number(m[4] ?? 0), minute: Number(m[5] ?? 0), second: Number(m[6] ?? 0) };

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4] ?? 0), minute: Number(m[5] ?? 0), second: Number(m[6] ?? 0) };

  return null;
}

function zonedTimeToUtcIso(parts: DtParts, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

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

// ----------------- tipo do helper fsolverr -----------------
type Fsolverr = (
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; text: string; json: any }>;

// ----------------- LOGIN ELITE VIA FLARESOLVERR -----------------
async function offoLogin(baseUrlRaw: string, username: string, password: string, proxyUrl: string): Promise<{ sessionId: string; fsolverr: Fsolverr }> {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  let sessionId: string | null = null;

  try {
    // 1. Criar sessão
    const sessionPayload: any = {
      cmd: "sessions.create",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    };
    if (proxyUrl) sessionPayload.proxy = { url: proxyUrl };

    const sessionRes = await fetch(FLARESOLVERR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sessionPayload),
    }).then((r) => r.json());

    if (sessionRes.status !== "ok") throw new Error(`Falha Session FlareSolverr: ${sessionRes.message}`);
    sessionId = sessionRes.session;

    // 2. Login via JS inject
    const loginRes = await fetch(FLARESOLVERR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: "request.get",
        session: sessionId,
        url: `${baseUrl}/login`,
        maxTimeout: 60000,
        evaluate: `new Promise((resolve) => {
          setTimeout(() => {
            let emailInput = document.querySelector('input[type="email"], input[name="email"], input[name="username"]');
            let passInput = document.querySelector('input[type="password"], input[name="password"]');
            let btn = document.querySelector('button[type="submit"], form button');
            if (emailInput && passInput && btn) {
              emailInput.value = '${username}';
              passInput.value = '${password}';
              emailInput.dispatchEvent(new Event('input', { bubbles: true }));
              passInput.dispatchEvent(new Event('input', { bubbles: true }));
              btn.click();
            }
            resolve();
          }, 5000);
        });`,
      }),
    }).then((r) => r.json());

    if (loginRes.status !== "ok") throw new Error(`Falha ao logar via script: ${loginRes.message}`);

    // 3. Aguarda redirect
    await new Promise((r) => setTimeout(r, 8000));

    // 4. Valida login
    const checkRes = await fetch(FLARESOLVERR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", session: sessionId, url: `${baseUrl}/user/profile`, maxTimeout: 60000 }),
    }).then((r) => r.json());

    const htmlCheck = checkRes.solution?.response || "";

    if (htmlCheck.toLowerCase().includes("just a moment") || htmlCheck.toLowerCase().includes("cf-turnstile")) {
      throw new Error("O Cloudflare travou este IP. Atualize o proxy residencial nas configurações da integração.");
    }
    if (htmlCheck.includes('name="password"') && htmlCheck.includes('type="submit"')) {
      throw new Error("Login falhou (voltou para /login). Verifique usuário/senha.");
    }
  } catch (err) {
    throw err;
  }

  // 5. Helper — TODAS as requests via FlareSolverr (mesma sessão, mesmo TLS)
  const fsolverr: Fsolverr = async (path, init = {}) => {
    const isPost = (init.method || "GET").toUpperCase() === "POST";
    const payload: any = {
      cmd: isPost ? "request.post" : "request.get",
      session: sessionId,
      url: `${baseUrl}${path}`,
      maxTimeout: 60000,
    };
    if (isPost && init.body) payload.postData = init.body;
    if (init.headers) payload.headers = init.headers;

    const r = await fetch(FLARESOLVERR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((res) => res.json());

    const text = r.solution?.response || "";
    let json: any = null;
    try { json = JSON.parse(text); } catch {}

    return { ok: r.status === "ok", status: r.solution?.status || 0, text, json };
  };

  return { sessionId: sessionId!, fsolverr };
}

// --- DataTables helper ---
function buildDtQuery(searchValue: string, isP2P: boolean) {
  const p = new URLSearchParams();
  p.set("draw", "1");
  p.set("start", "0");
  p.set("length", "15");

  if (isP2P) {
    p.set("search[value]", "");
  } else {
    p.set("search[value]", searchValue);
  }

  p.set("search[regex]", "false");
  p.set("order[0][column]", "1");
  p.set("order[0][dir]", "desc");
  p.set("order[0][name]", "");

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

async function findTrialByNotes(fsolverr: Fsolverr, csrf: string, targetToMatch: string, dashboardPath: string, isP2P: boolean) {
  const qs = buildDtQuery(targetToMatch, isP2P);

  const r = await fsolverr(`${dashboardPath}?${qs}`, {
    method: "GET",
    headers: {
      "accept": "application/json, text/javascript, */*; q=0.01",
      "x-csrf-token": csrf,
      "x-requested-with": "XMLHttpRequest",
    },
  });

  if (!r.ok) return { ok: false, status: r.status, raw: r.text?.slice(0, 900) || "" };

  const data = r.json?.data;

  if (isP2P) {
    if (!Array.isArray(data) || data.length === 0) return { ok: true, found: false, rows: [] };
    const targetStr = String(targetToMatch || "").trim().toLowerCase();
    const match = data.find((row: any) => {
      const fieldsToSearch = [row.username, row.name, row.email, row.reseller_notes, row.trialnotes, row.exField4, row.exField2, row.id];
      return fieldsToSearch.some((val) => String(val || "").trim().toLowerCase() === targetStr);
    });
    if (match) return { ok: true, found: true, rows: [match] };
    return { ok: true, found: false, rows: data };
  } else {
    if (!Array.isArray(data) || data.length === 0) return { ok: true, found: false, rows: [] as any[] };
    return { ok: true, found: true, rows: data };
  }
}

// ----------------- handler -----------------
export async function POST(req: Request) {
  const trace: any[] = [];
  let eliteSessionId: string | null = null;

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
    if (!integration_id) return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });
    if (!isUuid(integration_id)) return NextResponse.json({ ok: false, error: "integration_id inválido (não parece UUID)." }, { status: 400 });

    const trialNotes = String(body?.notes || body?.username || "").trim();
    if (!trialNotes) {
      return NextResponse.json({ ok: false, error: "Informe o username ou notes para gerar o trial." }, { status: 400 });
    }

    const tenantIdFromBody = String(body?.tenant_id || "").trim();

    const sb = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

    let tenantIdFromToken = "";

    if (!isInternal) {
      const { data: userRes, error: userErr } = await sb.auth.getUser(token);
      if (userErr || !userRes?.user) return NextResponse.json({ ok: false, error: "Unauthorized (invalid bearer)" }, { status: 401 });

      const um: any = (userRes.user.user_metadata as any) || {};
      const am: any = (userRes.user.app_metadata as any) || {};
      tenantIdFromToken = String(um?.tenant_id || am?.tenant_id || "").trim();

      if (tenantIdFromToken && tenantIdFromBody && tenantIdFromToken !== tenantIdFromBody) {
        return NextResponse.json({ ok: false, error: "tenant_id do body não confere com o tenant do usuário." }, { status: 403 });
      }
    }

    const tenantId = tenantIdFromToken || tenantIdFromBody;
    if (!tenantId) return NextResponse.json({ ok: false, error: "tenant_id obrigatório." }, { status: 400 });
    if (!isUuid(tenantId)) return NextResponse.json({ ok: false, error: "tenant_id inválido (não parece UUID)." }, { status: 400 });

    const { data: integ, error } = await sb
      .from("server_integrations")
      .select("id,tenant_id,provider,is_active,api_token,api_secret,api_base_url,proxy_url")
      .eq("id", integration_id)
      .eq("tenant_id", tenantId)
      .single();

    if (error) throw error;
    if (!integ) throw new Error("Integração não encontrada para este tenant.");

    const provider = String((integ as any).provider || "").toUpperCase().trim();
    if (provider !== "ELITE") throw new Error("Integração não é ELITE.");
    if (!(integ as any).is_active) throw new Error("Integração está inativa.");

    const reqTech = String(body?.technology || "").trim().toUpperCase();
    if (reqTech !== "IPTV" && reqTech !== "P2P") {
      return NextResponse.json({ ok: false, error: `Tecnologia '${reqTech}' não suportada.` }, { status: 400 });
    }

    const isP2P = reqTech === "P2P";
    const dashboardPath = isP2P ? "/dashboard/p2p" : "/dashboard/iptv";
    const createApiPath = isP2P ? "/api/p2p/maketrial" : "/api/iptv/maketrial";

    const loginUser = String((integ as any).api_token || "").trim();
    const loginPass = String((integ as any).api_secret || "").trim();
    const baseUrl = String((integ as any).api_base_url || "").trim();
    const proxyUrl = String((integ as any).proxy_url || "").trim();

    if (!baseUrl || !loginUser || !loginPass) {
      throw new Error("ELITE exige api_base_url + usuário (api_token) + senha (api_secret).");
    }

    const base = normalizeBaseUrl(baseUrl);

    // 1) Login
    const { sessionId: sid, fsolverr } = await offoLogin(base, loginUser, loginPass, proxyUrl);
    eliteSessionId = sid;
    trace.push({ step: "login", ok: true });

    // 2) CSRF — busca no /dashboard geral (mesma sessão, o token é global no Laravel)
    const dashboardPage = await fsolverr("/dashboard");
    const $csrf = cheerio.load(dashboardPage.text);
    const csrf = (
      $csrf('meta[name="csrf-token"]').attr("content") ||
      $csrf('input[name="_token"]').attr("value") ||
      ""
    ).trim();
    if (!csrf) throw new Error(`Não consegui obter CSRF de /dashboard após login.`);
    trace.push({ step: "csrf_dashboard", path: "/dashboard", csrf_preview: csrf.slice(0, 10) + "...", ok: true });

    // 3) maketrial
    const reqUsername = String(body?.username || "").trim();
    const formBody = new URLSearchParams();
    formBody.set("_token", csrf);

    if (isP2P) {
      formBody.set("pacotex", "1");
      if (reqUsername) {
        formBody.set("username", reqUsername);
        formBody.set("email", reqUsername);
      }
    } else {
      formBody.set("trialx", "1");
    }
    formBody.set("trialnotes", trialNotes);

    const createRaw = await fsolverr(createApiPath, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "x-requested-with": "XMLHttpRequest",
        "x-csrf-token": csrf,
        "content-type": "application/x-www-form-urlencoded",
        "referer": `${base}${dashboardPath}`,
      },
      body: formBody.toString(),
    });

    trace.push({
      step: "maketrial",
      status: createRaw.status,
      preview: redactPreview(createRaw.text),
    });

    if (!createRaw.ok) {
      const hint = looksLikeLoginHtml(createRaw.text) ? " (parece redirect/login → CSRF/referer)" : "";
      return NextResponse.json(
        { ok: false, error: `Elite maketrial failed${hint}`, trace, details_preview: createRaw.text.slice(0, 900) },
        { status: 502 }
      );
    }

    let createdId = pickFirst(createRaw.json, ["id", "user_id", "data.id", "data.user_id", "user.id"]) ?? null;
    let serverUsername = pickFirst(createRaw.json, ["username", "name", "email", "data.username", "data.name", "user.username", "data.user.username"]) ?? null;
    let serverPassword = pickFirst(createRaw.json, ["password", "exField2", "data.password", "data.exField2", "user.password", "data.user.password"]) ?? null;
    let expRaw = pickFirst(createRaw.json, ["exp_date", "expires_at", "data.exp_date", "data.expires_at", "user.exp_date"]) ?? null;

    let rowFromTable: any = null;

    if (isP2P) {
      const isFakeId = createdId && !/^\d+$/.test(String(createdId));
      if (!createdId || !serverUsername || !serverPassword || !expRaw || isFakeId) {
        const searchTarget = isFakeId ? String(createdId) : String(serverUsername || trialNotes);
        const table = await findTrialByNotes(fsolverr, csrf, searchTarget, dashboardPath, isP2P);
        trace.push({ step: "datatable_lookup_p2p", ok: table.ok, found: (table as any).found, target: searchTarget });

        if ((table as any).ok && (table as any).rows?.length > 0) {
          rowFromTable = (table as any).rows[0];
          createdId = String(rowFromTable.id);
          if (!serverUsername && (rowFromTable?.username || rowFromTable?.name)) serverUsername = String(rowFromTable?.username || rowFromTable?.name);
          if (!serverPassword && (rowFromTable?.password || rowFromTable?.exField2)) serverPassword = String(rowFromTable?.password || rowFromTable?.exField2);
          if (!expRaw) expRaw = rowFromTable?.formatted_exp_date ?? rowFromTable?.exp_date ?? null;
        }
      }
    } else {
      if (createdId && !/^\d+$/.test(String(createdId))) createdId = null;

      if (!createdId || !serverUsername || !serverPassword || !expRaw) {
        const table = await findTrialByNotes(fsolverr, csrf, String(trialNotes), dashboardPath, isP2P);
        trace.push({ step: "datatable_lookup_iptv", ok: table.ok, found: (table as any).found, target: trialNotes });

        if ((table as any).ok && (table as any).found) {
          rowFromTable = (table as any).rows?.[0] || null;
          if (!createdId && rowFromTable?.id) createdId = String(rowFromTable.id);
          if (!serverUsername && (rowFromTable?.username || rowFromTable?.name)) serverUsername = String(rowFromTable?.username || rowFromTable?.name);
          if (!serverPassword && (rowFromTable?.password || rowFromTable?.exField2)) serverPassword = String(rowFromTable?.password || rowFromTable?.exField2);
          if (!expRaw) expRaw = rowFromTable?.formatted_exp_date ?? rowFromTable?.exp_date ?? null;
        }
      }
    }

    if (!createdId || (isP2P && !/^\d+$/.test(String(createdId)))) {
      return NextResponse.json({
        ok: true, provider: "ELITE", created: true, external_user_id: null,
        trialnotes: trialNotes, username: serverUsername, server_username: serverUsername,
        password: serverPassword, server_password: serverPassword,
        expires_at_raw: expRaw, expires_at_utc: normalizeExpToUtcIso(expRaw, TZ_SP),
        note: "Trial criado, mas não consegui descobrir o ID numérico automaticamente.",
        trace, raw_create_preview: redactPreview(createRaw.text),
      });
    }

    // 4) Details (se ainda faltar algum campo)
    if (!serverUsername || !serverPassword || !expRaw) {
      const detailsApiPath = isP2P ? `/api/p2p/${createdId}` : `/api/iptv/${createdId}`;
      const detailsRaw = await fsolverr(detailsApiPath, {
        method: "GET",
        headers: { "accept": "application/json", "x-csrf-token": csrf, "x-requested-with": "XMLHttpRequest" },
      });

      trace.push({ step: "details", status: detailsRaw.status, preview: redactPreview(detailsRaw.text) });

      if (detailsRaw.ok && detailsRaw.json) {
        if (!serverUsername) serverUsername = pickFirst(detailsRaw.json, ["username", "name", "email", "data.username", "data.name", "user.username", "data.user.username"]) ?? serverUsername;
        if (!serverPassword) serverPassword = pickFirst(detailsRaw.json, ["password", "exField2", "data.password", "data.exField2", "user.password", "data.user.password"]) ?? serverPassword;
        if (!expRaw) expRaw = pickFirst(detailsRaw.json, ["exp_date", "expires_at", "data.exp_date", "data.expires_at", "user.exp_date", "data.user.exp_date", "formatted_exp_date", "data.formatted_exp_date"]) ?? expRaw;
      }
    }

    return NextResponse.json({
      ok: true, provider: "ELITE", created: true,
      external_user_id: String(createdId), trialnotes: trialNotes,
      username: serverUsername, server_username: serverUsername,
      password: serverPassword, server_password: serverPassword,
      expires_at_raw: expRaw, expires_at_utc: normalizeExpToUtcIso(expRaw, TZ_SP),
      exp_date: expRaw, trace,
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error", trace: trace.slice(-8) }, { status: 500 });
  } finally {
    // Destrói a sessão do FlareSolverr UMA VEZ, no final de tudo
    if (eliteSessionId) {
      await fetch(FLARESOLVERR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "sessions.destroy", session: eliteSessionId }),
      }).catch(() => {});
    }
  }
}
