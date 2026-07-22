// app/api/integrations/apps/duplecast/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// BASE_URL vem do corpo da requisição (salvo no banco em app_integrations.api_url,
// como "https://duplecast.com/client/login" — usamos só a origem)
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

// ============================================================
// Cookie jar simples para manter sessão entre requests
// ============================================================
class CookieJar {
  private store: Map<string, string> = new Map();

  absorb(headers: Headers) {
    const rawList: string[] =
      typeof (headers as any).getSetCookie === "function"
        ? (headers as any).getSetCookie()
        : (headers.get("set-cookie") || "").split(/,(?=[^ ])/).filter(Boolean);

    for (const raw of rawList) {
      const [nameVal] = raw.split(";");
      const eqIdx = nameVal.indexOf("=");
      if (eqIdx === -1) continue;
      const name = nameVal.slice(0, eqIdx).trim();
      const value = nameVal.slice(eqIdx + 1).trim();
      if (name) this.store.set(name, value);
    }
  }

  toString() {
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function extractCsrfToken(html: string): string | null {
  const m = html.match(/_csrf_token"\s+value="([^"]+)"/);
  return m ? m[1] : null;
}

function baseHeaders(cookie: string, referer: string, isPost = false, origin = ""): Record<string, string> {
  return {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "pt,en;q=0.9,pt-BR;q=0.8",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "user-agent": UA,
    referer,
    cookie,
    ...(isPost
      ? {
          "content-type": "application/x-www-form-urlencoded",
          origin,
        }
      : {}),
  };
}

function ajaxHeaders(cookie: string, referer: string, origin: string): Record<string, string> {
  return {
    ...baseHeaders(cookie, referer, true, origin),
    "x-requested-with": "XMLHttpRequest",
    accept: "application/json, text/javascript, */*; q=0.01",
  };
}

async function login(siteRoot: string, jar: CookieJar, username: string, password: string) {
  const getRes = await fetch(`${siteRoot}/client/login`, {
    headers: baseHeaders("", `${siteRoot}/`),
    redirect: "follow",
  });
  jar.absorb(getRes.headers);
  const html = await getRes.text();
  const token = extractCsrfToken(html);
  if (!token) throw new Error("CSRF token não encontrado na página de login do Duplecast.");

  const params = new URLSearchParams();
  params.set("_csrf_token", token);
  params.set("username", username);
  params.set("password", password);
  params.set("login", "");

  const postRes = await fetch(`${siteRoot}/client/login`, {
    method: "POST",
    headers: baseHeaders(jar.toString(), `${siteRoot}/client/login`, true, siteRoot),
    body: params.toString(),
    redirect: "manual",
  });
  jar.absorb(postRes.headers);

  if (postRes.status !== 302 || String(postRes.headers.get("location") || "").includes("/login")) {
    throw new Error("Login no Duplecast falhou. Verifique login_email/login_password.");
  }
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
    const { action, macValue, finalServerName, m3uUrl, password, username } = body;

    if (!action) {
      return NextResponse.json({ ok: false, error: "action é obrigatório." }, { status: 400 });
    }
    if (!macValue) {
      return NextResponse.json({ ok: false, error: "macValue é obrigatório." }, { status: 400 });
    }

    // Credenciais do painel vêm do banco (nunca do front)
    const { data: integ, error: integErr } = await supabase
      .from("app_integrations")
      .select("api_url, login_email, login_password")
      .eq("app_name", "DUPLECAST")
      .maybeSingle();

    if (integErr || !integ?.api_url || !integ?.login_email || !integ?.login_password) {
      return NextResponse.json({ ok: false, error: "Integração Duplecast não configurada." }, { status: 500 });
    }

    const siteRoot = new URL(integ.api_url).origin;
    const jar = new CookieJar();
    await login(siteRoot, jar, integ.login_email, integ.login_password);

    // ===========================================================
    // ACTION: create
    // 1. GET add/ → CSRF fresco
    // 2. POST add/ (form_action=generate_m3u_playlist) → salva playlist
    // 3. Busca a data de vencimento em client_codes (best-effort)
    // ===========================================================
    if (action === "create") {
      if (!m3uUrl) {
        return NextResponse.json({ ok: false, error: "m3uUrl é obrigatório para create." }, { status: 400 });
      }

      const addUrl = `${siteRoot}/client/plugin/duplecast/client_playlist/add/`;
      const getAddRes = await fetch(addUrl, {
        headers: baseHeaders(jar.toString(), `${siteRoot}/client/`),
        redirect: "follow",
      });
      jar.absorb(getAddRes.headers);
      const addHtml = await getAddRes.text();
      const token = extractCsrfToken(addHtml);
      if (!token) throw new Error("CSRF token não encontrado no formulário de criação.");

      let pin = String(password || "").replace(/\D/g, "");
      if (pin.length < 4) pin = "";

      const addParams = new URLSearchParams();
      addParams.set("_csrf_token", token);
      addParams.set("form_action", "generate_m3u_playlist");
      addParams.set("mac", macValue);
      addParams.set("m3u_name", finalServerName || "Playlist");
      addParams.set("m3u_playlist", m3uUrl);
      addParams.set("epg_url", "");
      addParams.set("note", "");
      if (pin) {
        addParams.set("locked", "1");
        addParams.set("pin", pin);
        addParams.set("confirm_pin", pin);
      }

      const postAddRes = await fetch(addUrl, {
        method: "POST",
        headers: baseHeaders(jar.toString(), addUrl, true, siteRoot),
        body: addParams.toString(),
        redirect: "manual",
      });
      jar.absorb(postAddRes.headers);

      const addOk = postAddRes.status === 302 || postAddRes.status === 200;
      if (!addOk) {
        const errText = await postAddRes.text().catch(() => "");
        throw new Error(`Falha ao criar playlist no Duplecast (HTTP ${postAddRes.status}). ${errText.slice(0, 200)}`);
      }

      // Busca vencimento (best-effort, não falha o create se não achar)
      let expireDate: string | null = null;
      try {
        const codesUrl = `${siteRoot}/plugin/duplecast/client_codes/`;
        const getCodesRes = await fetch(codesUrl, {
          headers: baseHeaders(jar.toString(), addUrl),
          redirect: "follow",
        });
        jar.absorb(getCodesRes.headers);
        const codesHtml = await getCodesRes.text();
        const codesToken = extractCsrfToken(codesHtml) || token;

        const searchParams = new URLSearchParams();
        searchParams.set("_csrf_token", codesToken);
        searchParams.set("filters[mac]", macValue);
        searchParams.set("filters[code]", "");
        searchParams.set("filters[per_page]", "20");

        const searchRes = await fetch(`${siteRoot}/client/plugin/duplecast/client_codes/index/all`, {
          method: "POST",
          headers: ajaxHeaders(jar.toString(), codesUrl, siteRoot),
          body: searchParams.toString(),
        });
        const searchJson = await searchRes.json().catch(() => null);
        const content: string = searchJson?.content || "";

        const rowMatches = [...content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
        let maxDate: Date | null = null;
        for (const rowMatch of rowMatches) {
          const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
            c[1].replace(/<[^>]+>/g, "").trim(),
          );
          if (cells.length >= 6) {
            const d = new Date(cells[5]);
            if (!isNaN(d.getTime()) && (!maxDate || d > maxDate)) maxDate = d;
          }
        }
        if (maxDate) {
          expireDate = `${maxDate.getFullYear()}-${String(maxDate.getMonth() + 1).padStart(2, "0")}-${String(maxDate.getDate()).padStart(2, "0")}`;
        }
      } catch {
        // não bloqueia o create
      }

      return NextResponse.json({ ok: true, expireDate, message: "Playlist configurada com sucesso." });
    }

    // ===========================================================
    // ACTION: delete
    // 1. GET client_playlist/ → CSRF fresco
    // 2. POST index/all (AJAX) → lista filtrada por MAC
    // 3. Acha a linha certa (MAC + nome do servidor) e extrai o link de delete
    // 4. POST delete/{id}/
    // ===========================================================
    if (action === "delete") {
      const searchName = String(username || finalServerName || "").trim();
      if (!searchName) {
        return NextResponse.json({ ok: false, error: "Nome do servidor não informado." }, { status: 400 });
      }

      const listUrl = `${siteRoot}/plugin/duplecast/client_playlist/`;
      const getListRes = await fetch(listUrl, {
        headers: baseHeaders(jar.toString(), `${siteRoot}/client/`),
        redirect: "follow",
      });
      jar.absorb(getListRes.headers);
      const listHtml = await getListRes.text();
      const token = extractCsrfToken(listHtml);
      if (!token) throw new Error("CSRF token não encontrado na lista de playlists.");

      const searchParams = new URLSearchParams();
      searchParams.set("_csrf_token", token);
      searchParams.set("filters[mac]", macValue);
      searchParams.set("filters[server_host]", "");
      searchParams.set("filters[per_page]", "50");

      const searchRes = await fetch(`${siteRoot}/client/plugin/duplecast/client_playlist/index/all`, {
        method: "POST",
        headers: ajaxHeaders(jar.toString(), listUrl, siteRoot),
        body: searchParams.toString(),
      });
      const searchJson = await searchRes.json().catch(() => null);
      const content: string = searchJson?.content || "";
      if (!content) {
        return NextResponse.json({ ok: false, error: "MAC não localizado na base do Duplecast para exclusão." }, { status: 404 });
      }

      const targetMac = macValue.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
      const targetName = searchName.toLowerCase();

      const rowMatches = [...content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
      let deleteHref: string | null = null;
      for (const rowMatch of rowMatches) {
        const row = rowMatch[1];
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
          c[1].replace(/<[^>]+>/g, "").trim(),
        );
        if (cells.length < 3) continue;
        const rowMac = (cells[1] || "").replace(/[^a-fA-F0-9]/g, "").toLowerCase();
        const rowName = (cells[2] || "").toLowerCase();
        if (rowMac !== targetMac) continue;
        const nameMatch = !targetName || rowName === targetName || rowName.includes(targetName) || targetName.includes(rowName);
        if (!nameMatch) continue;
        const hrefMatch = row.match(/href="([^"]*\/delete\/[^"]*)"/);
        if (hrefMatch) { deleteHref = hrefMatch[1]; break; }
      }

      if (!deleteHref) {
        return NextResponse.json(
          { ok: false, error: `Nenhuma lista encontrada para o MAC ${macValue} associada ao servidor '${searchName}'.` },
          { status: 404 },
        );
      }

      const deleteUrl = deleteHref.startsWith("http") ? deleteHref : `${siteRoot}${deleteHref}`;
      const delParams = new URLSearchParams();
      delParams.set("_csrf_token", token);
      delParams.set("0", "");
      delParams.set("submit", "Yes");

      const deleteRes = await fetch(deleteUrl, {
        method: "POST",
        headers: baseHeaders(jar.toString(), listUrl, true, siteRoot),
        body: delParams.toString(),
        redirect: "manual",
      });

      const delOk = deleteRes.status === 302 || deleteRes.status === 200;
      if (!delOk) {
        return NextResponse.json({ ok: false, error: `Falha ao apagar (HTTP ${deleteRes.status}).` }, { status: 500 });
      }

      return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
    }

    return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Erro interno." }, { status: 500 });
  }
}
