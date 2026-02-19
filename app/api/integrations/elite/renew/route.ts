import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CookieJar } from "tough-cookie";
import fetchCookie from "fetch-cookie";
import * as cheerio from "cheerio";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function normalizeBaseUrl(u: string) {
  const s = String(u || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) throw new Error("api_base_url inválida.");
  return s;
}

async function offoLogin(baseUrlRaw: string, username: string, password: string, tz = "America/Sao_Paulo") {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  const jar = new CookieJar();
  const fc = fetchCookie(fetch, jar);

  const loginUrl = `${baseUrl}/login`;

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
    throw new Error("Login falhou (voltou para /login).");
  }

  return { fc, baseUrl, csrfToken, tz };
}

async function offoRenewOne(fc: any, baseUrl: string, csrfToken: string, userId: string) {
  const url = `${baseUrl}/api/iptv/renewone/${encodeURIComponent(userId)}`;

  const r = await fc(url, {
    method: "POST",
    headers: {
      accept: "*/*",
      origin: baseUrl,
      referer: `${baseUrl}/dashboard/iptv`,
      "cache-control": "no-cache",
      pragma: "no-cache",
      timezone: "America/Sao_Paulo",
      "x-csrf-token": csrfToken,
      "x-requested-with": "XMLHttpRequest",
      "user-agent": "Mozilla/5.0",
    },
  });

  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Renew HTTP ${r.status}`);
  if (!json?.success) throw new Error(json?.message || "Renovação falhou no provedor.");
  return json;
}

export async function POST(req: Request) {
  try {
    const { integration_id, provider_user_id } = await req.json().catch(() => ({}));
    if (!integration_id) return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });
    if (!provider_user_id) return NextResponse.json({ ok: false, error: "provider_user_id obrigatório." }, { status: 400 });

    const sb = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const { data: integ, error } = await sb
      .from("server_integrations")
      .select("id,provider,is_active,api_token,api_secret,api_base_url")
      .eq("id", integration_id)
      .single();

    if (error) throw error;
    if (!integ) throw new Error("Integração não encontrada.");
    if (String(integ.provider).toUpperCase() !== "ELITE") throw new Error("Integração não é ELITE.");
    if (!integ.is_active) throw new Error("Integração inativa.");

    const baseUrl = String(integ.api_base_url || "").trim();
    const username = String(integ.api_token || "").trim();
    const password = String(integ.api_secret || "").trim();
    if (!baseUrl || !username || !password) throw new Error("ELITE exige base_url + usuário + senha.");

    const { fc, csrfToken } = await offoLogin(baseUrl, username, password);
    const result = await offoRenewOne(fc, baseUrl, csrfToken, String(provider_user_id));

    return NextResponse.json({
      ok: true,
      message: result?.message,
      new_exp_date: result?.new_exp_date,
      new_exp_timestamp: result?.new_exp_timestamp,
      raw: result,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Falha ao renovar no ELITE." }, { status: 500 });
  }
}
