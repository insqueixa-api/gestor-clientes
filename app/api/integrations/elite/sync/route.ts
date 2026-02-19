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

function textFromHtml(html: string) {
  const $ = cheerio.load(html);
  return $("body").text().replace(/\s+/g, " ").trim();
}

// aceita: "63", "63,0", "63.0", "1.234,56", "1,234.56"
function parseLooseNumber(input: string): number | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  // pega só o primeiro bloco numérico "parecido"
  const m = raw.match(/-?\d[\d.,]*/);
  if (!m) return null;

  let s = m[0];

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  // Se tem os dois, assume pt-BR: "." milhar e "," decimal
  if (hasDot && hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    // "63,0" => "63.0"
    s = s.replace(",", ".");
  } else {
    // "63.0" já ok, "1234" ok
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// tenta achar saldo no texto
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

// tenta achar owner id no texto
function extractOwnerId(text: string): number | null {
  const t = text;

  const patterns = [
    /(owner\s*id|id\s*do\s*usu[aá]rio|usu[aá]rio\s*id)\s*[:#]?\s*(\d{1,18})/i,
    /\bID\b\s*[:#]?\s*(\d{1,18})/i,
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

    const username = String(integ.api_token || "").trim();   // ELITE: usuário
    const password = String(integ.api_secret || "").trim();  // ELITE: senha
    const baseUrl = String(integ.api_base_url || "").trim();

    if (!baseUrl || !username || !password) {
      throw new Error("ELITE exige api_base_url + usuário (api_token) + senha (api_secret).");
    }

    const { fc } = await offoLogin(baseUrl, username, password);

    // tenta extrair dados do profile e do log de créditos
    const profileUrl = `${normalizeBaseUrl(baseUrl)}/user/profile`;
    const creditsUrl = `${normalizeBaseUrl(baseUrl)}/dashboard/logs-creditos`;

    const profileHtml = await fetchHtml(fc, profileUrl, profileUrl);
    const creditsHtml = await fetchHtml(fc, creditsUrl, profileUrl);

    const profileText = textFromHtml(profileHtml);
    const creditsText = textFromHtml(creditsHtml);

    const ownerId = extractOwnerId(profileText) ?? extractOwnerId(creditsText);
    const credits = extractCredits(profileText) ?? extractCredits(creditsText);

    // monta patch só com o que achou
    const patch: any = {
      credits_last_sync_at: new Date().toISOString(),
      owner_username: username,
    };

    if (ownerId != null) patch.owner_id = ownerId;
    if (credits != null) patch.credits_last_known = credits;

    await sb.from("server_integrations").update(patch).eq("id", integration_id);

    return NextResponse.json({
      ok: true,
      message: "ELITE OK. Sync atualizado.",
      owner_id: ownerId ?? null,
      credits_last_known: credits ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Falha no sync ELITE." }, { status: 500 });
  }
}
