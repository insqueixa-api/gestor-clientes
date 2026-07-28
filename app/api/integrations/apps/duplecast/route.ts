// app/api/integrations/apps/duplecast/route.ts
//
// Login por dispositivo do Duplecast: https://duplecast.com/plugin/duplecast/device_login/
// (mac + device_key — não usa login de revendedor).
//   - Login: POST device_login/ {mac, device_key} → sessão fica presa a ESSE
//     dispositivo (sem precisar filtrar por MAC nas próximas chamadas).
//   - device_main/ mostra "Expire on DD/MM/YYYY" — vencimento real do
//     dispositivo.
//   - Add Playlist: device_main/add/, form_action=generate_m3u_playlist
//     (m3u_name, m3u_playlist, epg_url, note, locked/pin/confirm_pin).
//   - Delete (device_main/delete/{id}/) exige POST com _csrf_token+0+submit=Yes
//     (GET sozinho não apaga). Nunca pede PIN, mesmo pra playlist marcada
//     "Protected" — só o Edit pede PIN via modal.
// Login por device_key elimina a dependência do login_email/login_password
// de revendedor pra esse app (esses campos continuam salvos em
// app_integrations por histórico, mas não são mais usados aqui).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function deviceLogin(siteRoot: string, jar: CookieJar, mac: string, deviceKey: string) {
  const loginUrl = `${siteRoot}/plugin/duplecast/device_login/`;
  const getRes = await fetch(loginUrl, {
    headers: baseHeaders("", loginUrl),
    redirect: "follow",
  });
  jar.absorb(getRes.headers);
  const html = await getRes.text();
  const token = extractCsrfToken(html);
  if (!token) throw new Error("CSRF token não encontrado na página de login do dispositivo.");

  const params = new URLSearchParams();
  params.set("_csrf_token", token);
  params.set("mac", mac);
  params.set("device_key", deviceKey);

  const postRes = await fetch(loginUrl, {
    method: "POST",
    headers: baseHeaders(jar.toString(), loginUrl, true, siteRoot),
    body: params.toString(),
    redirect: "manual",
  });
  jar.absorb(postRes.headers);

  if (postRes.status !== 302 || String(postRes.headers.get("location") || "").includes("device_login")) {
    throw new Error("Login por Device ID/Device Key falhou no Duplecast. Confira o Device Key cadastrado nesse app.");
  }
}

async function fetchDeviceMain(siteRoot: string, jar: CookieJar): Promise<string> {
  const url = `${siteRoot}/plugin/duplecast/device_main/`;
  const res = await fetch(url, { headers: baseHeaders(jar.toString(), url), redirect: "follow" });
  jar.absorb(res.headers);
  return res.text();
}

// "Expire on 19/09/2026" (dd/mm/yyyy) → "2026-09-19"
function parseExpireDate(html: string): string | null {
  const m = html.match(/Expire on\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

type DuplecastPlaylistRow = { id: string; name: string; protected: boolean };

function parsePlaylistRows(html: string): DuplecastPlaylistRow[] {
  const rowMatches = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  const out: DuplecastPlaylistRow[] = [];
  for (const rowMatch of rowMatches) {
    const row = rowMatch[1];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").trim());
    if (cells.length < 3 || cells[0] !== "xtream") continue;
    const idMatch = row.match(/data-id="(\d+)"/);
    if (!idMatch) continue;
    out.push({ id: idMatch[1], name: cells[1], protected: !/UnProtected/i.test(cells[2]) });
  }
  return out;
}

async function createPlaylist(
  siteRoot: string,
  jar: CookieJar,
  { m3uName, m3uUrl, pin }: { m3uName: string; m3uUrl: string; pin: string },
) {
  const addUrl = `${siteRoot}/plugin/duplecast/device_main/add/`;
  const getRes = await fetch(addUrl, {
    headers: baseHeaders(jar.toString(), `${siteRoot}/plugin/duplecast/device_main/`),
    redirect: "follow",
  });
  jar.absorb(getRes.headers);
  const html = await getRes.text();
  const token = extractCsrfToken(html);
  if (!token) throw new Error("CSRF token não encontrado no formulário de criação.");

  const params = new URLSearchParams();
  params.set("_csrf_token", token);
  params.set("form_action", "generate_m3u_playlist");
  params.set("m3u_name", m3uName || "Playlist");
  params.set("m3u_playlist", m3uUrl);
  params.set("epg_url", "");
  params.set("note", "");
  if (pin) {
    params.set("locked", "1");
    params.set("pin", pin);
    params.set("confirm_pin", pin);
  }

  const postRes = await fetch(addUrl, {
    method: "POST",
    headers: baseHeaders(jar.toString(), addUrl, true, siteRoot),
    body: params.toString(),
    redirect: "manual",
  });
  jar.absorb(postRes.headers);

  const ok = postRes.status === 302 || postRes.status === 200;
  if (!ok) {
    const errText = await postRes.text().catch(() => "");
    throw new Error(`Falha ao criar playlist no Duplecast (HTTP ${postRes.status}). ${errText.slice(0, 200)}`);
  }
}

// Playlist "Protected" exige PIN pra deletar de verdade — o modal real do
// site combina "Please Confirm" + campo "Enter Pin" numa coisa só. SEM o
// pin, o Duplecast ainda responde 302 (redireciona de volta pra
// device_main/) só que SEM apagar nada — por isso nunca confiamos no status
// HTTP aqui: sempre reconsulta a lista depois pra confirmar que a playlist
// sumiu de verdade.
async function playlistExists(siteRoot: string, jar: CookieJar, id: string): Promise<boolean> {
  const html = await fetchDeviceMain(siteRoot, jar);
  return parsePlaylistRows(html).some((r) => r.id === id);
}

async function deletePlaylistByName(siteRoot: string, jar: CookieJar, searchName: string, pin: string) {
  const mainHtml = await fetchDeviceMain(siteRoot, jar);
  let token = extractCsrfToken(mainHtml);
  if (!token) throw new Error("CSRF token não encontrado na página do dispositivo.");

  const rows = parsePlaylistRows(mainHtml);
  const targetLower = searchName.toLowerCase();
  const target =
    rows.find((r) => r.name.toLowerCase() === targetLower) ||
    rows.find((r) => r.name.toLowerCase().includes(targetLower) || targetLower.includes(r.name.toLowerCase())) ||
    (rows.length === 1 ? rows[0] : null);

  if (!target) {
    throw Object.assign(
      new Error(`Nenhuma playlist encontrada com o nome '${searchName}' nesse dispositivo (${rows.length} playlist(s) no total).`),
      { notFound: true },
    );
  }

  const delUrl = `${siteRoot}/plugin/duplecast/device_main/delete/${target.id}/`;
  const attempt = async (withPin: string) => {
    const params = new URLSearchParams();
    params.set("_csrf_token", token!);
    params.set("0", "");
    if (withPin) params.set("pin", withPin);
    params.set("submit", "Yes");
    await fetch(delUrl, {
      method: "POST",
      headers: baseHeaders(jar.toString(), `${siteRoot}/plugin/duplecast/device_main/`, true, siteRoot),
      body: params.toString(),
      redirect: "manual",
    });
  };

  await attempt(target.protected && pin ? pin : "");
  let stillThere = await playlistExists(siteRoot, jar, target.id);

  // Retry sem PIN — raras exceções têm playlist marcada protegida mas com
  // um PIN diferente do cadastrado (ou o cadastrado mudou depois). Só tenta
  // de novo se a 1ª tentativa mandou pin — sem isso repetir a mesma chamada
  // não muda nada.
  if (stillThere && target.protected && pin) {
    const freshHtml = await fetchDeviceMain(siteRoot, jar);
    token = extractCsrfToken(freshHtml) || token;
    await attempt("");
    stillThere = await playlistExists(siteRoot, jar, target.id);
  }

  if (stillThere) {
    throw new Error(
      target.protected
        ? "Não foi possível apagar — playlist protegida por PIN incorreto."
        : "Não foi possível apagar a playlist.",
    );
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
    const { action, macValue, finalServerName, m3uUrl, password, username, deviceKey } = body;

    if (!action) {
      return NextResponse.json({ ok: false, error: "action é obrigatório." }, { status: 400 });
    }
    if (!macValue) {
      return NextResponse.json({ ok: false, error: "macValue é obrigatório." }, { status: 400 });
    }
    if (!deviceKey) {
      return NextResponse.json(
        { ok: false, error: "Device Key é obrigatório pro Duplecast agora — preencha o campo 'Device Key' desse app." },
        { status: 400 },
      );
    }

    // Só precisa de api_url pra saber o domínio (login_email/login_password
    // ficam salvos por histórico, mas não são mais usados por essa rota).
    const { data: integ, error: integErr } = await supabase
      .from("app_integrations")
      .select("api_url")
      .eq("app_name", "DUPLECAST")
      .maybeSingle();

    if (integErr || !integ?.api_url) {
      return NextResponse.json({ ok: false, error: "Integração Duplecast não configurada." }, { status: 500 });
    }

    const siteRoot = new URL(integ.api_url).origin;
    const jar = new CookieJar();
    await deviceLogin(siteRoot, jar, macValue, deviceKey);

    // ===========================================================
    // ACTION: check — vencimento REAL, direto do "Expire on" da página do
    // dispositivo. Sem criar/alterar nada.
    // ===========================================================
    if (action === "check") {
      const html = await fetchDeviceMain(siteRoot, jar);
      const expireDate = parseExpireDate(html);
      return NextResponse.json({
        ok: true,
        expireDate,
        message: expireDate ? "Vencimento atualizado." : "Não foi possível localizar o vencimento no painel.",
      });
    }

    // ===========================================================
    // ACTION: create — cria a playlist e já aproveita pra buscar o
    // vencimento real (best-effort) da mesma página.
    // ===========================================================
    if (action === "create") {
      if (!m3uUrl) {
        return NextResponse.json({ ok: false, error: "m3uUrl é obrigatório para create." }, { status: 400 });
      }

      let pin = String(password || "").replace(/\D/g, "");
      if (pin.length < 4) pin = "";

      await createPlaylist(siteRoot, jar, { m3uName: finalServerName || "Playlist", m3uUrl, pin });

      let expireDate: string | null = null;
      try {
        const mainHtml = await fetchDeviceMain(siteRoot, jar);
        expireDate = parseExpireDate(mainHtml);
      } catch {
        // não bloqueia o create
      }

      return NextResponse.json({ ok: true, expireDate, message: "Playlist configurada com sucesso." });
    }

    // ===========================================================
    // ACTION: delete — acha a playlist pelo nome na lista do próprio
    // dispositivo (já vem filtrada por MAC pela sessão) e apaga.
    // ===========================================================
    if (action === "delete") {
      const searchName = String(username || finalServerName || "").trim();
      if (!searchName) {
        return NextResponse.json({ ok: false, error: "Nome do servidor não informado." }, { status: 400 });
      }

      let delPin = String(password || "").replace(/\D/g, "");
      if (delPin.length < 4) delPin = "";

      try {
        await deletePlaylistByName(siteRoot, jar, searchName, delPin);
      } catch (e: any) {
        if (e?.notFound) {
          return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
        }
        throw e;
      }

      return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
    }

    return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete | check" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Erro interno." }, { status: 500 });
  }
}
