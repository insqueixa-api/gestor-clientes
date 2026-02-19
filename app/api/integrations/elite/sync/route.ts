import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CookieJar } from "tough-cookie";
import fetchCookie from "fetch-cookie";
import * as cheerio from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/** decodificação simples pro wire:snapshot (vem com &quot; etc) */
function decodeHtmlEntities(input: string) {
  return String(input || "")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function safeJsonParse<T = any>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function textFromHtml(html: string) {
  const $ = cheerio.load(html);
  return $("body").text().replace(/\s+/g, " ").trim();
}

// aceita: "63", "63,0", "63.0", "1.234,56", "1,234.56"
function parseLooseNumber(input: string): number | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const m = raw.match(/-?\d[\d.,]*/);
  if (!m) return null;

  let s = m[0];

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  // Se tem os dois, assume pt-BR: "." milhar e "," decimal
  if (hasDot && hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    s = s.replace(",", ".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// tenta achar saldo no texto (fallback)
function extractCredits(text: string): number | null {
  const t = text;

  const patterns = [
    /(saldo|cr[eé]ditos?|creditos?)\s*[:#]?\s*([-]?\d[\d.,]*)/i,
    /([-]?\d[\d.,]*)\s*(cr[eé]ditos?|creditos?)/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[2]) {
      const n = parseLooseNumber(m[2]);
      if (n != null) return n;
    }
    if (m?.[1] && /[-]?\d/.test(m[1])) {
      const n = parseLooseNumber(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}

// tenta achar owner id no texto (fallback)
function extractOwnerId(text: string): number | null {
  const t = text;

  const patterns = [
    /(owner\s*id|id\s*do\s*usu[aá]rio|usu[aá]rio\s*id)\s*[:#]?\s*(\d{1,18})/i,
    /\bOwner\b\s*\bID\b\s*[:#]?\s*(\d{1,18})/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    const candidate = m?.[2] || m?.[1];
    if (candidate && /^\d{1,18}$/.test(candidate)) {
      const n = Number(candidate);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

type EliteParsed = {
  user_id: number | null;
  owner_id: number | null;
  username: string | null;
  credits: number | null;
  email: string | null;
};

/**
 * ✅ Forma correta: parse do Livewire wire:snapshot
 * No /user/profile vem `data.state[0]` com { id, owner_id, username, credits, email, ... }
 */
function extractEliteFromLivewireSnapshot(html: string): EliteParsed | null {
  const $ = cheerio.load(html);

  const nodes = $("[wire\\:snapshot]").toArray();
  for (const n of nodes) {
    const raw = $(n).attr("wire:snapshot");
    if (!raw) continue;

    const decoded = decodeHtmlEntities(raw);
    const snap = safeJsonParse<any>(decoded);
    if (!snap) continue;

    const u = snap?.data?.state?.[0];
    if (!u || typeof u !== "object") continue;

    // heurística: precisa ter ao menos 2 desses campos pra considerar "perfil"
    const hasKey =
      ("id" in u) || ("owner_id" in u) || ("username" in u) || ("credits" in u) || ("email" in u);

    if (!hasKey) continue;

    const userId = Number.isFinite(Number(u.id)) ? Number(u.id) : null;
    const ownerId = Number.isFinite(Number(u.owner_id)) ? Number(u.owner_id) : null;

    const username = typeof u.username === "string" ? u.username.trim() : null;
    const email = typeof u.email === "string" ? u.email.trim() : null;

    // credits às vezes vem number, às vezes string
    const credits =
      typeof u.credits === "number"
        ? u.credits
        : (typeof u.credits === "string" ? parseLooseNumber(u.credits) : null);

    // se achou algo útil, retorna
    if (userId != null || ownerId != null || username || credits != null || email) {
      return { user_id: userId, owner_id: ownerId, username, credits, email };
    }
  }

  return null;
}

/** fallback extra: tenta pegar créditos do topo (#navbarCredits) */
function extractCreditsFromNavbar(html: string): number | null {
  const $ = cheerio.load(html);
  const t = $("#navbarCredits").text().trim();
  return parseLooseNumber(t);
}

async function offoLogin(baseUrlRaw: string, username: string, password: string, tz = "America/Sao_Paulo") {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);

  const jar = new CookieJar();
  const fc = fetchCookie(fetch, jar);

  const loginUrl = `${baseUrl}/login`;

  // 1) GET /login (pegar token CSRF)
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

async function fetchHtml(fc: any, url: string, referer?: string) {
  const r = await fc(url, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "Mozilla/5.0",
      ...(referer ? { referer } : {}),
    },
    redirect: "follow",
  });

  if (!r.ok) throw new Error(`Falha ao carregar ${url} (HTTP ${r.status}).`);
  return await r.text();
}

export async function POST(req: Request) {
  try {
    const { integration_id } = await req.json().catch(() => ({}));
    if (!integration_id) {
      return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });
    }

    const sb = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const { data: integ, error } = await sb
      .from("server_integrations")
      .select("id,tenant_id,provider,is_active,api_token,api_secret,api_base_url")
      .eq("id", integration_id)
      .single();

    if (error) throw error;
    if (!integ) throw new Error("Integração não encontrada.");
    if (String(integ.provider).toUpperCase() !== "ELITE") throw new Error("Integração não é ELITE.");
    if (!integ.is_active) throw new Error("Integração está inativa.");

    const loginUser = String(integ.api_token || "").trim();   // ELITE: usuário/email
    const loginPass = String(integ.api_secret || "").trim();  // ELITE: senha
    const baseUrl = String(integ.api_base_url || "").trim();

    if (!baseUrl || !loginUser || !loginPass) {
      throw new Error("ELITE exige api_base_url + usuário (api_token) + senha (api_secret).");
    }

    const { fc } = await offoLogin(baseUrl, loginUser, loginPass);

    const base = normalizeBaseUrl(baseUrl);
    const profileUrl = `${base}/user/profile`;
    const creditsUrl = `${base}/dashboard/logs-creditos`;

    // ✅ profile é a fonte principal (tem wire:snapshot com id/owner/credits/username)
    const profileHtml = await fetchHtml(fc, profileUrl, profileUrl);

    // tenta via snapshot
    const fromSnap = extractEliteFromLivewireSnapshot(profileHtml);

    // créditos pode vir também pelo topo (navbar) — ainda dentro do /user/profile
    const creditsFromNavbar = extractCreditsFromNavbar(profileHtml);

    // fallback secundário: página de logs de crédito (se necessário)
    let creditsHtml = "";
    let creditsText = "";
    if (!fromSnap?.credits && creditsFromNavbar == null) {
      creditsHtml = await fetchHtml(fc, creditsUrl, profileUrl);
      creditsText = textFromHtml(creditsHtml);
    }

    // fallback por texto (último recurso)
    const profileText = textFromHtml(profileHtml);

    const user_id = fromSnap?.user_id ?? null;
    const owner_id =
      fromSnap?.owner_id ??
      extractOwnerId(profileText) ??
      (creditsText ? extractOwnerId(creditsText) : null) ??
      null;

    const credits =
      (fromSnap?.credits ?? null) ??
      creditsFromNavbar ??
      extractCredits(profileText) ??
      (creditsText ? extractCredits(creditsText) : null) ??
      null;

    const panel_username = fromSnap?.username ?? null;
    const panel_email = fromSnap?.email ?? null;

    // ✅ Atualiza integração com o que achou
    const patch: any = {
      credits_last_sync_at: new Date().toISOString(),
      // melhor guardar o username REAL do painel quando existir; senão cai no login informado
      owner_username: (panel_username || loginUser),
    };

    if (owner_id != null) patch.owner_id = owner_id;
    if (credits != null) patch.credits_last_known = credits;

    await sb.from("server_integrations").update(patch).eq("id", integration_id);

    return NextResponse.json({
      ok: true,
      message: "ELITE OK. Sync atualizado.",
      parsed: {
        user_id,
        owner_id,
        username: panel_username,
        email: panel_email,
        credits,
      },
      saved: {
        owner_id: owner_id ?? null,
        owner_username: patch.owner_username,
        credits_last_known: credits ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Falha no sync ELITE." }, { status: 500 });
  }
}
