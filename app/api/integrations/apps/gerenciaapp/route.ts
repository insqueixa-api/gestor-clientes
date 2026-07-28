// app/api/integrations/apps/gerenciaapp/route.ts
//
// Reescrito em 27/07/2026 pra usar o portal de autoatendimento por MAC do
// GerenciaApp (/ativador) em vez do painel admin (/users, usado pela
// implementação anterior). Motivo: o Márcio reportou, no MAC real
// CA:C1:BD:87:65:C7 (3 playlists cadastradas — NaTV/FastTV/Elite), que
// "Configurar" apagava a playlist anterior em vez de adicionar uma nova, e
// que "Remover" apagava TODAS as playlists do MAC, não só uma. Investigado
// ao vivo nesse MAC real (com backup dos dados antes de mexer):
//   - GET /users?search={mac} no painel admin só devolve o registro MAIS
//     RECENTE entre os que batem com esse MAC — nunca todos. Isso fazia o
//     fallback de busca-por-MAC do fluxo antigo (quando a busca pelo nome
//     exato do servidor não achava nada, por ser um servidor novo) escolher
//     um registro ERRADO (de outro servidor já configurado) e apagar ele.
//   - DELETE /users/{id} no painel admin apaga TODOS os registros daquele
//     mac_device, não só o {id} pedido — confirmado criando 2 registros de
//     teste com dados totalmente distintos (usernames diferentes) e
//     apagando só 1: os dois sumiram.
//   - O portal /ativador (login só com o MAC, sem email/senha — endpoint
//     POST /ativador) expõe cada playlist como um recurso individual de
//     verdade: GET /ativador/gerenciamento lista TODAS (`props.lists`),
//     POST /ativador/add-m3u adiciona sem tocar nas existentes, DELETE
//     /ativador/delete/{id} apaga só aquele id — validado ao vivo no MAC
//     real: criei uma playlist de teste extra (ficou com as 3 reais + 1),
//     apaguei só a de teste, as 3 reais sobreviveram intactas (mesmos ids).
//
// Como o /ativador loga só com o MAC, não precisa mais de
// login_email/login_password (app_integrations) nem do conceito de
// ranking_app_id (só existia no /users antigo) — só do api_url pra saber o
// domínio, igual DUPLEXTV/IPTVDUPLEX etc.
//
// Mesmo bloqueio de IP na Vercel de produção que afeta o /users também
// afeta o /ativador (mesmo domínio, mesmo Cloudflare) — usa o mesmo proxy
// residencial (GERENCIAAPP_PROXY_URL) em todas as chamadas.
//
// Mesmo achado de X-Inertia-Version de antes continua valendo aqui: toda
// chamada com X-Inertia:true (create/update/delete) precisa desse header
// batendo com a versão atual dos assets, senão 409 com corpo vazio.
import { NextResponse } from "next/server";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const PROXY_URL = String(process.env.GERENCIAAPP_PROXY_URL || "").trim();
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;

function pfetch(url: string, opts: Record<string, any> = {}) {
  return undiciFetch(url, { ...opts, ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {}) }) as unknown as Promise<Response>;
}

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

async function activatorLogin(baseUrl: string, mac: string): Promise<{ cookieHeader: string; xsrfToken: string }> {
  const res1 = await pfetch(`${baseUrl}/ativador`, { headers: { "User-Agent": UA } });
  const cookies1 = parseSetCookies(res1.headers);
  const xsrf1 = decodeURIComponent(cookies1["XSRF-TOKEN"] || "");
  if (!xsrf1) throw new Error("Não recebi XSRF-TOKEN do painel (GET /ativador).");

  const res2 = await pfetch(`${baseUrl}/ativador`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/html, application/xhtml+xml, application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-Inertia": "true",
      "X-XSRF-TOKEN": xsrf1,
      Cookie: cookieHeaderFrom(cookies1),
      Referer: `${baseUrl}/ativador`,
      "User-Agent": UA,
    },
    body: JSON.stringify({ mac }),
  });

  if (res2.status !== 302 && res2.status !== 200) {
    throw new Error(`Falha ao autenticar o MAC no GerenciaApp (HTTP ${res2.status}). Confira o MAC cadastrado.`);
  }

  const cookies2 = parseSetCookies(res2.headers);
  const merged = { ...cookies1, ...cookies2 };
  return { cookieHeader: cookieHeaderFrom(merged), xsrfToken: decodeURIComponent(merged["XSRF-TOKEN"] || xsrf1) };
}

async function getManageData(baseUrl: string, session: { cookieHeader: string }): Promise<{ version: string | null; lists: any[] }> {
  const res = await pfetch(`${baseUrl}/ativador/gerenciamento`, {
    headers: { Accept: "text/html", Cookie: session.cookieHeader, "User-Agent": UA },
  });
  const html = await res.text();
  const m = html.match(/data-page="([^"]+)"/);
  if (!m) return { version: null, lists: [] };
  const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  try {
    const json = JSON.parse(decoded);
    return { version: json?.version || null, lists: json?.props?.lists || [] };
  } catch {
    return { version: null, lists: [] };
  }
}

function findListByName(lists: any[], name: string) {
  const targetLower = String(name || "").toLowerCase().trim();
  return (
    lists.find((l) => String(l.server_name || "").toLowerCase().trim() === targetLower) ||
    lists.find(
      (l) =>
        String(l.server_name || "").toLowerCase().includes(targetLower) ||
        targetLower.includes(String(l.server_name || "").toLowerCase()),
    ) ||
    (lists.length === 1 ? lists[0] : null)
  );
}

async function createPlaylist(
  baseUrl: string,
  session: { cookieHeader: string; xsrfToken: string },
  version: string | null,
  { name, url }: { name: string; url: string },
) {
  const res = await pfetch(`${baseUrl}/ativador/add-m3u`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/html, application/xhtml+xml, application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-Inertia": "true",
      ...(version ? { "X-Inertia-Version": version } : {}),
      "X-XSRF-TOKEN": session.xsrfToken,
      Cookie: session.cookieHeader,
      "User-Agent": UA,
    },
    body: JSON.stringify({ url, pwd: "", epg: "", name: name || "Playlist", reseller: "", whatsapp: "" }),
  });
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    const errors = json?.props?.errors || {};
    const firstErr = Object.values(errors)[0];
    if (firstErr) throw new Error(String(firstErr));
  } catch (e: any) {
    if (e instanceof SyntaxError) {
      // corpo não é JSON — segue, confirma por relistagem abaixo
    } else {
      throw e;
    }
  }
}

async function deleteById(baseUrl: string, session: { cookieHeader: string; xsrfToken: string }, version: string | null, id: string | number) {
  const res = await pfetch(`${baseUrl}/ativador/delete/${id}`, {
    method: "DELETE",
    headers: {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      "X-Inertia": "true",
      ...(version ? { "X-Inertia-Version": version } : {}),
      "X-XSRF-TOKEN": session.xsrfToken,
      Cookie: session.cookieHeader,
      "User-Agent": UA,
    },
  });
  if (!res.ok) throw new Error(`Falha ao apagar a playlist (id ${id}, status ${res.status}).`);
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
    const { action, macValue, finalServerName, m3uUrl, username, base_url } = body;

    if (!action || (action !== "create" && action !== "delete" && action !== "check")) {
      return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete | check" }, { status: 400 });
    }
    if (!macValue) {
      return NextResponse.json({ ok: false, error: "macValue é obrigatório." }, { status: 400 });
    }

    let siteRoot = String(base_url || "").replace(/\/$/, "");
    if (!siteRoot) {
      const { data: integ } = await supabase
        .from("app_integrations")
        .select("api_url")
        .eq("app_name", "GERENCIAAPP")
        .eq("is_active", true)
        .maybeSingle();
      siteRoot = String(integ?.api_url || "").replace(/\/$/, "");
    }
    if (!siteRoot) {
      return NextResponse.json({ ok: false, error: "Integração GerenciaApp não configurada." }, { status: 500 });
    }

    const session = await activatorLogin(siteRoot, macValue);

    if (action === "check") {
      const { lists } = await getManageData(siteRoot, session);
      const searchName = String(username || finalServerName || "").trim();
      const match = findListByName(lists, searchName);
      const expireDate = match?.expire_account || null;
      return NextResponse.json({
        ok: true,
        expireDate,
        message: expireDate ? "Vencimento atualizado." : "Não foi possível localizar o vencimento no painel.",
      });
    }

    if (action === "create") {
      if (!m3uUrl) {
        return NextResponse.json({ ok: false, error: "m3uUrl é obrigatório para create." }, { status: 400 });
      }
      const { version } = await getManageData(siteRoot, session);
      await createPlaylist(siteRoot, session, version, { name: finalServerName || "Playlist", url: m3uUrl });

      // Best-effort: relista pra pegar o vencimento real já atribuído (o
      // create não devolve isso diretamente).
      let expireDate: string | null = null;
      try {
        const after = await getManageData(siteRoot, session);
        const created = findListByName(after.lists, finalServerName || "Playlist");
        expireDate = created?.expire_account || null;
      } catch {
        // não bloqueia — playlist já foi criada
      }

      return NextResponse.json({ ok: true, expireDate, message: "Playlist configurada com sucesso." });
    }

    // action === "delete"
    const searchName = String(username || finalServerName || "").trim();
    if (!searchName) {
      return NextResponse.json({ ok: false, error: "Nome do servidor não informado." }, { status: 400 });
    }

    const { version, lists } = await getManageData(siteRoot, session);
    const match = findListByName(lists, searchName);
    if (!match) {
      return NextResponse.json(
        { ok: false, error: `Nenhuma playlist encontrada com o nome "${searchName}" nesse MAC (${lists.length} playlist(s) no total).` },
        { status: 404 },
      );
    }

    await deleteById(siteRoot, session, version, match.id);
    return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno." }, { status: 500 });
  }
}
