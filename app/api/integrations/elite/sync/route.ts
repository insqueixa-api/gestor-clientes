import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import crypto from "crypto";
// ✅ IMPORTANDO O NOSSO TRATOR (Aviso: Neste script estamos usando fetch direto, mas mantive a importação)


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

/** decodificação simples pro wire:snapshot */
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

    const hasKey =
      ("id" in u) || ("owner_id" in u) || ("username" in u) || ("credits" in u) || ("email" in u);

    if (!hasKey) continue;

    const userId = Number.isFinite(Number(u.id)) ? Number(u.id) : null;
    const ownerId = Number.isFinite(Number(u.owner_id)) ? Number(u.owner_id) : null;

    const username = typeof u.username === "string" ? u.username.trim() : null;
    const email = typeof u.email === "string" ? u.email.trim() : null;

    const credits =
      typeof u.credits === "number"
        ? u.credits
        : (typeof u.credits === "string" ? parseLooseNumber(u.credits) : null);

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

export async function POST(req: Request) {
  let sessionId = null;
  // O IP da sua VM rodando o FlareSolverr
  const FLARESOLVERR_URL = "http://136.112.249.42:8191/v1"; 

  try {
    const internalSecret = String(req.headers.get("x-internal-secret") || "").trim();
    const expectedSecret = String(process.env.INTERNAL_API_SECRET || "").trim();

    const a = Buffer.from(internalSecret);
    const b = Buffer.from(expectedSecret);
    const isInternal = !!expectedSecret && a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!isInternal) {
      const { createClient } = await import("@/lib/supabase/server");
      const supabaseAuth = await createClient();
      const { data: auth, error: authErr } = await supabaseAuth.auth.getUser();
      if (authErr || !auth?.user?.id) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    }

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
      // ✅ NOVO: Adicionado proxy_url na query
      .select("id,tenant_id,provider,is_active,api_token,api_secret,api_base_url,proxy_url")
      .eq("id", integration_id)
      .single();

    if (error) throw error;
    if (!integ) throw new Error("Integração não encontrada.");
    if (String(integ.provider).toUpperCase() !== "ELITE") throw new Error("Integração não é ELITE.");
    if (!integ.is_active) throw new Error("Integração está inativa.");

    const loginUser = String((integ as any).api_token || "").trim();
    const loginPass = String((integ as any).api_secret || "").trim();
    const baseUrl = String((integ as any).api_base_url || "").trim();
    // ✅ NOVO: Puxando o Proxy do banco
    const proxyUrl = String((integ as any).proxy_url || "").trim();

    if (!baseUrl || !loginUser || !loginPass) {
      throw new Error("ELITE exige api_base_url + usuário (api_token) + senha (api_secret).");
    }

    const base = normalizeBaseUrl(baseUrl);
    const profileUrl = `${base}/user/profile`;

    console.log(`[ELITE SYNC] Iniciando FlareSolverr para o servidor: ${loginUser}`);
    
    // ==========================================
    // 1. Criar Sessão com Disfarce e Proxy
    // ==========================================
    // ==========================================
    // 1. Criar Sessão com Disfarce (e Proxy dinâmico)
    // ==========================================
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

    if (sessionRes.status !== "ok") throw new Error(`Falha Session: ${sessionRes.message}`);
    sessionId = sessionRes.session;

    // ==========================================
    // 2. Acessar a tela, passar pelo Cloudflare e Logar via Javascript
    // ==========================================
    const loginAutomaticoRes = await fetch(FLARESOLVERR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            cmd: "request.get",
            session: sessionId,
            url: `${base}/login`,
            maxTimeout: 60000,
            returnOnlyCookies: false, 
            // O código abaixo será executado dentro do navegador invisível
            // O código abaixo será executado dentro do navegador invisível
            evaluate: `new Promise((resolve) => {
                // Espera 5 segundos para o Cloudflare passar e o Vue/React carregar os inputs
                setTimeout(() => {
                    let emailInput = document.querySelector('input[type="email"], input[name="email"], input[name="username"]');
                    let passInput = document.querySelector('input[type="password"], input[name="password"]');
                    let btn = document.querySelector('button[type="submit"], form button');
                    
                    if (emailInput && passInput && btn) {
                        emailInput.value = '${loginUser}';
                        passInput.value = '${loginPass}';
                        // Força eventos de input
                        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
                        passInput.dispatchEvent(new Event('input', { bubbles: true }));
                        btn.click();
                    }
                }, 5000);
                // Trava o FlareSolverr por 15 segundos para garantir que o login e o redirecionamento acontecem
                setTimeout(() => { resolve(); }, 15000);
            });`
        })
    }).then(res => res.json());

    if (loginAutomaticoRes.status !== "ok") {
         throw new Error(`Falha ao tentar logar via script: ${loginAutomaticoRes.message}`);
    }

    const htmlAposLogin = loginAutomaticoRes.solution?.response || "";
    
    if (htmlAposLogin.toLowerCase().includes("just a moment") || htmlAposLogin.toLowerCase().includes("cf-turnstile")) {
        throw new Error("O Cloudflare travou este IP no desafio. Vá no Webshare, pegue um IP diferente da lista e atualize no código.");
    }

    // ==========================================
    // 3. Acessar o Profile (Com Espião de Tela)
    // ==========================================
    const profileRes = await fetch(FLARESOLVERR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            cmd: "request.get",
            session: sessionId,
            url: profileUrl,
            maxTimeout: 60000,
            // O script abaixo força o navegador a aguardar e clonar o saldo do Navbar
            evaluate: `new Promise((resolve) => {
                setTimeout(() => {
                    let nav = document.querySelector('#navbarCredits');
                    if (nav) {
                        let div = document.createElement('div');
                        div.id = 'SALDO_HACK_GESTOR';
                        div.innerText = nav.innerText;
                        document.body.appendChild(div);
                    }
                    // Apenas agora liberta o FlareSolverr para tirar a "fotografia" do HTML e devolver ao nosso servidor
                    resolve();
                }, 8000);
            });`
        })
    }).then(res => res.json());

    if (profileRes.status !== "ok") throw new Error(`Falha GET Profile: ${profileRes.message}`);

    const profileHtml = profileRes.solution?.response || "";

    // ==========================================
    // 4. Processamento dos Dados
    // ==========================================
    const $ = cheerio.load(profileHtml);
    
    // 1️⃣ Puxa o saldo roubado direto da tela pelo nosso espião JS
    const hackCreditsText = $('#SALDO_HACK_GESTOR').text();
    const creditsFromHack = parseLooseNumber(hackCreditsText);

    // 2️⃣ Puxa os dados invisíveis (O Cálculo Livewire) como Fallback
    const fromSnap = extractEliteFromLivewireSnapshot(profileHtml);
    const profileText = textFromHtml(profileHtml);

    const user_id = fromSnap?.user_id ?? null;
    let owner_id = fromSnap?.owner_id ?? extractOwnerId(profileText) ?? null;
    
    // Extrai os Créditos (Prioridade Absoluta: O que foi lido na tela visual. Fallback: O cálculo invisível)
    let credits = creditsFromHack ?? (fromSnap?.credits ?? null) ?? extractCredits(profileText) ?? null;

    const panel_username = fromSnap?.username ?? null;
    const panel_email = fromSnap?.email ?? null;

    if (user_id == null && owner_id == null && credits == null) {
        console.log("[ELITE SYNC] Aviso: Não encontrou dados no HTML. O login JS pode ter falhado silenciosamente.");
    }

    // 5. Atualizar Banco
    const patch: any = {
      credits_last_sync_at: new Date().toISOString(),
      owner_username: (panel_username || loginUser),
    };

    if (owner_id != null) patch.owner_id = owner_id;
    if (credits != null) patch.credits_last_known = credits;

    await sb.from("server_integrations").update(patch).eq("id", integration_id);

    return NextResponse.json({
      ok: true,
      message: "ELITE OK. Sync atualizado.",
      parsed: { user_id, owner_id, username: panel_username, email: panel_email, credits },
      saved: { owner_id: owner_id ?? null, owner_username: patch.owner_username, credits_last_known: credits ?? null },
    });

  } catch (e: any) {
    console.error("[ELITE SYNC ERROR]", e);
    return NextResponse.json({ ok: false, error: e.message || "Falha no sync ELITE." }, { status: 500 });
  } finally {
    // ==========================================
    // 6. DESTRUIR SESSÃO PARA LIBERAR MEMÓRIA DA VM
    // ==========================================
    if (sessionId) {
        await fetch(FLARESOLVERR_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cmd: "sessions.destroy", session: sessionId })
        }).catch(() => {});
    }
  }
}