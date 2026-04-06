import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ_SP = "America/Sao_Paulo";
// ⚠️ O IP da sua VM rodando o FlareSolverr
const FLARESOLVERR_URL = "http://136.112.249.42:8191/v1"; 

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
  // evita vazar senha em trace/preview por acidente
  return t
    .replace(/("password"\s*:\s*")[^"]*(")/gi, '$1***$2')
    .replace(/("passwordx"\s*:\s*")[^"]*(")/gi, '$1***$2')
    .slice(0, 250);
}

// ----------------- vencimento: parse + timezone -----------------
type DtParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parseEliteDateTime(raw: unknown): DtParts | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // ISO com timezone → deixa o Date lidar
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}T/.test(s)) return null;

  // dd/mm/yyyy hh:mm(:ss)
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    const hour = Number(m[4] ?? 0);
    const minute = Number(m[5] ?? 0);
    const second = Number(m[6] ?? 0);
    return { year, month, day, hour, minute, second };
  }

  // yyyy-mm-dd hh:mm(:ss)  ou  yyyy-mm-ddThh:mm(:ss)
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4] ?? 0);
    const minute = Number(m[5] ?? 0);
    const second = Number(m[6] ?? 0);
    return { year, month, day, hour, minute, second };
  }

  return null;
}

function zonedTimeToUtcIso(parts: DtParts, timeZone: string) {
  // truque: começa com um "palpite" em UTC e ajusta pelo offset real do fuso naquele instante
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  function partsFromDate(d: Date) {
    const p = fmt.formatToParts(d);
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
      second: get("second"),
    };
  }

  const desiredAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

  let utc = desiredAsUtc; // palpite inicial
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

  // ISO com timezone → direto
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // formatos locais (sem timezone) → interpretar como São Paulo e converter
  const parts = parseEliteDateTime(s);
  if (parts) return zonedTimeToUtcIso(parts, timeZone);

  // último fallback: tenta Date mesmo assim
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();

  return null;
}

// ----------------- NOVO LOGIN ELITE (VIA FLARESOLVERR) -----------------
async function offoLogin(baseUrlRaw: string, username: string, password: string, proxyUrl: string) {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  let sessionId: string | null = null;  // ← declarado ANTES do try, acessível pelo fsolverr

  try {
      // 1. Criar Sessão no FlareSolverr com Máscara e Proxy Residencial
      const sessionPayload: any = { 
          cmd: "sessions.create",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
      };
      if (proxyUrl) {
          sessionPayload.proxy = { url: proxyUrl };
      }

      const sessionRes = await fetch(FLARESOLVERR_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sessionPayload)
      }).then(res => res.json());

      if (sessionRes.status !== "ok") throw new Error(`Falha Session FlareSolverr: ${sessionRes.message}`);
      sessionId = sessionRes.session;

      // 2. Aceder à página de login, preencher os dados e clicar em "Entrar" (com Promise para não fugir)
      const loginAutomaticoRes = await fetch(FLARESOLVERR_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              cmd: "request.get",
              session: sessionId,
              url: `${baseUrl}/login`,
              maxTimeout: 60000,
              returnOnlyCookies: false, 
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
                      // Retorna o controlo IMEDIATAMENTE após clicar, para o FlareSolverr não encravar no redirecionamento
                      resolve();
                  }, 5000);
              });`
          })
      }).then(res => res.json());

      if (loginAutomaticoRes.status !== "ok") {
           throw new Error(`Falha ao tentar logar via script: ${loginAutomaticoRes.message}`);
      }

      // 3. Aguardar no Node.js para dar tempo de o navegador invisível processar o login e redirecionar
      await new Promise(r => setTimeout(r, 8000));

      // 4. Aceder a uma página interna para validar a entrada e capturar os cookies autenticados!
      const dashboardRes = await fetch(FLARESOLVERR_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              cmd: "request.get",
              session: sessionId,
              url: `${baseUrl}/user/profile`, // Acede ao profile pois é uma rota leve e segura
              maxTimeout: 60000
          })
      }).then(res => res.json());

      const htmlAposLogin = dashboardRes.solution?.response || "";
      
      if (htmlAposLogin.toLowerCase().includes("just a moment") || htmlAposLogin.toLowerCase().includes("cf-turnstile")) {
          throw new Error("O Cloudflare travou este IP no desafio. Vá às configurações da integração no Gestor e atualize o link do Proxy Residencial.");
      }

      // Se a página devolvida for novamente a de login, sabemos que a password estava errada
      if (htmlAposLogin.includes('name="password"') && htmlAposLogin.includes('type="submit"')) {
          throw new Error("Login falhou (voltou para /login). Verifique o utilizador/password.");
      }

      // 5. Valida cookies (mantidos na sessão do FlareSolverr internamente)
      const cookiesOk = (dashboardRes.solution?.cookies || []).length > 0;
      if (!cookiesOk) console.warn("[ELITE] Nenhum cookie retornado — sessão pode estar incompleta.");

  } catch (err) {
    throw err; // re-lança para o handler destruir a sessão no finally
  }

  // 5. Helper que faz TODAS as requests via FlareSolverr (mesma sessão, mesmo TLS)
  const fsolverr = async (
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {}
  ) => {
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

    return {
      ok: r.status === "ok",
      status: r.solution?.status || 0,
      text,
      json,
    };
  };

  // ⚠️ NÃO destrói a sessão aqui — ela sobrevive para o fluxo inteiro
  return { sessionId, baseUrl, fsolverr };
}

/**
 * ✅ IMPORTANTÍSSIMO:
 * Pega o CSRF dinamicamente do dashboard correto (IPTV ou P2P)
 */
async function fetchCsrfFromDashboard(fc: any, baseUrl: string, dashboardPath: string) {
  const url = `${baseUrl}${dashboardPath}`;
  const r = await fc(url, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
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
  headers.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36");
  headers.set("cache-control", headers.get("cache-control") || "no-cache");
  headers.set("pragma", headers.get("pragma") || "no-cache");

  if (csrf) {
    headers.set("x-csrf-token", csrf);
  }

  const finalInit: RequestInit = { ...init, headers, redirect: "follow" };
  return fc(url, finalInit);
}

/**
 * ✅ Fallback para descobrir o ID (e também username/senha/vencimento):
 * usa o endpoint server-side do DataTables em /dashboard/iptv?...
 * e filtra por search[value]=trialnotes
 */
function buildDtQuery(searchValue: string, isP2P: boolean) {
  const p = new URLSearchParams();

  p.set("draw", "1");
  p.set("start", "0");
  p.set("length", "15");
  
  if (isP2P) {
    // 🟢 CÓDIGO EXATO DO SEU P2P: Sempre manda vazio!
    p.set("search[value]", ""); 
  } else {
    // 🔵 CÓDIGO EXATO DO SEU IPTV: Manda a palavra!
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

async function findTrialByNotes(fsolverr: any, baseUrl: string, csrf: string, targetToMatch: string, dashboardPath: string, isP2P: boolean) {
  const qs = buildDtQuery(targetToMatch, isP2P);

  const r = await fsolverr(`${dashboardPath}?${qs}`, {
    method: "GET",
    headers: { accept: "application/json, text/javascript, */*; q=0.01", "x-csrf-token": csrf },
  });

  if (!r.ok) return { ok: false, status: r.status, raw: r.text?.slice(0, 900) || "" };

  const data = r.json?.data;

  if (isP2P) {
    // 🟢 CÓDIGO EXATO DO SEU P2P:
    if (!Array.isArray(data) || data.length === 0) return { ok: true, found: false, rows: [] };
    
    const targetStr = String(targetToMatch || "").trim().toLowerCase();
    const match = data.find((r: any) => {
       const fieldsToSearch = [r.username, r.name, r.email, r.reseller_notes, r.trialnotes, r.exField4, r.exField2, r.id];
       return fieldsToSearch.some(val => String(val || "").trim().toLowerCase() === targetStr);
    });

    if (match) {
       return { ok: true, found: true, rows: [match] };
    }
    return { ok: true, found: false, rows: data }; 

  } else {
    // 🔵 CÓDIGO EXATO DO SEU IPTV:
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
    if (!integration_id) {
      return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });
    }
    if (!isUuid(integration_id)) {
      return NextResponse.json({ ok: false, error: "integration_id inválido (não parece UUID)." }, { status: 400 });
    }

    // ✅ Pega as observações (notes) e o username enviados diretamente do front
    const trialNotes = String(body?.notes || body?.username || "").trim();
    if (!trialNotes) {
      return NextResponse.json(
        { ok: false, error: "Informe o username ou notes para gerar o trial." },
        { status: 400 }
      );
    }

    // ✅ tenant_id: se vier no JWT (metadata), valida contra o body; se não vier, usa o body
    const tenantIdFromBody = String(body?.tenant_id || "").trim();

    // supabase (service)
    const sb = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    let tenantIdFromToken = "";
    let requesterUserId = "";

    // ✅ se NÃO for chamada interna, valida bearer e tenta extrair tenant do JWT
    if (!isInternal) {
      const { data: userRes, error: userErr } = await sb.auth.getUser(token);
      if (userErr || !userRes?.user) {
        return NextResponse.json({ ok: false, error: "Unauthorized (invalid bearer)" }, { status: 401 });
      }

      requesterUserId = String(userRes.user.id || "").trim();

      const um: any = (userRes.user.user_metadata as any) || {};
      const am: any = (userRes.user.app_metadata as any) || {};
      tenantIdFromToken = String(um?.tenant_id || am?.tenant_id || "").trim();

      // se o token tem tenant e o body também, eles precisam bater
      if (tenantIdFromToken && tenantIdFromBody && tenantIdFromToken !== tenantIdFromBody) {
        return NextResponse.json(
          { ok: false, error: "tenant_id do body não confere com o tenant do usuário." },
          { status: 403 }
        );
      }
    }

    const tenantId = tenantIdFromToken || tenantIdFromBody;
    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "tenant_id obrigatório (envie no body ou garanta tenant_id no JWT metadata)." },
        { status: 400 }
      );
    }
    if (!isUuid(tenantId)) {
      return NextResponse.json({ ok: false, error: "tenant_id inválido (não parece UUID)." }, { status: 400 });
    }

    // ✅ carrega integração DO TENANT (impede cruzar tenant via integration_id)
    const { data: integ, error } = await sb
      .from("server_integrations")
      // ✅ NOVO: Adicionado proxy_url na query
      .select("id,tenant_id,provider,is_active,api_token,api_secret,api_base_url,proxy_url")
      .eq("id", integration_id)
      .eq("tenant_id", tenantId)
      .single();

    if (error) throw error;
    if (!integ) throw new Error("Integração não encontrada para este tenant.");

    const provider = String((integ as any).provider || "").toUpperCase().trim();
    if (provider !== "ELITE") throw new Error("Integração não é ELITE.");
    if (!(integ as any).is_active) throw new Error("Integração está inativa.");

    // ✅ REGRA: valida a tecnologia recebida diretamente do Frontend
    const reqTech = String(body?.technology || "").trim().toUpperCase();
    if (reqTech !== "IPTV" && reqTech !== "P2P") {
      return NextResponse.json(
        { ok: false, error: `Tecnologia '${reqTech}' não suportada para integração automática neste painel.` },
        { status: 400 }
      );
    }

    // ✅ Variáveis de Roteamento P2P vs IPTV
    const isP2P = reqTech === "P2P";
    const dashboardPath = isP2P ? "/dashboard/p2p" : "/dashboard/iptv";
    const createApiPath = isP2P ? "/api/p2p/maketrial" : "/api/iptv/maketrial";

    const loginUser = String((integ as any).api_token || "").trim();
    const loginPass = String((integ as any).api_secret || "").trim();
    const baseUrl = String((integ as any).api_base_url || "").trim();
    // ✅ NOVO: Puxando o Proxy do banco
    const proxyUrl = String((integ as any).proxy_url || "").trim();

    if (!baseUrl || !loginUser || !loginPass) {
      throw new Error("ELITE exige api_base_url + usuário (api_token) + senha (api_secret).");
    }

    const base = normalizeBaseUrl(baseUrl);

    // ==========================================
    // 1) LOGIN MÁGICO VIA FLARESOLVERR
    // ==========================================
    const { sessionId: sid, fsolverr } = await offoLogin(base, loginUser, loginPass, proxyUrl);
    eliteSessionId = sid;
    trace.push({ step: "login", ok: true });

    // ==========================================
    // 2) CSRF — via FlareSolverr (mesmo TLS, mesma sessão)
    // ==========================================
    const dashboardPage = await fsolverr(dashboardPath);
    const $csrf = cheerio.load(dashboardPage.text);
    const csrf = (
      $csrf('meta[name="csrf-token"]').attr("content") ||
      $csrf('input[name="_token"]').attr("value") ||
      ""
    ).trim();
    if (!csrf) throw new Error(`Não consegui obter CSRF de ${dashboardPath} após login.`);
    trace.push({ step: "csrf_dashboard", path: dashboardPath, ok: true });

    // 3) maketrial (nota)
    const reqUsername = String(body?.username || "").trim();

    const createForm = new FormData();
    createForm.set("_token", csrf);
    
    // ✅ No P2P o parâmetro chama "pacotex", no IPTV chama "trialx"
    if (isP2P) {
      createForm.set("pacotex", "1");
      
      // ✅ ELITE P2P: Força o envio apenas do usuário criado na tela
      if (reqUsername) {
        createForm.set("username", reqUsername);
        createForm.set("email", reqUsername); // Fallback: alguns painéis Elite P2P usam o campo email
      }
    } else {
      createForm.set("trialx", "1");
    }
    
    createForm.set("trialnotes", trialNotes);

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

    const createParsed = { json: createRaw.json, text: createRaw.text };
    const createRes = { ok: createRaw.ok, status: createRaw.status, headers: new Headers() };
    trace.push({
      step: "maketrial",
      status: createRes.status,
      ct: createRes.headers.get("content-type"),
      finalUrl: (createRes as any)?.url || null,
      preview: redactPreview(createParsed.text),
    });

    if (!createRes.ok) {
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

    // ✅ tenta extrair do retorno do maketrial
    let createdId = pickFirst(createParsed.json, ["id", "user_id", "data.id", "data.user_id", "user.id"]) ?? null;
    let serverUsername = pickFirst(createParsed.json, ["username", "name", "email", "data.username", "data.name", "user.username", "data.user.username"]) ?? null;
    let serverPassword = pickFirst(createParsed.json, ["password", "exField2", "data.password", "data.exField2", "user.password", "data.user.password"]) ?? null;
    let expRaw = pickFirst(createParsed.json, ["exp_date", "expires_at", "data.exp_date", "data.expires_at", "user.exp_date"]) ?? null;

    let rowFromTable: any = null;

    if (isP2P) {
      // ==================================================
      // 🟢 CÓDIGO EXATO DO P2P
      // ==================================================
      const isFakeId = createdId && !/^\d+$/.test(String(createdId));

      if (!createdId || !serverUsername || !serverPassword || !expRaw || isFakeId) {
        
        const searchTarget = isFakeId ? String(createdId) : String(serverUsername || trialNotes);
        
        const table = await findTrialByNotes(fsolverr, base, csrf, searchTarget, dashboardPath, isP2P);
        trace.push({ step: "datatable_lookup_p2p", ok: table.ok, found: (table as any).found, target: searchTarget });

        if ((table as any).ok && (table as any).rows?.length > 0) {
          rowFromTable = (table as any).found ? (table as any).rows[0] : (table as any).rows[0];

          createdId = String(rowFromTable.id);
          
          if (!serverUsername && (rowFromTable?.username || rowFromTable?.name)) {
            serverUsername = String(rowFromTable?.username || rowFromTable?.name);
          }
          if (!serverPassword && (rowFromTable?.password || rowFromTable?.exField2)) {
            serverPassword = String(rowFromTable?.password || rowFromTable?.exField2);
          }
          if (!expRaw) {
            expRaw = rowFromTable?.formatted_exp_date ?? rowFromTable?.exp_date ?? null;
          }
        }
      }
    } else {
      // ==================================================
      // 🔵 CÓDIGO EXATO DO IPTV
      // ==================================================
      if (createdId && !/^\d+$/.test(String(createdId))) {
          createdId = null;
      }

      if (!createdId || !serverUsername || !serverPassword || !expRaw) {
        const searchTarget = String(trialNotes); // IPTV procura exatamente pela Nota
        
        const table = await findTrialByNotes(fsolverr, base, csrf, searchTarget, dashboardPath, isP2P);
        trace.push({ step: "datatable_lookup_iptv", ok: table.ok, found: (table as any).found, target: searchTarget });

        if ((table as any).ok && (table as any).found) {
          rowFromTable = (table as any).rows?.[0] || null;

          if (!createdId && rowFromTable?.id) createdId = String(rowFromTable.id);
          
          if (!serverUsername && (rowFromTable?.username || rowFromTable?.name)) {
            serverUsername = String(rowFromTable?.username || rowFromTable?.name);
          }
          if (!serverPassword && (rowFromTable?.password || rowFromTable?.exField2)) {
            serverPassword = String(rowFromTable?.password || rowFromTable?.exField2);
          }
          if (!expRaw) {
            expRaw = rowFromTable?.formatted_exp_date ?? rowFromTable?.exp_date ?? null;
          }
        }
      }
    }

    if (!createdId || (isP2P && !/^\d+$/.test(String(createdId)))) {
      return NextResponse.json({
        ok: true,
        provider: "ELITE",
        created: true,
        external_user_id: null,
        trialnotes: trialNotes,
        username: serverUsername,
        server_username: serverUsername,
        password: serverPassword,
        server_password: serverPassword,
        expires_at_raw: expRaw,
        expires_at_utc: normalizeExpToUtcIso(expRaw, TZ_SP),
        note: "Trial criado, mas não consegui descobrir o ID numérico automaticamente.",
        trace,
        raw_create_preview: redactPreview(createParsed.text),
      });
    }

    // 4) details
    if (!serverUsername || !serverPassword || !expRaw) {
      const detailsApiPath = isP2P ? `/api/p2p/${createdId}` : `/api/iptv/${createdId}`;
      const detailsRaw = await fsolverr(detailsApiPath, {
        method: "GET",
        headers: { accept: "application/json", "x-csrf-token": csrf },
      });

      const detailsParsed = { json: detailsRaw.json, text: detailsRaw.text };
      trace.push({
        step: "details",
        status: detailsRaw.status,
        preview: redactPreview(detailsRaw.text),
      });

      if (detailsRaw.ok) {
        const details = detailsParsed.json ?? {};

        if (!serverUsername) {
          serverUsername =
            pickFirst(details, ["username", "name", "email", "data.username", "data.name", "user.username", "data.user.username"]) ??
            serverUsername;
        }

        if (!serverPassword) {
          serverPassword =
            pickFirst(details, ["password", "exField2", "data.password", "data.exField2", "user.password", "data.user.password"]) ??
            serverPassword;
        }

        if (!expRaw) {
          expRaw =
            pickFirst(details, [
              "exp_date",
              "expires_at",
              "data.exp_date",
              "data.expires_at",
              "user.exp_date",
              "data.user.exp_date",
              "formatted_exp_date",
              "data.formatted_exp_date",
            ]) ?? expRaw;
        }
      }
    }

    const expiresAtUtc = normalizeExpToUtcIso(expRaw, TZ_SP);

    return NextResponse.json({
      ok: true,
      provider: "ELITE",
      created: true,
      external_user_id: String(createdId),
      trialnotes: trialNotes,
      username: serverUsername,
      server_username: serverUsername,
      password: serverPassword,
      server_password: serverPassword,
      expires_at_raw: expRaw,
      expires_at_utc: expiresAtUtc,
      exp_date: expRaw, 
      trace,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error", trace: trace.slice(-8) },
      { status: 500 }
    );
  } finally {
    // Destrói a sessão do FlareSolverr UMA VEZ, ao fim de tudo
    if (eliteSessionId) {
      await fetch(FLARESOLVERR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "sessions.destroy", session: eliteSessionId }),
      }).catch(() => {});
    }
  }
}