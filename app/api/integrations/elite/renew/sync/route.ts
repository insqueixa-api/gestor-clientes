import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CookieJar } from "tough-cookie";
import fetchCookie from "fetch-cookie";
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

function looksLikeLoginHtml(text: string) {
  const t = String(text || "");
  return /\/login\b/i.test(t) && /csrf/i.test(t);
}

function normalizeUsernameFromNotes(notesRaw: unknown) {
  const raw = String(notesRaw ?? "").trim();
  if (!raw) return "";

  // remove acentos
  const noDiacritics = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // remove espaços e caracteres estranhos (Elite geralmente aceita alfanum + _ . -)
  const cleaned = noDiacritics.replace(/\s+/g, "").replace(/[^a-zA-Z0-9_.-]/g, "");

  // limites conservadores
  const out = cleaned.slice(0, 32);
  return out;
}

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

/**
 * Converte um "local time" (ex.: 20/02/2026 10:03 no fuso America/Sao_Paulo)
 * para UTC ms de forma robusta (sem depender de libs externas e funcionando com/sem DST).
 */
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

function generateEliteFallbackPassword() {
  let nums = "";
  for (let i = 0; i < 12; i++) {
    nums += Math.floor(Math.random() * 10).toString();
  }
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const c1 = letters[Math.floor(Math.random() * letters.length)];
  const c2 = letters[Math.floor(Math.random() * letters.length)];
  return `${nums}${c1}${c2}`;
}

// ----------------- NOVO LOGIN ELITE (VIA FLARESOLVERR) -----------------
// ✅ NOVO: Recebendo o proxyUrl como parâmetro
async function offoLogin(baseUrlRaw: string, username: string, password: string, proxyUrl: string, tz = TZ_SP) {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  
  let sessionId = null;
  let cookiesToExport = [];

  try {
      // 1. Criar Sessão no FlareSolverr com Máscara e Proxy Residencial
      // ✅ NOVO: Monta o payload de forma inteligente. Se tiver proxy no banco, ele usa!
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

      // 2. Fazer o Login via Javascript (Pula Cloudflare e entra no sistema)
      const loginAutomaticoRes = await fetch(FLARESOLVERR_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              cmd: "request.get",
              session: sessionId,
              url: `${baseUrl}/login`,
              maxTimeout: 60000,
              returnOnlyCookies: false, 
              evaluate: `
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
                  }, 5000);
                  setTimeout(() => {}, 15000);
              `
          })
      }).then(res => res.json());

      if (loginAutomaticoRes.status !== "ok") {
           throw new Error(`Falha ao tentar logar via script: ${loginAutomaticoRes.message}`);
      }

      const htmlAposLogin = loginAutomaticoRes.solution?.response || "";
      if (htmlAposLogin.toLowerCase().includes("just a moment") || htmlAposLogin.toLowerCase().includes("cf-turnstile")) {
          throw new Error("O Cloudflare travou este IP no desafio. Vá no Webshare e atualize no código.");
      }

      if (htmlAposLogin.includes('name="password"') && htmlAposLogin.includes('type="submit"')) {
          throw new Error("Login falhou (voltou para /login). Verifique usuário/senha.");
      }

      // 3. Exportar os Cookies Mágicos do FlareSolverr
      cookiesToExport = loginAutomaticoRes.solution?.cookies || [];

  } finally {
      // Sempre destruir a sessão do FlareSolverr após exportar
      if (sessionId) {
          await fetch(FLARESOLVERR_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cmd: "sessions.destroy", session: sessionId })
          }).catch(() => {});
      }
  }

  // 4. Transformar os Cookies do FlareSolverr para o fetchCookie
  const jar = new CookieJar();
  cookiesToExport.forEach((cookie: any) => {
      const cookieString = `${cookie.name}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}`;
      let domainBase = baseUrl.replace(/^https?:\/\//i, '');
      jar.setCookieSync(cookieString, `https://${domainBase}`);
  });

  const fc = fetchCookie(fetch, jar);

  return { fc, baseUrl, tz };
}

/**
 * ✅ IMPORTANTÍSSIMO:
 * Pega o CSRF dinamicamente (IPTV ou P2P)
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

  if (!csrf) throw new Error(`Não consegui obter CSRF de ${dashboardPath} após login.`);
  return csrf;
}

async function eliteFetch(fc: any, baseUrl: string, pathWithQuery: string, init: RequestInit, csrf: string, dashboardPath: string) {
  const url = baseUrl.replace(/\/+$/, "") + pathWithQuery;
  const refererUrl = `${baseUrl}${dashboardPath}`;

  const headers = new Headers(init.headers || {});
  headers.set("accept", headers.get("accept") || "application/json, text/plain, */*");
  headers.set("x-requested-with", "XMLHttpRequest");
  headers.set("origin", baseUrl);
  headers.set("referer", headers.get("referer") || refererUrl);
  headers.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36");
  headers.set("cache-control", headers.get("cache-control") || "no-cache");
  headers.set("pragma", headers.get("pragma") || "no-cache");

  if (csrf) headers.set("x-csrf-token", csrf);

  const finalInit: RequestInit = { ...init, headers, redirect: "follow" };
  return fc(url, finalInit);
}

// --- DataTables helper (AGORA DINÂMICO) ---
function buildDtQuery(searchValue: string, isP2P: boolean) {
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

  // ✅ Colunas mudam de acordo com o painel para não quebrar a busca
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
  const isP2PTextSearch = isP2P && !/^\d+$/.test(searchValue);
  const qs = buildDtQuery(isP2PTextSearch ? "" : searchValue, isP2P);
  
  const r = await eliteFetch(
    fc, baseUrl, `${dashboardPath}?${qs}`, { method: "GET", headers: { accept: "application/json, text/javascript, */*; q=0.01" } }, csrf, dashboardPath
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

    if (!isInternal) {
      const { data: userRes, error: userErr } = await sb.auth.getUser(token);
      if (userErr || !userRes?.user) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const tenantId = String(body?.tenant_id || "").trim();

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "tenant_id obrigatório no body." }, { status: 400 });
    }

    // 1. Busca Integração
    const { data: integ, error: integError } = await sb
      .from("server_integrations")
      .select("provider,is_active,api_token,api_secret,api_base_url,proxy_url") 
      .eq("id", integration_id)
      .eq("tenant_id", tenantId)
      .single();

    if (integError || !integ) throw new Error("Integração não encontrada.");
    if (!(integ as any).is_active) throw new Error("Integração inativa.");

    const isP2P = tech === "P2P";
    const dashboardPath = isP2P ? "/dashboard/p2p" : "/dashboard/iptv";
    
    const loginUser = String((integ as any).api_token || "").trim();
    const loginPass = String((integ as any).api_secret || "").trim();
    const baseUrl = String((integ as any).api_base_url || "").trim();
    // ✅ NOVO: Puxando o Proxy do banco
    const proxyUrl = String((integ as any).proxy_url || "").trim();

    // 2. Login Mágico
    // 1) Login (ou Login Mágico)
    const base = normalizeBaseUrl(baseUrl);
    // ✅ NOVO: Passando a variável proxyUrl que você extraiu do banco!
    const { fc } = await offoLogin(base, loginUser, loginPass, proxyUrl, TZ_SP);
    const csrf = await fetchCsrfFromDashboard(fc, base, dashboardPath);

    let real_external_id = external_user_id;
    const searchTarget = targetUsername || external_user_id;

    // Se o ID for texto puro (Nome), descobre o ID real primeiro com BUSCA EXATA
    if (isP2P && (!/^\d+$/.test(real_external_id) || real_external_id.length > 9)) {
       const fixTable = await findRowBySearch(fc, base, csrf, searchTarget, dashboardPath, isP2P);
       if (fixTable.ok && fixTable.rows?.length > 0) {
           const exMatch = fixTable.rows.find((r: any) => 
               String(r.name).toLowerCase() === searchTarget.toLowerCase() ||
               String(r.email).toLowerCase() === searchTarget.toLowerCase() ||
               String(r.exField2).toLowerCase() === searchTarget.toLowerCase() ||
               String(r.exField4).toLowerCase() === searchTarget.toLowerCase() ||
               String(r.username).toLowerCase() === searchTarget.toLowerCase()
           );
           
           if (exMatch) {
               real_external_id = String(exMatch.id);
           } else {
               real_external_id = String(fixTable.rows[0].id); // Último recurso
           }
       }
    }

    // 3. Busca os Detalhes da Conta
    const detailsApiPath = isP2P ? `/api/p2p/${real_external_id}` : `/api/iptv/${real_external_id}`;
    
    const detailsRes = await eliteFetch(fc, base, detailsApiPath, { method: "GET" }, csrf, dashboardPath);
    const detailsParsed = await readSafeBody(detailsRes);
    
    const details = detailsParsed.json ?? {};
    
    // 4. Captura Data e Senha
    let rawDateString = pickFirst(details, ["formatted_exp_date", "data.formatted_exp_date", "endTime", "data.endTime", "user.formatted_exp_date"]);
    let currentPassword = pickFirst(details, ["password", "exField2", "data.password", "data.exField2", "user.password"]);
    
    // BUSCA NA TABELA (Maior fidelidade - Trava Absoluta)
    const fallbackTable = await findRowBySearch(fc, base, csrf, searchTarget, dashboardPath, isP2P);
    
    if (fallbackTable.ok && fallbackTable.rows?.length > 0) {
       let row = null;

       if (isP2P) {
           row = fallbackTable.rows.find((r: any) => 
               String(r?.id) === String(real_external_id) ||
               String(r.name).toLowerCase() === searchTarget.toLowerCase() ||
               String(r.email).toLowerCase() === searchTarget.toLowerCase() ||
               String(r.exField2).toLowerCase() === searchTarget.toLowerCase() ||
               String(r.exField4).toLowerCase() === searchTarget.toLowerCase() ||
               String(r.username).toLowerCase() === searchTarget.toLowerCase()
           );
       } else {
           row = fallbackTable.rows.find((r: any) => String(r?.id) === String(real_external_id)) || fallbackTable.rows[0];
       }
       
       if (row) {
           real_external_id = String(row.id);

           if (row.formatted_exp_date || row.endTime) {
               rawDateString = row.formatted_exp_date || row.endTime;
           }
           if (!currentPassword) currentPassword = row.password || row.exField2;
       }
    }

    // 5. Converte para ISO com Inteligência Absoluta
    let finalExpIso = null;

    if (rawDateString) {
        const dStr = String(rawDateString).trim();
        
        // CENÁRIO A: Data PT-BR com Barras (ex: 20/03/2026 15:30) -> Padrão IPTV
        if (dStr.includes("/")) {
            finalExpIso = parseFormattedBrDateTimeToIso(dStr, TZ_SP);
        } 
        // CENÁRIO B: Data já em ISO UTC (ex: 2026-03-17T02:30:00.000000Z) -> Padrão P2P
        else if (dStr.includes("-") && dStr.includes("T")) {
            const d = new Date(dStr);
            if (!Number.isNaN(d.getTime())) {
                finalExpIso = d.toISOString();
            }
        }
    }

    // CENÁRIO C: Fallback extremo (Epoch Timestamp em segundos)
    if (!finalExpIso) {
      const rawExpDateNum = pickFirst(details, ["exp_date", "data.exp_date", "user.exp_date"]);
      if (typeof rawExpDateNum === "number" || (typeof rawExpDateNum === "string" && /^\d{10}$/.test(rawExpDateNum))) {
        finalExpIso = new Date(Number(rawExpDateNum) * 1000).toISOString();
      }
    }

    if (!finalExpIso) {
      console.error("DEBUG ELITE P2P/IPTV FALHA DATA:", { rawDateString, details });
      throw new Error("Não foi possível resgatar a data de vencimento da Elite.");
    }

    return NextResponse.json({
      ok: true,
      external_user_id: real_external_id,
      expires_at_iso: finalExpIso,
      exp_date: finalExpIso,
      password: currentPassword || undefined
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}