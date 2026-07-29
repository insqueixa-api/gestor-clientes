// app/api/integrations/apps/clouddy/route.ts
//
// ClouDDy (console.clouddy.online) — SEM API pública oficial. O login usa
// Cloudflare Turnstile real: testado exaustivamente numa VM (Playwright
// headless, headed via Xvfb, navigator.webdriver "corrigido", até com proxy
// residencial) e o Cloudflare sempre rejeitou — o bloqueio é o controle via
// CDP em si, não IP nem conta (confirmado 28/07/2026). Só passa num
// navegador de verdade, sem automação externa.
//
// Por isso o login é manual, pelo admin, via extensão (ação CLOUDDY_LOGIN
// em background.js — abre uma aba real, sem CDP). A extensão captura o
// cookie PHPSESSID resultante e o admin salva em
// client_apps.field_values._clouddy_session (chave reservada, igual
// _config_cost/_config_partner).
//
// A partir daí, create/delete/check são requisições HTTP normais —
// autenticadas só pelo cookie, SEM captcha nenhum. Confirmado via curl real
// (Márcio, 28/07/2026):
//   GET  /user/dashboard          → tem "Data final do serviço" (vencimento)
//   POST /user/tv-playlist/edit   multipart: form[m3u]=<vazio>, form[url]=<m3u>, form[epg]=""
//   POST /user/vod-playlist/edit  multipart: form[m3u]=<vazio>, form[url]=<m3u>  (sem epg)
//   GET  /user/tv-playlist/delete  e  GET /user/vod-playlist/delete
// TV e VOD são configurados/removidos SEMPRE juntos — não existe "só um".
//
// ClouDDy é por CONTA (email+senha própria do cliente), não por MAC — essa
// rota identifica o alvo por client_app_id, diferente de todos os outros
// handlers dessa pasta (que usam macValue).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";
import { extractDateOnly } from "@/lib/apps/panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const BASE = "https://console.clouddy.online";
const SESSION_EXPIRED_ERROR = "Sessão do ClouDDy expirada — use o botão \"Renovar sessão\" (extensão) e tente de novo.";

function looksLikeLoginForm(html: string) {
  return html.includes('name="form[email]"') && html.includes('name="form[password]"');
}

async function clouddyFetch(base: string, path: string, sessionCookie: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Cookie: `PHPSESSID=${sessionCookie}`, "User-Agent": UA },
  });
}

function extractExpireDate(html: string): string | null {
  const idx = html.indexOf("Data final");
  if (idx === -1) return null;
  const chunk = html.slice(idx, idx + 300);
  const m = chunk.match(/badge-pill">([^<]+)</);
  return m ? extractDateOnly(m[1]) : null;
}

export async function POST(req: Request) {
  try {
    if (hasBadInternalHeader(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const internal = isInternalRequest(req);

    let supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdmin>;
    if (internal) {
      supabase = createAdmin(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
    } else {
      supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, client_app_id, m3uUrl } = body;

    if (!action) {
      return NextResponse.json({ ok: false, error: "action é obrigatório." }, { status: 400 });
    }
    if (!client_app_id) {
      return NextResponse.json({ ok: false, error: "client_app_id é obrigatório." }, { status: 400 });
    }

    // ✅ Igual toda integração "normal" — lê api_url/is_active de
    // app_integrations (tela Configurações → Integrações). Sem linha
    // cadastrada, cai no domínio padrão (compatível com quem configurou
    // antes dessa tela existir pro ClouDDy).
    const { data: integ } = await supabase
      .from("app_integrations")
      .select("api_url, is_active")
      .eq("app_name", "CLOUDDY")
      .maybeSingle();

    if (integ && integ.is_active === false) {
      return NextResponse.json({ ok: false, error: "Integração ClouDDy está desativada (Configurações → Integrações)." }, { status: 400 });
    }
    const base = integ?.api_url ? integ.api_url.replace(/\/$/, "") : BASE;

    const { data: clientApp, error: clientAppErr } = await supabase
      .from("client_apps")
      .select("field_values")
      .eq("id", client_app_id)
      .maybeSingle();

    if (clientAppErr || !clientApp) {
      return NextResponse.json({ ok: false, error: "Aplicativo do cliente não encontrado." }, { status: 404 });
    }

    const sessionCookie = (clientApp.field_values || {})._clouddy_session as string | undefined;
    if (!sessionCookie) {
      // ✅ needsLogin: o front usa essa flag pra disparar a extensão
      // automaticamente e tentar de novo, sem precisar de 2 cliques
      // separados — igual qualquer outra integração, na prática.
      return NextResponse.json(
        { ok: false, needsLogin: true, error: "Sessão do ClouDDy ainda não existe — logando..." },
        { status: 400 },
      );
    }

    // ===========================================================
    // ACTION: check — lê "Data final do serviço" do dashboard. Sem
    // criar/alterar nada.
    // ===========================================================
    if (action === "check") {
      const res = await clouddyFetch(base, "/user/dashboard", sessionCookie);
      const html = await res.text();
      if (looksLikeLoginForm(html)) {
        return NextResponse.json({ ok: false, needsLogin: true, error: SESSION_EXPIRED_ERROR }, { status: 401 });
      }
      const expireDate = extractExpireDate(html);
      return NextResponse.json({
        ok: true,
        expireDate,
        message: expireDate ? "Vencimento atualizado." : "Não foi possível localizar o vencimento no painel.",
      });
    }

    // ===========================================================
    // ACTION: create — configura TV + VOD com o mesmo m3uUrl, sempre
    // juntos (não existe "só um" no ClouDDy).
    // ===========================================================
    if (action === "create") {
      if (!m3uUrl) {
        return NextResponse.json({ ok: false, error: "m3uUrl é obrigatório para create." }, { status: 400 });
      }

      const buildForm = (includeEpg: boolean) => {
        const fd = new FormData();
        fd.append("form[m3u]", new Blob([], { type: "application/octet-stream" }), "");
        fd.append("form[url]", m3uUrl);
        if (includeEpg) fd.append("form[epg]", "");
        return fd;
      };

      const tvRes = await clouddyFetch(base, "/user/tv-playlist/edit", sessionCookie, { method: "POST", body: buildForm(true) });
      const tvHtml = await tvRes.text();
      if (looksLikeLoginForm(tvHtml)) {
        return NextResponse.json({ ok: false, needsLogin: true, error: SESSION_EXPIRED_ERROR }, { status: 401 });
      }

      const vodRes = await clouddyFetch(base, "/user/vod-playlist/edit", sessionCookie, { method: "POST", body: buildForm(false) });

      if (!tvRes.ok || !vodRes.ok) {
        return NextResponse.json(
          { ok: false, error: `Falha ao salvar no ClouDDy (TV:${tvRes.ok ? "ok" : "falhou"} / VOD:${vodRes.ok ? "ok" : "falhou"}).` },
          { status: 502 },
        );
      }

      let expireDate: string | null = null;
      try {
        const dashRes = await clouddyFetch(base, "/user/dashboard", sessionCookie);
        expireDate = extractExpireDate(await dashRes.text());
      } catch {
        // best-effort — create já foi feito, não bloqueia
      }

      return NextResponse.json({ ok: true, expireDate, message: "TV + VOD configurados com sucesso." });
    }

    // ===========================================================
    // ACTION: delete — remove TV + VOD, sempre juntos.
    // ===========================================================
    if (action === "delete") {
      const tvRes = await clouddyFetch(base, "/user/tv-playlist/delete", sessionCookie);
      const vodRes = await clouddyFetch(base, "/user/vod-playlist/delete", sessionCookie);

      if (!tvRes.ok || !vodRes.ok) {
        return NextResponse.json(
          { ok: false, error: `Falha ao remover no ClouDDy (TV:${tvRes.ok ? "ok" : "falhou"} / VOD:${vodRes.ok ? "ok" : "falhou"}).` },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true, message: "TV + VOD removidos com sucesso." });
    }

    return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete | check" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Erro interno." }, { status: 500 });
  }
}
