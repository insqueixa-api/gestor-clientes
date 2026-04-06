import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CookieJar } from "tough-cookie";
import fetchCookie from "fetch-cookie";
import * as cheerio from "cheerio";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ_SP = "America/Sao_Paulo";
// ⚠️ O IP da sua VM rodando o FlareSolverr
const FLARESOLVERR_URL = "http://136.112.249.42:8191/v1"; 

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

// ----------------- DATATABLES HELPER (CAÇADOR DE ID) -----------------
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

async function findRowBySearch(fc: any, baseUrl: string, csrf: string, searchValue: string, dashboardPath: string, isP2P: boolean) {
  // P2P Text Search workaround (mandamos busca vazia e filtramos no JS)
  const isP2PTextSearch = isP2P && !/^\d+$/.test(searchValue);
  const qs = buildDtQuery(isP2PTextSearch ? "" : searchValue, isP2P);
  
  const r = await eliteFetch(
    fc,
    baseUrl,
    `${dashboardPath}?${qs}`,
    { method: "GET", headers: { accept: "application/json, text/javascript, */*; q=0.01" } },
    csrf,
    dashboardPath
  );

  const parsed = await readSafeBody(r);
  if (!r.ok) return { ok: false, status: r.status, rows: [] as any[], raw: parsed.text?.slice(0, 900) || "" };

  const data = parsed.json?.data;
  if (!Array.isArray(data)) return { ok: true, rows: [] as any[] };

  if (isP2PTextSearch) {
      const targetStr = String(searchValue || "").trim().toLowerCase();
      const match = data.find((r: any) => {
         const fieldsToSearch = [r.username, r.name, r.email, r.reseller_notes, r.trialnotes, r.exField4, r.exField2, r.id];
         return fieldsToSearch.some(val => String(val || "").trim().toLowerCase() === targetStr);
      });
      if (match) return { ok: true, rows: [match] };
      return { ok: true, rows: [] as any[] };
  }

  return { ok: true, rows: data as any[] };
}

// ----------------- NOVO LOGIN ELITE (VIA FLARESOLVERR) -----------------
async function offoLogin(baseUrlRaw: string, username: string, password: string, proxyUrl: string, tz = TZ_SP) {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  
  let sessionId = null;
  let cookiesToExport = [];

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

      // 5. Apanhamos os cookies mágicos (Agora sim, 100% autenticados na sessão)
      cookiesToExport = dashboardRes.solution?.cookies || [];

  } finally {
      // Sempre destruir a sessão do FlareSolverr após exportar os cookies para libertar memória da VM
      if (sessionId) {
          await fetch(FLARESOLVERR_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cmd: "sessions.destroy", session: sessionId })
          }).catch(() => {});
      }
  }

  // 6. Transformar os Cookies do FlareSolverr para o seu fetchCookie nativo
  const jar = new CookieJar();
  cookiesToExport.forEach((cookie: any) => {
      const cookieString = `${cookie.name}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}`;
      let domainBase = baseUrl.replace(/^https?:\/\//i, '');
      jar.setCookieSync(cookieString, `https://${domainBase}`);
  });

  const fc = fetchCookie(fetch, jar);

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

// ----------------- HANDLER PRINCIPAL -----------------
function isInternalCheck(secret: string, expected: string): boolean {
  if (!secret || !expected) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const trace: any[] = [];

  try {
    const internalSecret = getInternalSecret(req);
    const expectedSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
    const isInternal = isInternalCheck(internalSecret, expectedSecret);

    const token = getBearer(req);
    if (!isInternal && !token) {
      return NextResponse.json({ ok: false, error: "Unauthorized (missing bearer)" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({} as any));
    const integration_id = String(body?.integration_id || "").trim();
    let external_user_id = String(body?.external_user_id || "").trim();
    const username = String(body?.username || "").trim(); // Fundamental se o external estiver vazio
    const months = String(body?.months || "1").trim(); 
    
    const reqTech = String(body?.technology || "IPTV").trim().toUpperCase();

    if (!integration_id) {
      return NextResponse.json({ ok: false, error: "integration_id é obrigatório." }, { status: 400 });
    }

    if (!external_user_id && !username) {
        return NextResponse.json({ ok: false, error: "Informe o external_user_id ou o username para renovar." }, { status: 400 });
    }

    const tenantIdFromBody = String(body?.tenant_id || "").trim();

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

    // Carrega a integração Elite
    const { data: integ, error } = await sb
      .from("server_integrations")
      // ✅ NOVO: Adicionado proxy_url na query
      .select("id,tenant_id,provider,is_active,api_token,api_secret,api_base_url,proxy_url")
      .eq("id", integration_id)
      .eq("tenant_id", tenantId)
      .single();

    if (error || !integ) throw new Error("Integração não encontrada.");
    if (String(integ.provider).toUpperCase() !== "ELITE") throw new Error("Integração não é ELITE.");
    if (!integ.is_active) throw new Error("Integração inativa.");

    const loginUser = String((integ as any).api_token || "").trim();
    const loginPass = String((integ as any).api_secret || "").trim();
    const baseUrl = String((integ as any).api_base_url || "").trim();
    // ✅ NOVO: Puxando o Proxy do banco
    const proxyUrl = String((integ as any).proxy_url || "").trim();
    // 1) Login (ou Login Mágico)
    const base = normalizeBaseUrl(baseUrl);
    // ✅ NOVO: Passando a variável proxyUrl que você extraiu do banco!
    const { fc } = await offoLogin(base, loginUser, loginPass, proxyUrl, TZ_SP);
    trace.push({ step: "login", ok: true });

    // 2) Pegar CSRF
    const isP2P = reqTech === "P2P";
    const dashboardPath = isP2P ? "/dashboard/p2p" : "/dashboard/iptv";
    const csrf = await fetchCsrfFromDashboard(fc, base, dashboardPath);
    trace.push({ step: "csrf_dashboard", ok: true });

    // =========================================================================
    // 3) CAÇADOR DE ID (Caso tenha vindo do cadastro Offline)
    // =========================================================================
    if (!external_user_id || !/^\d+$/.test(external_user_id) || external_user_id.length > 9) {
       const searchTarget = username || external_user_id;
       trace.push({ step: "hunting_real_id", target: searchTarget });
       
       const fixTable = await findRowBySearch(fc, base, csrf, searchTarget, dashboardPath, isP2P);
       if (fixTable.ok && fixTable.rows?.length > 0) {
           external_user_id = String(fixTable.rows[0].id);
           trace.push({ step: "id_fixed", new_id: external_user_id });
           
           // Background Patch para salvar no banco o ID encontrado (Usa IIFE assíncrona para não quebrar o TS)
           if (tenantId) {
             (async () => {
               const { error } = await sb.from("clients")
                 .update({ external_user_id: external_user_id })
                 .eq("tenant_id", tenantId)
                 .eq("server_username", searchTarget)
                 .is("external_user_id", null);
               if (error) console.log("Erro no background patch:", error.message);
             })();
           }
       } else {
           throw new Error(`Não foi possível encontrar o ID do usuário '${searchTarget}' no painel. Verifique se ele realmente existe lá.`);
       }
    }

    // =========================================================================
    // 4) RENOVAÇÃO FINAL COM PAYLOAD CORRETO (DINÂMICO PARA IPTV OU P2P)
    // =========================================================================
    const renewApiPath = isP2P ? `/api/p2p/renewmulti/${external_user_id}` : `/api/iptv/renewmulti/${external_user_id}`;
    
    let payloadBody;
    let contentType;

    if (isP2P) {
      // 🟢 P2P EXIGE URL ENCODED
      const params = new URLSearchParams();
      params.set("user_id", external_user_id);
      params.set("months", months);
      payloadBody = params.toString();
      contentType = "application/x-www-form-urlencoded; charset=UTF-8";
    } else {
      // 🔵 IPTV EXIGE JSON
      payloadBody = JSON.stringify({
        user_id: external_user_id,
        months: months
      });
      contentType = "application/json";
    }

    const renewRes = await eliteFetch(
      fc,
      base,
      renewApiPath,
      {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": contentType, 
          "timezone": TZ_SP
        },
        body: payloadBody, 
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
    return NextResponse.json({ ok: false, error: e?.message || "Erro ao renovar. Procure o suporte.", trace: trace.slice(-8) }, { status: 500 });
  }
}