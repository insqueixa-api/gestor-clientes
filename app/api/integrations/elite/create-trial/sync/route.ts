// app/api/integrations/elite/create-trial/sync/route.ts
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

  // palpite inicial: interpretar local como UTC
  let utcMs = desiredAsIfUtc;

  // 2-3 iterações pra convergir mesmo em mudanças de offset (DST)
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
  // esperado: DD/MM/YYYY HH:mm (às vezes pode vir com segundos)
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

  if (!csrf) throw new Error(`Não consegui obter CSRF de ${dashboardPath} após login.`);
  return csrf;
}

async function eliteFetch(fc: any, baseUrl: string, pathWithQuery: string, init: RequestInit, csrf?: string, dashboardPath = "/dashboard/iptv") {
  const url = baseUrl.replace(/\/+$/, "") + pathWithQuery;
  const refererUrl = `${baseUrl}${dashboardPath}`;

  const headers = new Headers(init.headers || {});
  headers.set("accept", headers.get("accept") || "application/json, text/plain, */*");
  headers.set("x-requested-with", "XMLHttpRequest");
  headers.set("origin", baseUrl);
  headers.set("referer", headers.get("referer") || refererUrl);
  headers.set("user-agent", headers.get("user-agent") || "Mozilla/5.0");
  headers.set("cache-control", headers.get("cache-control") || "no-cache");
  headers.set("pragma", headers.get("pragma") || "no-cache");

  if (csrf) headers.set("x-csrf-token", csrf);

  const finalInit: RequestInit = { ...init, headers, redirect: "follow" };
  return fc(url, finalInit);
}

// --- DataTables helper (pra confirmar username e pegar formatted_exp_date, reseller_notes, etc) ---
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

async function findRowBySearch(fc: any, baseUrl: string, csrf: string, searchValue: string, dashboardPath: string) {
  const qs = buildDtQuery(searchValue);
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
  return { ok: true, rows: data as any[] };
}

function safeString(v: any) {
  const s = String(v ?? "").trim();
  return s;
}

// ----------------- handler -----------------
export async function POST(req: Request) {
  const trace: any[] = [];

  try {
    const token = getBearer(req);
    
    if (!token) return NextResponse.json({ ok: false, error: "Unauthorized (missing bearer)" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));

    const integration_id = safeString(body?.integration_id);
    const external_user_id = safeString(body?.external_user_id || body?.user_id || body?.elite_user_id);
    const tz = safeString(body?.tz) || TZ_SP;

    // ✅ Pega os dados originais que o front mandou (se existirem)
    const bodyDesiredUsername = safeString(body?.desired_username || body?.username);
    const bodyNotes = safeString(body?.notes);

    // por padrão, essa rota é feita pra usar 1x após criar trial
    const rename_from_notes = body?.rename_from_notes !== false; // default true

    if (!integration_id) return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });
    if (!external_user_id) return NextResponse.json({ ok: false, error: "external_user_id obrigatório." }, { status: 400 });

    // supabase service + valida usuário via JWT do client
    const sb = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const { data: userRes, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized (invalid bearer)" }, { status: 401 });
    }

    // carrega integração do banco
    const { data: integ, error } = await sb
      .from("server_integrations")
      .select("id,tenant_id,provider,is_active,api_token,api_secret,api_base_url") // ✅ Removido server_id
      .eq("id", integration_id)
      .single();

    if (error) throw error;
    if (!integ) throw new Error("Integração não encontrada.");

    const provider = String((integ as any).provider || "").toUpperCase().trim();
    if (provider !== "ELITE") throw new Error("Integração não é ELITE.");
    if (!(integ as any).is_active) throw new Error("Integração está inativa.");

    // ✅ VALIDAÇÃO DINÂMICA: IPTV ou P2P (Lendo direto do Body enviado pelo Front)
    const tech = String(body?.technology || "").trim().toUpperCase();
    if (tech !== "IPTV" && tech !== "P2P") {
      return NextResponse.json(
        { ok: false, error: `Tecnologia '${tech}' não suportada para sincronização neste painel.` },
        { status: 400 }
      );
    }

    // ✅ Variáveis de Roteamento P2P vs IPTV
    const isP2P = tech === "P2P";
    const dashboardPath = isP2P ? "/dashboard/p2p" : "/dashboard/iptv";
    const updateApiPath = isP2P ? `/api/p2p/update/${external_user_id}` : `/api/iptv/update/${external_user_id}`;
    const detailsApiPath = isP2P ? `/api/p2p/${external_user_id}` : `/api/iptv/${external_user_id}`;

    const loginUser = safeString(integ.api_token); // usuário/email
    const loginPass = safeString(integ.api_secret); // senha
    const baseUrl = safeString(integ.api_base_url);

    if (!baseUrl || !loginUser || !loginPass) {
      throw new Error("ELITE exige api_base_url + usuário (api_token) + senha (api_secret).");
    }

    const base = normalizeBaseUrl(baseUrl);

    // 1) login
    const { fc } = await offoLogin(base, loginUser, loginPass, tz);
    trace.push({ step: "login", ok: true });

    // 2) csrf pós-login (Dinâmico)
    const csrf = await fetchCsrfFromDashboard(fc, base, dashboardPath);
    trace.push({ step: "csrf_dashboard", path: dashboardPath, ok: true });

    // 3) details by ID (Dinâmico)
    const detailsRes = await eliteFetch(
      fc,
      base,
      detailsApiPath,
      { method: "GET", headers: { accept: "application/json" } },
      csrf,
      dashboardPath
    );

    const detailsParsed = await readSafeBody(detailsRes);
    trace.push({
      step: "details_before",
      status: detailsRes.status,
      ct: detailsRes.headers.get("content-type"),
      preview: String(detailsParsed.text || "").slice(0, 250),
    });

    if (!detailsRes.ok) {
      const hint = looksLikeLoginHtml(detailsParsed.text) ? " (parece redirect/login → CSRF/referer)" : "";
      return NextResponse.json(
        {
          ok: false,
          error: `Elite details failed${hint}`,
          trace,
          details_preview: String(detailsParsed.text || "").slice(0, 900),
        },
        { status: 502 }
      );
    }

    const details = detailsParsed.json ?? {};

    // ✅ No P2P o "username" também pode vir em "name" ou "email". A senha pode vir em "exField2"
    const currentUsername =
      pickFirst(details, ["username", "name", "email", "data.username", "data.name", "user.username"]) ?? "";

    const currentPassword =
      pickFirst(details, ["password", "exField2", "data.password", "data.exField2", "user.password"]) ?? "";

    const notesFromDetails =
      pickFirst(details, ["reseller_notes", "trialnotes", "data.reseller_notes", "data.trialnotes", "user.reseller_notes", "user.trialnotes"]) ?? "";

    let bouquetsRaw =
      pickFirst(details, ["bouquet", "bouquets", "bouquet_ids", "data.bouquet", "data.bouquets", "data.bouquet_ids", "pacote", "data.pacote"]) ?? [];
    
    // Evita falhas caso o painel retorne os pacotes em string JSON ou objeto em vez de array puro
    if (typeof bouquetsRaw === 'string') {
      try { bouquetsRaw = JSON.parse(bouquetsRaw); } catch(e) {}
    }
    if (bouquetsRaw && typeof bouquetsRaw === 'object' && !Array.isArray(bouquetsRaw)) {
      bouquetsRaw = Object.values(bouquetsRaw);
    }

    let bouquets: string[] = Array.isArray(bouquetsRaw) ? bouquetsRaw.map((x) => String(x)) : [];

    // ✅ BLINDAGEM MÁXIMA: Se não conseguiu ler os pacotes do painel, aplica a GRADE COMPLETA que você capturou
    if (bouquets.length === 0 && !isP2P) {
      bouquets = ["19", "68", "30", "76", "51", "66", "62", "27", "20", "75"];
    }

    // 4) também tenta pegar o row do DataTables (pra pegar formatted_exp_date e confirmar valores)
    // tenta primeiro pelo próprio ID (muitos painéis retornam o row), senão pelo username atual
    let rowFromTable: any = null;

    const tableById = await findRowBySearch(fc, base, csrf, String(external_user_id), dashboardPath);
    trace.push({ step: "datatable_by_id", ok: tableById.ok, count: tableById.rows?.length ?? 0 });
    if (tableById.ok && tableById.rows?.length) {
      rowFromTable = tableById.rows.find((r: any) => String(r?.id) === String(external_user_id)) || tableById.rows[0];
    } else if (currentUsername) {
      const tableByUser = await findRowBySearch(fc, base, csrf, String(currentUsername), dashboardPath);
      trace.push({ step: "datatable_by_username", ok: tableByUser.ok, count: tableByUser.rows?.length ?? 0 });
      if (tableByUser.ok && tableByUser.rows?.length) {
        rowFromTable = tableByUser.rows.find((r: any) => String(r?.id) === String(external_user_id)) || tableByUser.rows[0];
      }
    }

    // ✅ fonte "final" das notas (AGORA prioriza o que veio do front-end)
    const notes =
      bodyNotes ||
      safeString(notesFromDetails) ||
      safeString(rowFromTable?.reseller_notes) ||
      safeString(rowFromTable?.trialnotes);

    // fonte "final" do vencimento em texto SP (prioriza datatable: formatted_exp_date)
    const expSpText =
      safeString(rowFromTable?.formatted_exp_date) ||
      safeString(pickFirst(details, ["formatted_exp_date", "data.formatted_exp_date", "user.formatted_exp_date"])) ||
      "";

    const expIso =
      (expSpText ? parseFormattedBrDateTimeToIso(expSpText, tz) : null) ||
      // fallback (caso venha ISO ou algo parseável)
      (() => {
        const v =
          pickFirst(details, ["exp_date", "data.exp_date", "user.exp_date", "expires_at", "data.expires_at"]) ?? null;
        if (!v) return null;
        const d = new Date(String(v));
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString();
      })();

    // ✅ 5) Determina o nome de usuário desejado (prioriza o que o front enviou!)
    let desiredUsername = bodyDesiredUsername ? normalizeUsernameFromNotes(bodyDesiredUsername) : normalizeUsernameFromNotes(notes);

    // ✅ LÓGICA DE BLINDAGEM: Adiciona 3 números e garante mínimo de 12 caracteres
    if (desiredUsername) {
      const random3 = Math.floor(100 + Math.random() * 900).toString(); // Gera 3 números aleatórios
      desiredUsername = `${desiredUsername}${random3}`;

      // Se ainda tiver menos de 12, preenche com mais números até dar 12
      if (desiredUsername.length < 12) {
        const paddingNeeded = 12 - desiredUsername.length;
        const padding = Math.floor(Math.random() * Math.pow(10, paddingNeeded))
          .toString()
          .padStart(paddingNeeded, "0");
        desiredUsername = `${desiredUsername}${padding}`;
      }

      // Limita a 32 caracteres para não estourar o limite do painel
      desiredUsername = desiredUsername.slice(0, 32);
    }

    const canRename =
      rename_from_notes &&
      !!desiredUsername &&
      desiredUsername !== String(currentUsername || "").trim();

    trace.push({
      step: "plan",
      rename_from_notes,
      notes_preview: notes?.slice(0, 60) || "",
      currentUsername: String(currentUsername || ""),
      desiredUsername,
      canRename,
      expSpText,
      expIso,
    });

    let updatedUsername = String(currentUsername || "");
    let didUpdate = false;

    if (canRename) {
      const updForm = new FormData();

      if (isP2P) {
        // ✅ FORMULÁRIO DO P2P
        updForm.set("id", String(external_user_id));
        updForm.set("usernamex", desiredUsername);
        updForm.set("name", desiredUsername);
        updForm.set("passwordx", String(currentPassword || rowFromTable?.password || ""));
        
        if (notes) {
          updForm.set("reseller_notes", notes);
        }

        // P2P usa pacote no singular (Ex: "1")
        const p2pPacote = (typeof bouquetsRaw === 'string' || typeof bouquetsRaw === 'number') ? String(bouquetsRaw) : (bouquets.length > 0 ? bouquets[0] : "1");
        updForm.set("pacote", p2pPacote);

      } else {
        // ✅ FORMULÁRIO DO IPTV
        updForm.set("user_id", String(external_user_id));
        updForm.set("usernamex", desiredUsername);
        updForm.set("passwordx", String(currentPassword || rowFromTable?.password || ""));

        if (notes) {
          updForm.set("reseller_notes", notes);
        }

        for (const b of bouquets) {
          updForm.append("bouquet[]", String(b));
        }
      }

      const updRes = await eliteFetch(
        fc,
        base,
        updateApiPath, // ✅ Dinâmico
        { method: "POST", headers: { accept: "application/json" }, body: updForm },
        csrf,
        dashboardPath
      );

      const updParsed = await readSafeBody(updRes);
      trace.push({
        step: "update_username",
        status: updRes.status,
        ct: updRes.headers.get("content-type"),
        preview: String(updParsed.text || "").slice(0, 250),
      });

      const updText = String(updParsed.text || "");
      const updLooksLogin = looksLikeLoginHtml(updText) || /<html/i.test(updText);

      if (!updRes.ok || updLooksLogin) {
        // update falhou → devolve sync com dados atuais (sem quebrar fluxo)
        return NextResponse.json({
          ok: true,
          provider: "ELITE",
          synced: true,
          renamed: false,
          external_user_id: String(external_user_id),
          notes,
          username: String(currentUsername || ""),
          server_username: String(currentUsername || ""),
          password: String(currentPassword || rowFromTable?.password || ""),
          expires_at_sp: expSpText || null,
          expires_at_iso: expIso || null,
          note: "Update de username não confirmou (status/HTML). Mantive sync sem renomear.",
          trace,
          update_preview: updText.slice(0, 900),
          update_json: updParsed.json ?? null,
        });
      }

      // Confirmação real: re-buscar DataTables pelo desiredUsername e casar pelo id
      const afterTable = await findRowBySearch(fc, base, csrf, desiredUsername, dashboardPath);
      trace.push({ step: "datatable_after_update", ok: afterTable.ok, count: afterTable.rows?.length ?? 0 });

      if (afterTable.ok && afterTable.rows?.length) {
        const match = afterTable.rows.find((r: any) => String(r?.id) === String(external_user_id)) || afterTable.rows[0];
        const updatedName = match?.username || match?.name || match?.email;
        if (updatedName) updatedUsername = String(updatedName);
      }

      didUpdate = updatedUsername === desiredUsername;
    }

    // 6) Re-busca detalhes (pra ter a fonte “oficial” pós-update) + tenta pegar exp_date de novo
    const detailsRes2 = await eliteFetch(
      fc,
      base,
      detailsApiPath, // ✅ Dinâmico
      { method: "GET", headers: { accept: "application/json" } },
      csrf,
      dashboardPath
    );

    const detailsParsed2 = await readSafeBody(detailsRes2);
    trace.push({
      step: "details_after",
      status: detailsRes2.status,
      ct: detailsRes2.headers.get("content-type"),
      preview: String(detailsParsed2.text || "").slice(0, 250),
    });

    const details2 = detailsParsed2.json ?? details;
    
    // ✅ Extrai nome do P2P ou IPTV
    let finalUsername =
      safeString(pickFirst(details2, ["username", "name", "email", "data.username", "data.name", "user.username"])) ||
      safeString(updatedUsername) ||
      safeString(currentUsername);

    // ✅ GARANTIA DO E-MAIL: Remove a parte do provedor para o seu Gestor receber o nome limpo
    if (finalUsername.includes("@")) {
      finalUsername = finalUsername.split("@")[0];
    }

    const finalPassword =
      safeString(pickFirst(details2, ["password", "exField2", "data.password", "data.exField2", "user.password"])) ||
      safeString(currentPassword) ||
      safeString(rowFromTable?.password);

    // tenta pegar o row novamente (pra pegar formatted_exp_date atualizado)
    let finalRow: any = rowFromTable;
    if (finalUsername) {
      const t = await findRowBySearch(fc, base, csrf, finalUsername, dashboardPath);
      trace.push({ step: "datatable_final", ok: t.ok, count: t.rows?.length ?? 0 });
      if (t.ok && t.rows?.length) {
        finalRow = t.rows.find((r: any) => String(r?.id) === String(external_user_id)) || t.rows[0];
      }
    }

    const finalExpSpText =
      safeString(finalRow?.formatted_exp_date) ||
      safeString(pickFirst(details2, ["formatted_exp_date", "data.formatted_exp_date", "user.formatted_exp_date"])) ||
      expSpText ||
      "";

    // ✅ AJUSTE DE VENCIMENTO: Tenta capturar o Timestamp Unix absoluto (em segundos) que a API devolve.
    // Isso evita 100% de erros de fuso horário.
    let finalExpIso = null;
    const rawExpDateNum = pickFirst(details2, ["exp_date", "data.exp_date", "user.exp_date"]);
    
    if (typeof rawExpDateNum === "number" || (typeof rawExpDateNum === "string" && /^\d{10}$/.test(rawExpDateNum))) {
      finalExpIso = new Date(Number(rawExpDateNum) * 1000).toISOString();
    } else {
      finalExpIso = (finalExpSpText ? parseFormattedBrDateTimeToIso(finalExpSpText, tz) : null) || expIso || null;
    }

    return NextResponse.json({
      ok: true,
      provider: "ELITE",
      synced: true,
      renamed: didUpdate,
      external_user_id: String(external_user_id),

      // ✅ notas que foram usadas pra gerar o username “bonito”
      notes: notes || null,
      desired_username_from_notes: desiredUsername || null,

      // ✅ devolve username final (o que o servidor ficou)
      username: finalUsername,
      server_username: finalUsername,

      // ✅ devolve password atual
      password: finalPassword,

      // ✅ devolve vencimento em texto (SP) + ISO (UTC) pronto pra gravar em timestamptz
      expires_at_sp: finalExpSpText || null,
      expires_at_iso: finalExpIso,
      exp_date: finalExpIso, // ✅ ESSENCIAL: O front-end precisa receber essa chave

      trace,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error", trace: trace.slice(-10) }, { status: 500 });
  }
}