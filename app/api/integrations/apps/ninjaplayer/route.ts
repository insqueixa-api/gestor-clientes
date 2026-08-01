// app/api/integrations/apps/ninjaplayer/route.ts
//
// Ninja Player e Meta Player (metaplayer.app) compartilham o MESMO backend —
// login por MAC + "OTP CODE" (na prática um device_key fixo por aparelho,
// não um código de uso único: o mesmo valor salvo em client_apps continua
// autenticando em toda chamada nova, confirmado ao vivo em 01/08/2026).
//
// Fluxo (sessão Laravel clássica, cookie + _token, sem API JSON):
//   1. GET  /                          → cookies (XSRF-TOKEN, metaplayer_session) + _token no HTML
//   2. POST /maclogin  {_token, mac, code}   → 302 → /user (autenticado)
//   3. GET  /user                      → HTML com:
//        - tabela SUBSCRIPTION (id, plano, contagem, START DATE, END DATE, STATUS)
//        - form #updatefull, action="/upplaylist/{id}" — troca a playlist inteira
//          {_token, tipo:"full", fullurl: <m3u completo>}
//   4. POST /upplaylist/{id} {_token, tipo:"full", fullurl}  → 302 → /user
//
// Não existe endpoint de "apagar playlist" — o próprio Márcio já usa a
// convenção de sobrescrever com uma URL de M3U inválida/vazia
// (DUMMY_DELETE_URL abaixo) pra simular remoção. "Configurar" (delete
// tolerante + create, ver lib/apps/orchestration.ts) já resolve isso
// naturalmente: o delete grava a URL de mentira, o create logo em seguida
// grava a de verdade.
//
// Não tem PIN (ao contrário de MESSITV/IBOPLAYER/etc.) — NINJAPLAYER não
// entra em PIN_HANDLERS (lib/apps/panel.ts).
import { NextResponse } from "next/server";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

// Site é protegido por Cloudflare — IP de datacenter da Vercel apanha
// desafio/bloqueio, mesmo problema já resolvido pro GerenciaApp. Mesmo
// proxy residencial fixo (ver GERENCIAAPP_PROXY_URL, app/api/integrations/
// apps/gerenciaapp/route.ts).
const PROXY_URL = String(process.env.GERENCIAAPP_PROXY_URL || "").trim();
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;

function pfetch(url: string, opts: Record<string, any> = {}) {
  return undiciFetch(url, { ...opts, ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {}) }) as unknown as Promise<Response>;
}

// URL usada pra "apagar" a playlist (sobrescrever com algo inválido) — mesma
// convenção que o Márcio já usa manualmente no painel.
const DUMMY_DELETE_URL = "http://deletado.del/get.php?username=Deletado&password=dell";

function getSetCookies(headers: Headers): string[] {
  return typeof (headers as any).getSetCookie === "function"
    ? (headers as any).getSetCookie()
    : (headers.get("set-cookie") || "").split(/,(?=[^ ])/).filter(Boolean);
}

function parseSetCookies(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of getSetCookies(headers)) {
    const [nameVal] = line.split(";");
    const eq = nameVal.indexOf("=");
    if (eq === -1) continue;
    out[nameVal.slice(0, eq).trim()] = nameVal.slice(eq + 1).trim();
  }
  return out;
}

function cookieHeaderFrom(cookieMap: Record<string, string>): string {
  return Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join("; ");
}

function extractToken(html: string): string | null {
  return html.match(/name="_token"\s+value="([^"]+)"/)?.[1] || null;
}

// "August 8th 2026" → "2026-08-08". Nunca passa por new Date() (mesma regra
// de extractDateOnly em lib/apps/panel.ts — evita vencimento salvo um dia a
// mais/a menos dependendo do fuso do processo).
const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};
function parseHumanDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})$/.exec(String(raw).trim());
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${String(m[2]).padStart(2, "0")}`;
}

function extractSubscription(html: string): { rowId: string; endDate: string | null; status: string | null } | null {
  const idx = html.indexOf("END DATE");
  if (idx === -1) return null;
  const tbodyIdx = html.indexOf("<tbody>", idx);
  if (tbodyIdx === -1) return null;
  const trMatch = html.slice(tbodyIdx).match(/<tr>([\s\S]*?)<\/tr>/);
  if (!trMatch) return null;
  const cells = [...trMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1].trim());
  if (cells.length < 6) return null;
  return { rowId: cells[0], endDate: parseHumanDate(cells[4]), status: cells[5] || null };
}

function extractPlaylistFormId(html: string): string | null {
  return html.match(/id="updatefull"[^>]*action="\/upplaylist\/(\d+)"/)?.[1] || null;
}

// O painel do Ninja/Meta Player TRUNCA a URL salva — devolve só até
// username+password, cortando qualquer parâmetro depois disso (ex:
// "&type=m3u_plus&output=ts" some). Confirmado ao vivo (02/08/2026): mandei
// a URL completa, o painel guardou sem os parâmetros extras. Por isso a
// verificação usa o "username" da query string, não o texto inteiro — é o
// único jeito de comparar sem falso-negativo nesse painel específico.
function extractUsernameParam(url: string): string | null {
  const m = url.match(/[?&]username=([^&]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function extractCurrentPlaylistUrl(html: string): string | null {
  const idx = html.indexOf("Your Playlist");
  if (idx === -1) return null;
  const chunk = html.slice(idx, idx + 1500);
  const m = chunk.match(/<td>(https?:\/\/[^<]+)<\/td>/);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

type Session = { cookieHeader: string; token: string; html: string };

async function login(baseUrl: string, mac: string, code: string): Promise<Session> {
  const res1 = await pfetch(`${baseUrl}/`, { headers: { Accept: "text/html", "User-Agent": UA } });
  const cookies1 = parseSetCookies(res1.headers);
  const html1 = await res1.text();
  const token1 = extractToken(html1);
  if (!token1) throw new Error("Não recebi o token CSRF da página de login.");

  const body = new URLSearchParams({ _token: token1, mac, code }).toString();
  const res2 = await pfetch(`${baseUrl}/maclogin`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml",
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
      Cookie: cookieHeaderFrom(cookies1),
      "User-Agent": UA,
    },
    body,
  });

  if (res2.status < 300 || res2.status >= 400) {
    const text = await res2.text();
    if (/invalid|incorrect|not found/i.test(text)) {
      throw new Error("MAC ou código (OTP/Device Key) inválido no Ninja/Meta Player.");
    }
    throw new Error(`Falha no login do Ninja/Meta Player (HTTP ${res2.status}).`);
  }

  const cookies2 = parseSetCookies(res2.headers);
  const merged = { ...cookies1, ...cookies2 };
  const loc = res2.headers.get("location") || "/user";
  const finalUrl = loc.startsWith("http") ? loc : `${baseUrl}${loc}`;

  const res3 = await pfetch(finalUrl, {
    headers: { Accept: "text/html", Cookie: cookieHeaderFrom(merged), "User-Agent": UA },
  });
  Object.assign(merged, parseSetCookies(res3.headers));
  const html3 = await res3.text();
  const token3 = extractToken(html3);
  if (!token3) throw new Error("Login parece ter falhado — não encontrei a página autenticada (/user).");

  return { cookieHeader: cookieHeaderFrom(merged), token: token3, html: html3 };
}

async function updatePlaylist(baseUrl: string, session: Session, rowId: string, fullurl: string): Promise<Session> {
  const body = new URLSearchParams({ _token: session.token, tipo: "full", fullurl }).toString();
  const res = await pfetch(`${baseUrl}/upplaylist/${rowId}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml",
      Origin: baseUrl,
      Referer: `${baseUrl}/user`,
      Cookie: session.cookieHeader,
      "User-Agent": UA,
    },
    body,
  });

  const freshCookies = parseSetCookies(res.headers);
  const existing: Record<string, string> = {};
  for (const part of session.cookieHeader.split("; ")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    existing[part.slice(0, eq)] = part.slice(eq + 1);
  }
  const mergedCookies = cookieHeaderFrom({ ...existing, ...freshCookies });

  if (res.status < 300 || res.status >= 400) {
    throw new Error(`Falha ao atualizar a playlist do Ninja/Meta Player (HTTP ${res.status}).`);
  }

  const loc = res.headers.get("location") || "/user";
  const res2 = await pfetch(loc.startsWith("http") ? loc : `${baseUrl}${loc}`, {
    headers: { Accept: "text/html", Cookie: mergedCookies, "User-Agent": UA },
  });
  const html2 = await res2.text();
  const token2 = extractToken(html2);
  return { cookieHeader: mergedCookies, token: token2 || session.token, html: html2 };
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
    const { action, macValue, deviceKey, m3uUrl, base_url } = body;

    if (!action || (action !== "check" && action !== "create" && action !== "delete")) {
      return NextResponse.json({ ok: false, error: "action inválida. Use: check | create | delete" }, { status: 400 });
    }
    const mac = String(macValue || "").trim();
    if (!mac) {
      return NextResponse.json({ ok: false, error: "macValue é obrigatório." }, { status: 400 });
    }
    const code = String(deviceKey || "").trim();
    if (!code) {
      return NextResponse.json({ ok: false, error: "Device Key/OTP é obrigatório pro Ninja/Meta Player." }, { status: 400 });
    }

    const baseUrl = String(base_url || "https://meta-player.app").replace(/\/$/, "");

    const session = await login(baseUrl, mac, code);
    const sub = extractSubscription(session.html);

    if (action === "check") {
      return NextResponse.json({
        ok: true,
        expireDate: sub?.endDate ?? null,
        message: sub?.endDate ? "Vencimento atualizado." : "Login ok, mas não encontrei a data de vencimento na página.",
      });
    }

    // create / delete — os dois só trocam a playlist inteira pela URL certa
    // (a de verdade no create, a "de mentira" no delete — ver DUMMY_DELETE_URL).
    const rowId = extractPlaylistFormId(session.html);
    if (!rowId) {
      return NextResponse.json({ ok: false, error: "Não encontrei o formulário de playlist na página do Ninja/Meta Player." }, { status: 502 });
    }

    if (action === "create" && !m3uUrl) {
      return NextResponse.json({ ok: false, error: "m3uUrl é obrigatório para create." }, { status: 400 });
    }
    const targetUrl = action === "create" ? String(m3uUrl) : DUMMY_DELETE_URL;

    const targetUsername = extractUsernameParam(targetUrl);
    let verified: string | null = null;
    let lastSession = session;
    for (let attempt = 1; attempt <= 3 && verified === null; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 1200));
      lastSession = await updatePlaylist(baseUrl, lastSession, rowId, targetUrl);
      const current = extractCurrentPlaylistUrl(lastSession.html);
      if (current && targetUsername && extractUsernameParam(current) === targetUsername) verified = current;
    }

    if (verified === null) {
      return NextResponse.json(
        { ok: false, error: `O painel respondeu, mas a playlist não ficou com o valor esperado — confira manualmente em ${baseUrl}/user.` },
        { status: 502 },
      );
    }

    const freshSub = extractSubscription(lastSession.html);
    return NextResponse.json({
      ok: true,
      expireDate: freshSub?.endDate ?? sub?.endDate ?? null,
      message: action === "create" ? "Playlist configurada com sucesso." : "Playlist removida com sucesso.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno." }, { status: 500 });
  }
}
