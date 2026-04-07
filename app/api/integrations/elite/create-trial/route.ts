import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import { createFlareSession, requestWithFlare, destroyFlareSession } from "@/lib/api/flaresolverr";

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

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
}

async function readSafeBody(res: any) {
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
      else { ok = false; break; }
    }
    if (ok && cur !== undefined && cur !== null) return cur;
  }
  return null;
}

function redactPreview(s: string) {
  const t = String(s || "");
  return t.replace(/("password"\s*:\s*")[^"]*(")/gi, '$1***$2').replace(/("passwordx"\s*:\s*")[^"]*(")/gi, '$1***$2').slice(0, 250);
}

// ----------------- vencimento: parse + timezone -----------------
type DtParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; };

function parseEliteDateTime(raw: unknown): DtParts | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}T/.test(s)) return null;

  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return { year: Number(m[3]), month: Number(m[2]), day: Number(m[1]), hour: Number(m[4] ?? 0), minute: Number(m[5] ?? 0), second: Number(m[6] ?? 0) };

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4] ?? 0), minute: Number(m[5] ?? 0), second: Number(m[6] ?? 0) };

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

// ----------------- NOVO MOTOR DE REQUISIÇÃO (VIA NAVEGADOR DO FLARESOLVERR) -----------------
async function eliteFetch(sessionId: string, baseUrl: string, pathWithQuery: string, method: "GET" | "POST" = "GET", postDataString?: string) {
  const targetApiUrl = baseUrl.replace(/\/+$/, "") + pathWithQuery;
  const dashboardUrl = `${baseUrl.replace(/\/+$/, "")}/dashboard`; 
  
  const divId = 'RES_' + Math.random().toString(36).substr(2, 9);

  // Injetamos um script que roda um Fetch nativo DENTRO do painel Elite
  // Assim o Cloudflare acha que é o próprio usuário clicando!
  const evaluateScript = `new Promise(async (resolve) => {
      try {
          let csrf = document.querySelector('meta[name="csrf-token"]')?.content || document.querySelector('input[name="_token"]')?.value || '';
          let opts = {
              method: "${method}",
              headers: {
                  "Accept": "application/json",
                  "X-Requested-With": "XMLHttpRequest",
                  "X-CSRF-TOKEN": csrf
              }
          };
          if ("${method}" === "POST") {
              opts.headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
              opts.body = "${postDataString || ''}";
          }
          let res = await fetch("${targetApiUrl}", opts);
          let text = await res.text();
          
          let div = document.createElement('div');
          div.id = '${divId}';
          div.innerText = JSON.stringify({ status: res.status, text: text });
          document.body.appendChild(div);
          resolve();
      } catch (e) {
          let div = document.createElement('div');
          div.id = '${divId}';
          div.innerText = JSON.stringify({ status: 500, text: e.toString() });
          document.body.appendChild(div);
          resolve();
      }
  });`;

  const flareRes = await requestWithFlare(sessionId, dashboardUrl, evaluateScript, 60000);
  const $ = cheerio.load(flareRes.html);
  const resultRaw = $('#' + divId).text();
  
  if (!resultRaw) {
      throw new Error(`Cloudflare ou Timeout impediu a injeção do XHR para ${pathWithQuery}`);
  }

  const parsed = JSON.parse(resultRaw);

  return {
      ok: parsed.status >= 200 && parsed.status < 300,
      status: parsed.status,
      text: async () => parsed.text,
      headers: new Headers({ "content-type": "application/json" })
  };
}

function buildDtQuery(searchValue: string, isP2P: boolean) {
  const p = new URLSearchParams();
  p.set("draw", "1"); p.set("start", "0"); p.set("length", "15");
  p.set("search[value]", isP2P ? "" : searchValue); 
  p.set("search[regex]", "false"); p.set("order[0][column]", "1"); p.set("order[0][dir]", "desc"); p.set("order[0][name]", "");

  const cols = isP2P
    ? [{ data: "id", name: "", searchable: "false", orderable: "false" }, { data: "id", name: "", searchable: "true", orderable: "true" }, { data: "", name: "", searchable: "false", orderable: "false" }, { data: "name", name: "", searchable: "true", orderable: "true" }, { data: "email", name: "", searchable: "true", orderable: "true" }, { data: "exField2", name: "", searchable: "true", orderable: "true" }, { data: "formatted_created_at", name: "regTime", searchable: "false", orderable: "true" }, { data: "formatted_exp_date", name: "endTime", searchable: "false", orderable: "true" }, { data: "owner_username", name: "regUser.username", searchable: "true", orderable: "false" }, { data: "exField4", name: "", searchable: "true", orderable: "true" }, { data: "type", name: "", searchable: "true", orderable: "true" }, { data: "status", name: "", searchable: "true", orderable: "true" }, { data: "action", name: "", searchable: "false", orderable: "false" }]
    : [{ data: "", name: "", searchable: "false", orderable: "false" }, { data: "id", name: "", searchable: "true", orderable: "true" }, { data: "", name: "", searchable: "false", orderable: "false" }, { data: "username", name: "", searchable: "true", orderable: "true" }, { data: "password", name: "", searchable: "true", orderable: "true" }, { data: "formatted_created_at", name: "created_at", searchable: "false", orderable: "true" }, { data: "formatted_exp_date", name: "exp_date", searchable: "false", orderable: "true" }, { data: "max_connections", name: "", searchable: "true", orderable: "true" }, { data: "owner_username", name: "regUser.username", searchable: "true", orderable: "false" }, { data: "reseller_notes", name: "", searchable: "true", orderable: "true" }, { data: "is_trial", name: "", searchable: "true", orderable: "true" }, { data: "enabled", name: "", searchable: "true", orderable: "true" }, { data: "", name: "", searchable: "false", orderable: "false" }];

  cols.forEach((c, i) => { p.set(`columns[${i}][data]`, c.data); p.set(`columns[${i}][name]`, c.name); p.set(`columns[${i}][searchable]`, c.searchable); p.set(`columns[${i}][orderable]`, c.orderable); p.set(`columns[${i}][search][value]`, ""); p.set(`columns[${i}][search][regex]`, "false"); });
  return p.toString();
}

async function findTrialByNotes(sessionId: string, baseUrl: string, targetToMatch: string, dashboardPath: string, isP2P: boolean) {
  const qs = buildDtQuery(targetToMatch, isP2P);
  const r = await eliteFetch(sessionId, baseUrl, `${dashboardPath}?${qs}`, "GET");
  const parsed = await readSafeBody(r);
  
  if (!r.ok) return { ok: false, status: r.status, raw: parsed.text?.slice(0, 900) || "" };
  const data = parsed.json?.data;

  if (isP2P) {
    if (!Array.isArray(data) || data.length === 0) return { ok: true, found: false, rows: [] };
    const targetStr = String(targetToMatch || "").trim().toLowerCase();
    const match = data.find((r: any) => {
       const fieldsToSearch = [r.username, r.name, r.email, r.reseller_notes, r.trialnotes, r.exField4, r.exField2, r.id];
       return fieldsToSearch.some(val => String(val || "").trim().toLowerCase() === targetStr);
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
  let sessionId = null;

  try {
    const internalSecret = getInternalSecret(req);
    const expectedSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
    const isInternal = !!expectedSecret && internalSecret === expectedSecret;

    const token = getBearer(req);
    if (!isInternal && !token) return NextResponse.json({ ok: false, error: "Unauthorized (missing bearer)" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const integration_id = String(body?.integration_id || "").trim();
    if (!integration_id) return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });
    
    const trialNotes = String(body?.notes || body?.username || "").trim();
    if (!trialNotes) return NextResponse.json({ ok: false, error: "Informe o username ou notes para gerar o trial." }, { status: 400 });

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
    const { data: integ, error } = await sb.from("server_integrations").select("id,tenant_id,provider,is_active,api_token,api_secret,api_base_url,proxy_url").eq("id", integration_id).eq("tenant_id", tenantId).single();

    if (error || !integ) throw new Error("Integração não encontrada.");
    if (String((integ as any).provider).toUpperCase() !== "ELITE") throw new Error("Integração não é ELITE.");
    if (!(integ as any).is_active) throw new Error("Integração inativa.");

    const reqTech = String(body?.technology || "").trim().toUpperCase();
    const isP2P = reqTech === "P2P";
    const dashboardPath = isP2P ? "/dashboard/p2p" : "/dashboard/iptv";
    const createApiPath = isP2P ? "/api/p2p/maketrial" : "/api/iptv/maketrial";

    const loginUser = String((integ as any).api_token || "").trim();
    const loginPass = String((integ as any).api_secret || "").trim();
    const baseUrl = String((integ as any).api_base_url || "").trim();
    
    // FAXINA DE PROXY
    let proxyUrl = String((integ as any).proxy_url || "").trim();
    proxyUrl = proxyUrl.replace(/:\/\/[^:]+:[^@]+@/, '://');

    if (!baseUrl || !loginUser || !loginPass) throw new Error("Faltam credenciais do ELITE.");
    const base = normalizeBaseUrl(baseUrl);
    
    // 1. Criar Sessão
    sessionId = await createFlareSession(proxyUrl);

    // 2. Acessar a tela, logar e aguardar
    const evaluateScript = `new Promise((resolve) => {
        let tentativas = 0;
        let espiao = setInterval(() => {
            tentativas++;
            let emailInput = document.querySelector('input[type="email"], input[name="email"], input[name="username"]');
            let passInput = document.querySelector('input[type="password"], input[name="password"]');
            let btn = document.querySelector('button[type="submit"], form button');
            
            if (emailInput && passInput && btn) {
                clearInterval(espiao);
                emailInput.value = '${loginUser}';
                passInput.value = '${loginPass}';
                emailInput.dispatchEvent(new Event('input', { bubbles: true }));
                passInput.dispatchEvent(new Event('input', { bubbles: true }));
                btn.click();
                setTimeout(() => { resolve(); }, 15000);
            } else if (tentativas > 45) {
                clearInterval(espiao);
                resolve();
            }
        }, 1000);
    });`;

    const flareRes = await requestWithFlare(sessionId, `${base}/login`, evaluateScript, 90000);
    if (flareRes.html.toLowerCase().includes("just a moment") || flareRes.html.toLowerCase().includes("cf-turnstile")) {
        throw new Error("Cloudflare travou a sessão.");
    }
    trace.push({ step: "login_and_redirect_flaresolverr", ok: true });

    // -------------------------------------------------------------
    // FIM DO LOGIN - AGORA AS REQUISIÇÕES SÃO INJETADAS NO NAVEGADOR
    // -------------------------------------------------------------

    const reqUsername = String(body?.username || "").trim();
    
    const createParams = new URLSearchParams();
    if (isP2P) {
      createParams.set("pacotex", "1");
      if (reqUsername) {
        createParams.set("username", reqUsername);
        createParams.set("email", reqUsername); 
      }
    } else {
      createParams.set("trialx", "1");
    }
    createParams.set("trialnotes", trialNotes);

    // O trator injeta o POST nativamente pelo navegador fantasma
    const createRes = await eliteFetch(sessionId, base, createApiPath, "POST", createParams.toString());
    const createParsed = await readSafeBody(createRes);
    
    trace.push({ step: "maketrial", status: createRes.status, preview: redactPreview(createParsed.text) });

    if (!createRes.ok) {
      const errorReal = String(createParsed.text || "").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 400);
      return NextResponse.json({ ok: false, error: `Falha ao criar trial. Status: ${createRes.status}. Elite: ${errorReal}`, trace }, { status: 502 });
    }

    let createdId = pickFirst(createParsed.json, ["id", "user_id", "data.id", "data.user_id", "user.id"]) ?? null;
    let serverUsername = pickFirst(createParsed.json, ["username", "name", "email", "data.username", "data.name", "user.username", "data.user.username"]) ?? null;
    let serverPassword = pickFirst(createParsed.json, ["password", "exField2", "data.password", "data.exField2", "user.password", "data.user.password"]) ?? null;
    let expRaw = pickFirst(createParsed.json, ["exp_date", "expires_at", "data.exp_date", "data.expires_at", "user.exp_date"]) ?? null;

    let rowFromTable: any = null;

    if (isP2P) {
      const isFakeId = createdId && !/^\d+$/.test(String(createdId));
      if (!createdId || !serverUsername || !serverPassword || !expRaw || isFakeId) {
        const searchTarget = isFakeId ? String(createdId) : String(serverUsername || trialNotes);
        const table = await findTrialByNotes(sessionId, base, searchTarget, dashboardPath, isP2P);
        trace.push({ step: "datatable_lookup_p2p", ok: table.ok, found: (table as any).found, target: searchTarget });

        if ((table as any).ok && (table as any).rows?.length > 0) {
          rowFromTable = (table as any).found ? (table as any).rows[0] : (table as any).rows[0];
          createdId = String(rowFromTable.id);
          if (!serverUsername && (rowFromTable?.username || rowFromTable?.name)) serverUsername = String(rowFromTable?.username || rowFromTable?.name);
          if (!serverPassword && (rowFromTable?.password || rowFromTable?.exField2)) serverPassword = String(rowFromTable?.password || rowFromTable?.exField2);
          if (!expRaw) expRaw = rowFromTable?.formatted_exp_date ?? rowFromTable?.exp_date ?? null;
        }
      }
    } else {
      if (createdId && !/^\d+$/.test(String(createdId))) createdId = null;
      if (!createdId || !serverUsername || !serverPassword || !expRaw) {
        const searchTarget = String(trialNotes);
        const table = await findTrialByNotes(sessionId, base, searchTarget, dashboardPath, isP2P);
        trace.push({ step: "datatable_lookup_iptv", ok: table.ok, found: (table as any).found, target: searchTarget });

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
        ok: true, provider: "ELITE", created: true, external_user_id: null, trialnotes: trialNotes,
        username: serverUsername, server_username: serverUsername, password: serverPassword, server_password: serverPassword,
        expires_at_raw: expRaw, expires_at_utc: normalizeExpToUtcIso(expRaw, TZ_SP),
        note: "Trial criado, mas não consegui descobrir o ID numérico automaticamente.", trace, raw_create_preview: redactPreview(createParsed.text)
      });
    }

    if (!serverUsername || !serverPassword || !expRaw) {
      const detailsApiPath = isP2P ? `/api/p2p/${createdId}` : `/api/iptv/${createdId}`;
      const detailsRes = await eliteFetch(sessionId, base, detailsApiPath, "GET");
      const detailsParsed = await readSafeBody(detailsRes);
      trace.push({ step: "details", status: detailsRes.status, preview: redactPreview(detailsParsed.text) });

      if (detailsRes.ok) {
        const details = detailsParsed.json ?? {};
        if (!serverUsername) serverUsername = pickFirst(details, ["username", "name", "email", "data.username", "data.name", "user.username"]) ?? serverUsername;
        if (!serverPassword) serverPassword = pickFirst(details, ["password", "exField2", "data.password", "data.exField2", "user.password"]) ?? serverPassword;
        if (!expRaw) expRaw = pickFirst(details, ["exp_date", "expires_at", "data.exp_date", "data.expires_at", "user.exp_date", "formatted_exp_date"]) ?? expRaw;
      }
    }

    const expiresAtUtc = normalizeExpToUtcIso(expRaw, TZ_SP);

    return NextResponse.json({
      ok: true, provider: "ELITE", created: true, external_user_id: String(createdId), trialnotes: trialNotes,
      username: serverUsername, server_username: serverUsername, password: serverPassword, server_password: serverPassword,
      expires_at_raw: expRaw, expires_at_utc: expiresAtUtc, exp_date: expRaw, trace
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error", trace: trace.slice(-8) }, { status: 500 });
  } finally {
    if (sessionId) {
        await destroyFlareSession(sessionId);
    }
  }
}