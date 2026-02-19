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
  if (!/^https?:\/\//i.test(s)) throw new Error("api_base_url inválida (precisa começar com http/https).");
  return s;
}

async function offoLogin(baseUrlRaw: string, username: string, password: string, tz = "America/Sao_Paulo") {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);

  const jar = new CookieJar();
  const fc = fetchCookie(fetch, jar);

  const loginUrl = `${baseUrl}/login`;

  // 1) GET /login (cookies + HTML com _token)
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

  // 2) POST /login (form-urlencoded)
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

  // Se cair de volta em /login, geralmente falhou auth
  const finalUrl = (r2 as any)?.url || "";
  if (String(finalUrl).includes("/login")) {
    throw new Error("Login falhou (voltou para /login). Verifique usuário/senha.");
  }

  return { fc, baseUrl, csrfToken, tz };
}

export async function POST(req: Request) {
  try {
    const { integration_id } = await req.json().catch(() => ({}));
    if (!integration_id) return NextResponse.json({ ok: false, error: "integration_id obrigatório." }, { status: 400 });

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

    const username = String(integ.api_token || "").trim();
    const password = String(integ.api_secret || "").trim();
    const baseUrl = String(integ.api_base_url || "").trim();

    if (!baseUrl || !username || !password) {
      throw new Error("ELITE exige api_base_url + usuário (api_token) + senha (api_secret).");
    }

    // tenta logar
    await offoLogin(baseUrl, username, password);

    // grava último sync
    await sb
      .from("server_integrations")
      .update({
        credits_last_sync_at: new Date().toISOString(),
        owner_username: username, // se sua tabela tiver essa coluna
      } as any)
      .eq("id", integration_id);

    return NextResponse.json({ ok: true, message: "Login ELITE OK. Integração validada." });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Falha no sync ELITE." }, { status: 500 });
  }
}
