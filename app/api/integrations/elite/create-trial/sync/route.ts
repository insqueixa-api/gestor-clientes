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

function normalizeUsernameFromNotes(notesRaw: unknown) {
  const raw = String(notesRaw ?? "").trim();
  if (!raw) return "";
  const noDiacritics = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = noDiacritics.replace(/\s+/g, "").replace(/[^a-zA-Z0-9_.-]/g, "");
  return cleaned.slice(0, 32);
}

type TZParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function getPartsInTimeZone(d: Date, tz: string): TZParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = dtf.formatToParts(d);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value || "0");
  return { year: pick("year"), month: pick("month"), day: pick("day"), hour: pick("hour"), minute: pick("minute"), second: pick("second") };
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
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  const hour = Number(m[4]), minute = Number(m[5]), second = m[6] ? Number(m[6]) : 0;
  const utcMs = zonedLocalToUtcMs({ year, month, day, hour, minute, second }, tz);
  return new Date(utcMs).toISOString();
}

function safeString(v: any) {
  return String(v ?? "").trim();
}

// ----------------- tipos -----------------
type Fsolverr = (
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; text: string; json: any }>;

type OffoLoginResult = {
  sessionId: string;
  fsolverr: Fsolverr;
  postLoginHtml: string;
};

// ----------------- LOGIN ELITE VIA FLARESOLVERR -----------------
async function offoLogin(
  baseUrlRaw: string,
  username: string,
  password: string,
  proxyUrl: string
): Promise<OffoLoginResult> {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  let sessionId: string | null = null;
  let postLoginHtml = "";

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

    // 2. Login via JS inject — idêntico ao sync de créditos que funciona
    // O evaluate clica em 5s e aguarda 15s para garantir login + redirect + dashboard carregado
    const loginRes = await fetch(FLARESOLVERR_URL, {
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
          }, 5000);
          setTimeout(() => { resolve(); }, 15000);
        });`,
      }),
    }).then((r) => r.json());

    if (loginRes.status !== "ok") throw new Error(`Falha ao logar via script: ${loginRes.message}`);

    // O HTML retornado já é o dashboard pós-login (com CSRF token)
    postLoginHtml = loginRes.solution?.response || "";

    // 3. Busca o profile — exatamente como o sync de créditos faz
    // O evaluate aguarda 8s para o dashboard carregar completamente
    const profileRes = await fetch(FLARESOLVERR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: "request.get",
        session: sessionId,
        url: `${baseUrl}/user/profile`,
        maxTimeout: 60000,
        evaluate: `new Promise((resolve) => {
          setTimeout(() => { resolve(); }, 8000);
        });`,
      }),
    }).then((r) => r.json());

    postLoginHtml = profileRes.solution?.response || "";

    // 4. Valida se realmente logou
    if (postLoginHtml.toLowerCase().includes("just a moment") || postLoginHtml.toLowerCase().includes("cf-turnstile")) {
      throw new Error("O Cloudflare travou este IP. Atualize o proxy residencial nas configurações da integração.");
    }
    if (postLoginHtml.includes('name="password"') && postLoginHtml.includes('type="submit"')) {
      throw new Error("Login falhou (voltou para /login). Verifique usuário/senha.");
    }

  } catch (err) {
    throw err;
  }

  // 4. Helper — TODAS as requests via FlareSolverr (mesma sessão, mesmo TLS)
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

  return { sessionId: sessionId!, fsolverr, postLoginHtml };
}

// --- DataTables helper ---
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

async function findRowBySearch(fsolverr: Fsolverr, csrf: string, searchValue: string, dashboardPath: string, isP2P: boolean) {
  const qs = buildDtQuery(searchValue, isP2P);
  const r = await fsolverr(`${dashboardPath}?${qs}`, {
    method: "GET",
    headers: {
      "accept": "application/json, text/javascript, */*; q=0.01",
      "x-csrf-token": csrf,
      "x-requested-with": "XMLHttpRequest",
    },
  });

  if (!r.ok) return { ok: false, status: r.status, rows: [] as any[], raw: r.text?.slice(0, 900) || "" };
  const data = r.json?.data;
  if (!Array.isArray(data)) return { ok: true, rows: [] as any[] };
  return { ok: true, rows: data as any[] };
}

// ----------------- handler -----------------
export async function POST(req: Request) {
  const trace: any[] = [];
  let eliteSessionId: string | null = null;

  try {
    const token = getBearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "Unauthorized (missing bearer)" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));

    let integration_id = safeString(body?.integration_id);
    let external_user_id = safeString(body?.external_user_id || body?.user_id || body?.elite_user_id);
    let tech = String(body?.technology || "").trim().toUpperCase();
    const tz = safeString(body?.tz) || TZ_SP;

    const bodyDesiredUsername = safeString(body?.desired_username || body?.username || body?.notes);
    const bodyNotes = safeString(body?.notes);
    const client_id = safeString(body?.client_id || body?.id);
    const server_username = safeString(body?.server_username);
    let bodyPassword = safeString(body?.password);
    const rename_from_notes = body?.rename_from_notes !== false;

    const sb = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const { data: userRes, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized (invalid bearer)" }, { status: 401 });
    }

    if (!external_user_id && (client_id || server_username)) {
      let query = sb.from("clients").select("external_user_id, server_id, technology");
      if (client_id) query = query.eq("id", client_id);
      else if (server_username) query = query.eq("server_username", server_username).order("created_at", { ascending: false }).limit(1);
      const { data: clientData } = await query.single();
      if (clientData) {
        external_user_id = external_user_id || clientData.external_user_id;
        integration_id = integration_id || clientData.server_id;
        tech = tech || String(clientData.technology).toUpperCase();
      }
    }

    if (!integration_id) return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });

    const { data: integ, error: integError } = await sb
      .from("server_integrations")
      .select("id,tenant_id,provider,is_active,api_token,api_secret,api_base_url,proxy_url")
      .eq("id", integration_id)
      .single();

    if (integError || !integ) throw new Error("Integração não encontrada.");

    const provider = String((integ as any).provider || "").toUpperCase().trim();
    if (provider !== "ELITE") throw new Error("Integração não é ELITE.");
    if (!(integ as any).is_active) throw new Error("Integração está inativa.");

    if (tech !== "IPTV" && tech !== "P2P") {
      return NextResponse.json(
        { ok: false, error: `Tecnologia '${tech}' não suportada.` },
        { status: 400 }
      );
    }

    const isP2P = tech === "P2P";
    const dashboardPath = isP2P ? "/dashboard/p2p" : "/dashboard/iptv";
    let real_external_id = external_user_id;

    const loginUser = String((integ as any).api_token || "").trim();
    const loginPass = String((integ as any).api_secret || "").trim();
    const baseUrl = String((integ as any).api_base_url || "").trim();
    const proxyUrl = String((integ as any).proxy_url || "").trim();

    if (!baseUrl || !loginUser || !loginPass) {
      throw new Error("ELITE exige api_base_url + usuário (api_token) + senha (api_secret).");
    }

    const base = normalizeBaseUrl(baseUrl);

    // 1) Login — idêntico ao sync de créditos que funciona
    const { sessionId: sid, fsolverr, postLoginHtml } = await offoLogin(base, loginUser, loginPass, proxyUrl);
    eliteSessionId = sid;
    trace.push({ step: "login", ok: true });

    // 2) CSRF — extraído do HTML do dashboard já capturado durante o login (sem request extra)
    const $csrf = cheerio.load(postLoginHtml);
    const csrf = (
      $csrf('meta[name="csrf-token"]').attr("content") ||
      $csrf('input[name="_token"]').attr("value") ||
      ""
    ).trim();
    if (!csrf) throw new Error(`Não consegui obter CSRF do HTML pós-login.`);
    trace.push({ step: "csrf_dashboard", csrf_preview: csrf.slice(0, 10) + "...", ok: true });

    // 3) Corrige ID falso do P2P
    if (isP2P && (!/^\d+$/.test(real_external_id) || real_external_id.length > 9)) {
      const fixTable = await findRowBySearch(fsolverr, csrf, real_external_id, dashboardPath, isP2P);
      if (fixTable.ok && fixTable.rows?.length > 0) {
        real_external_id = String(fixTable.rows[0].id);
        trace.push({ step: "id_fixed", old: external_user_id, new: real_external_id });
      }
    }

    const updateApiPath = isP2P ? `/api/p2p/update/${real_external_id}` : `/api/iptv/update/${real_external_id}`;
    const detailsApiPath = isP2P ? `/api/p2p/${real_external_id}` : `/api/iptv/${real_external_id}`;

    // 4) Details antes do update
    const detailsRaw = await fsolverr(detailsApiPath, {
      method: "GET",
      headers: { "accept": "application/json", "x-csrf-token": csrf, "x-requested-with": "XMLHttpRequest" },
    });

    trace.push({ step: "details_before", status: detailsRaw.status, preview: detailsRaw.text.slice(0, 250) });

    if (!detailsRaw.ok) {
      const hint = looksLikeLoginHtml(detailsRaw.text) ? " (parece redirect/login → CSRF/referer)" : "";
      return NextResponse.json(
        { ok: false, error: `Elite details failed${hint}`, trace, details_preview: detailsRaw.text.slice(0, 900) },
        { status: 502 }
      );
    }

    const details = detailsRaw.json ?? {};

    const currentUsername = pickFirst(details, ["username", "name", "email", "data.username", "data.name", "user.username"]) ?? "";
    const currentPassword = pickFirst(details, ["password", "exField2", "data.password", "data.exField2", "user.password"]) ?? "";
    const notesFromDetails = pickFirst(details, ["reseller_notes", "trialnotes", "data.reseller_notes", "data.trialnotes"]) ?? "";

    let bouquetsRaw = pickFirst(details, ["bouquet", "bouquets", "bouquet_ids", "data.bouquet", "data.bouquets", "pacote", "data.pacote"]) ?? [];
    if (typeof bouquetsRaw === "string") { try { bouquetsRaw = JSON.parse(bouquetsRaw); } catch (e) {} }
    if (bouquetsRaw && typeof bouquetsRaw === "object" && !Array.isArray(bouquetsRaw)) bouquetsRaw = Object.values(bouquetsRaw);
    let bouquets: string[] = Array.isArray(bouquetsRaw) ? bouquetsRaw.map((x) => String(x)) : [];
    if (bouquets.length === 0 && !isP2P) bouquets = ["19", "68", "30", "76", "51", "66", "62", "27", "20", "75"];

    // 5) DataTable lookup
    let rowFromTable: any = null;
    const tableById = await findRowBySearch(fsolverr, csrf, String(external_user_id), dashboardPath, isP2P);
    trace.push({ step: "datatable_by_id", ok: tableById.ok, count: tableById.rows?.length ?? 0 });

    if (tableById.ok && tableById.rows?.length) {
      rowFromTable = tableById.rows.find((r: any) => String(r?.id) === String(external_user_id)) || tableById.rows[0];
    } else if (currentUsername) {
      const tableByUser = await findRowBySearch(fsolverr, csrf, String(currentUsername), dashboardPath, isP2P);
      trace.push({ step: "datatable_by_username", ok: tableByUser.ok, count: tableByUser.rows?.length ?? 0 });
      if (tableByUser.ok && tableByUser.rows?.length) {
        rowFromTable = tableByUser.rows.find((r: any) => String(r?.id) === String(external_user_id)) || tableByUser.rows[0];
      }
    }

    const notes = bodyNotes || safeString(notesFromDetails) || safeString(rowFromTable?.reseller_notes) || safeString(rowFromTable?.trialnotes);

    const expSpText =
      safeString(rowFromTable?.formatted_exp_date) ||
      safeString(pickFirst(details, ["formatted_exp_date", "data.formatted_exp_date", "user.formatted_exp_date"])) || "";

    const expIso =
      (expSpText ? parseFormattedBrDateTimeToIso(expSpText, tz) : null) ||
      (() => {
        const v = pickFirst(details, ["exp_date", "data.exp_date", "user.exp_date", "expires_at", "data.expires_at"]) ?? null;
        if (!v) return null;
        const d = new Date(String(v));
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      })();

    // 6) Determina username desejado
    let desiredUsername = bodyDesiredUsername ? normalizeUsernameFromNotes(bodyDesiredUsername) : normalizeUsernameFromNotes(notes);
    if (desiredUsername && desiredUsername.length < 12) {
      const paddingNeeded = 12 - desiredUsername.length;
      const randomPadding = Math.floor(Math.random() * Math.pow(10, paddingNeeded)).toString().padStart(paddingNeeded, "0");
      desiredUsername = `${desiredUsername}${randomPadding}`;
    }
    if (desiredUsername) desiredUsername = desiredUsername.slice(0, 32);

    const canRename = rename_from_notes && !!desiredUsername && desiredUsername !== String(currentUsername || "").trim();

    trace.push({ step: "plan", rename_from_notes, notes_preview: notes?.slice(0, 60) || "", currentUsername: String(currentUsername || ""), desiredUsername, canRename, expSpText, expIso });

    let updatedUsername = String(currentUsername || "");
    let didUpdate = false;
    let generatedP2pPassword = "";

    // 7) Update
    if (canRename) {
      const formBody = new URLSearchParams();

      if (isP2P) {
        formBody.set("id", String(external_user_id));
        formBody.set("usernamex", desiredUsername);
        let nums = "";
        for (let i = 0; i < 12; i++) nums += Math.floor(Math.random() * 10).toString();
        const letters = "abcdefghijklmnopqrstuvwxyz";
        generatedP2pPassword = `${nums}${letters[Math.floor(Math.random() * letters.length)]}${letters[Math.floor(Math.random() * letters.length)]}`;
        formBody.set("passwordx", generatedP2pPassword);
        formBody.set("name", desiredUsername);
        formBody.set("reseller_notes", desiredUsername);
        formBody.set("pacote", "1");
      } else {
        formBody.set("user_id", String(external_user_id));
        formBody.set("usernamex", desiredUsername);
        const iptvPassword = String(bodyPassword || currentPassword || rowFromTable?.password || "").trim();
        formBody.set("passwordx", iptvPassword);
        if (notes) formBody.set("reseller_notes", notes);
        for (const b of bouquets) formBody.append("bouquet[]", String(b));
      }

      const updRaw = await fsolverr(updateApiPath, {
        method: "POST",
        headers: {
          "accept": "application/json",
          "x-csrf-token": csrf,
          "x-requested-with": "XMLHttpRequest",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formBody.toString(),
      });

      trace.push({ step: "update_username", status: updRaw.status, preview: updRaw.text.slice(0, 250) });

      const updLooksLogin = looksLikeLoginHtml(updRaw.text) || /<html/i.test(updRaw.text);

      if (!updRaw.ok || updLooksLogin) {
        return NextResponse.json({
          ok: true, provider: "ELITE", synced: true, renamed: false,
          external_user_id: String(external_user_id), notes,
          username: String(currentUsername || ""), server_username: String(currentUsername || ""),
          password: String(currentPassword || rowFromTable?.password || ""),
          expires_at_sp: expSpText || null, expires_at_iso: expIso || null,
          note: "Update de username não confirmou. Mantive sync sem renomear.",
          trace, update_preview: updRaw.text.slice(0, 900), update_json: updRaw.json ?? null,
        });
      }

      const afterTable = await findRowBySearch(fsolverr, csrf, desiredUsername, dashboardPath, isP2P);
      trace.push({ step: "datatable_after_update", ok: afterTable.ok, count: afterTable.rows?.length ?? 0 });

      if (afterTable.ok && afterTable.rows?.length) {
        const match = afterTable.rows.find((r: any) => String(r?.id) === String(external_user_id)) || afterTable.rows[0];
        const updatedName = match?.username || match?.name || match?.email;
        if (updatedName) updatedUsername = String(updatedName);
      }

      didUpdate = updatedUsername === desiredUsername;
    }

    // 8) Details pós-update
    const detailsRaw2 = await fsolverr(detailsApiPath, {
      method: "GET",
      headers: { "accept": "application/json", "x-csrf-token": csrf, "x-requested-with": "XMLHttpRequest" },
    });

    trace.push({ step: "details_after", status: detailsRaw2.status, preview: detailsRaw2.text.slice(0, 250) });

    const details2 = detailsRaw2.json ?? details;

    let finalUsername =
      safeString(pickFirst(details2, ["username", "name", "email", "data.username", "data.name", "user.username"])) ||
      safeString(updatedUsername) || safeString(currentUsername);
    if (finalUsername.includes("@")) finalUsername = finalUsername.split("@")[0];

    const finalPassword =
      safeString(generatedP2pPassword) ||
      safeString(pickFirst(details2, ["password", "exField2", "data.password", "data.exField2", "user.password"])) ||
      safeString(currentPassword) ||
      safeString(rowFromTable?.password) ||
      safeString(bodyPassword);

    let finalRow: any = rowFromTable;
    if (finalUsername) {
      const t = await findRowBySearch(fsolverr, csrf, finalUsername, dashboardPath, isP2P);
      trace.push({ step: "datatable_final", ok: t.ok, count: t.rows?.length ?? 0 });
      if (t.ok && t.rows?.length) {
        finalRow = t.rows.find((r: any) => String(r?.id) === String(external_user_id)) || t.rows[0];
      }
    }

    const finalExpSpText =
      safeString(finalRow?.formatted_exp_date) ||
      safeString(pickFirst(details2, ["formatted_exp_date", "data.formatted_exp_date", "user.formatted_exp_date"])) ||
      expSpText || "";

    let finalExpIso = null;
    const rawExpDateNum = pickFirst(details2, ["exp_date", "data.exp_date", "user.exp_date"]);
    if (typeof rawExpDateNum === "number" || (typeof rawExpDateNum === "string" && /^\d{10}$/.test(rawExpDateNum))) {
      finalExpIso = new Date(Number(rawExpDateNum) * 1000).toISOString();
    } else {
      finalExpIso = (finalExpSpText ? parseFormattedBrDateTimeToIso(finalExpSpText, tz) : null) || expIso || null;
    }

    return NextResponse.json({
      ok: true, provider: "ELITE", synced: true, renamed: didUpdate,
      external_user_id: String(external_user_id), notes: notes || null,
      desired_username_from_notes: desiredUsername || null,
      username: finalUsername, server_username: finalUsername, password: finalPassword,
      expires_at_sp: finalExpSpText || null, expires_at_iso: finalExpIso, exp_date: finalExpIso,
      trace,
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error", trace: trace.slice(-10) }, { status: 500 });
  } finally {
    if (eliteSessionId) {
      await fetch(FLARESOLVERR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "sessions.destroy", session: eliteSessionId }),
      }).catch(() => {});
    }
  }
}
