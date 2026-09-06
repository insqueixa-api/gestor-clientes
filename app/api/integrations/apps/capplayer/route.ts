// app/api/integrations/apps/capplayer/route.ts
//
// CAP Player (capplayer.com) — descoberto ao vivo em 06/09/2026 (login real
// testado com MAC/Key do Márcio via curl antes de escrever este código).
// Backend PRÓPRIO (Express simples, server-rendered com jQuery) — NÃO é a
// "unified-backend" branca do MessiTV/BOB Player/IBO Player (sem captcha,
// sem JWT). Auth 100% por cookie de sessão criado num POST /login normal.
//
// Fluxo real (confirmado, sem doc oficial):
//   1. POST /login (form-urlencoded) {mac_address, device_key}
//      → 302 Location: /mylist + Set-Cookie: express:sess(+.sig) (sucesso)
//        302 Location: /login (mac/key errados — sem cookie novo)
//   2. GET  /mylist (Cookie) → HTML server-rendered com:
//        - #expire-date (vencimento real, YYYY-MM-DD)
//        - tabela de playlists, cada linha com .playlist-url-delete
//          [data-current_id, data-protected] (mesmo esquema client-side de
//          /frontend/playlist.js, reaproveitado no render inicial)
//   3. POST /savePlaylist (form-urlencoded, Cookie) {current_playlist_url_id:-1,
//      playlist_name, playlist_url, playlist_type:'general', protect, pin,
//      user_name:'', password:''} → {status:'success', data:{...}}
//   4. GET  /checkPlaylistPinCode/{id}/{pin} (Cookie) — só quando a playlist
//      alvo do delete está protegida (data-protected="1")
//   5. DELETE /deletePlayListUrl (form-urlencoded, Cookie) {playlist_url_id}
//      → {status:'success'}
//
// Sem sessão persistida entre chamadas — cada action loga de novo, mesmo
// padrão do MessiTV/BOB Player/IBO Player.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";
import { extractDateOnly } from "@/lib/apps/panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

function originHeaders(siteRoot: string) {
  return {
    origin: siteRoot,
    referer: `${siteRoot}/login`,
  };
}

function extractCookieString(headers: Headers): string {
  const rawList: string[] =
    typeof (headers as any).getSetCookie === "function"
      ? (headers as any).getSetCookie()
      : (headers.get("set-cookie") || "").split(/,(?=[^ ])/).filter(Boolean);
  return rawList.map((c) => c.split(";")[0]).join("; ");
}

async function capPlayerLogin(siteRoot: string, macAddress: string, deviceKey: string): Promise<{ cookie: string }> {
  const res = await fetch(`${siteRoot}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html",
      "User-Agent": UA,
      ...originHeaders(siteRoot),
    },
    body: new URLSearchParams({ mac_address: macAddress, device_key: deviceKey }).toString(),
  });

  const cookie = extractCookieString(res.headers);
  const location = res.headers.get("location") || "";
  if (!cookie || !/\/mylist/i.test(location)) {
    throw new Error("Falha no login do CAP Player — confira o MAC/Device Key.");
  }
  return { cookie };
}

type CapPlaylistRow = { id: string; name: string; isProtected: boolean };

async function getDeviceInfo(siteRoot: string, cookie: string): Promise<{ expireDate: string | null; playlists: CapPlaylistRow[] }> {
  const res = await fetch(`${siteRoot}/mylist`, {
    headers: { Accept: "text/html", "User-Agent": UA, Cookie: cookie, ...originHeaders(siteRoot) },
  });
  const html = await res.text();
  if (res.status !== 200) {
    throw new Error(`Falha ao acessar o painel do CAP Player (status ${res.status}).`);
  }

  const expireMatch = html.match(/id="expire-date">\s*([^<]*)</);
  const expireDate = extractDateOnly(expireMatch?.[1]?.trim());

  const playlists: CapPlaylistRow[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html))) {
    const row = rowMatch[1];
    const idMatch = row.match(/playlist-url-delete[^>]*data-current_id="([^"]+)"/);
    if (!idMatch) continue;
    const protectedMatch = row.match(/data-protected="([^"]*)"/);
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
    playlists.push({ id: idMatch[1], name: cells[0] || "", isProtected: protectedMatch?.[1] === "1" });
  }

  return { expireDate, playlists };
}

async function savePlaylist(
  siteRoot: string,
  cookie: string,
  { name, url, pin }: { name: string; url: string; pin: string },
) {
  const res = await fetch(`${siteRoot}/savePlaylist`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      ...originHeaders(siteRoot),
    },
    body: new URLSearchParams({
      current_playlist_url_id: "-1",
      playlist_name: name || "Playlist",
      playlist_url: url,
      playlist_type: "general",
      protect: pin ? "1" : "0",
      pin: pin || "",
      user_name: "",
      password: "",
    }).toString(),
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || json?.status !== "success") {
    throw new Error(json?.msg || json?.message || `Falha ao criar playlist no CAP Player (status ${res.status}).`);
  }
}

async function deletePlaylistByName(siteRoot: string, cookie: string, searchName: string, pin: string) {
  const { playlists } = await getDeviceInfo(siteRoot, cookie);
  if (!playlists.length) {
    throw Object.assign(new Error("Nenhuma playlist encontrada neste dispositivo."), { notFound: true });
  }

  const targetLower = searchName.toLowerCase().trim();
  const match =
    playlists.find((p) => p.name.toLowerCase().trim() === targetLower) ||
    playlists.find((p) => p.name.toLowerCase().includes(targetLower) || targetLower.includes(p.name.toLowerCase())) ||
    (playlists.length === 1 ? playlists[0] : null);

  if (!match) {
    throw Object.assign(
      new Error(`Nenhuma playlist encontrada com o nome '${searchName}' nesse dispositivo (${playlists.length} playlist(s) no total).`),
      { notFound: true },
    );
  }

  if (match.isProtected) {
    if (!pin) throw new Error("Esta playlist está protegida por PIN e nenhum PIN está configurado no app.");
    const checkRes = await fetch(`${siteRoot}/checkPlaylistPinCode/${match.id}/${encodeURIComponent(pin)}`, {
      headers: { Accept: "application/json", "User-Agent": UA, Cookie: cookie, ...originHeaders(siteRoot) },
    });
    const checkJson = await checkRes.json().catch(() => null);
    if (checkJson?.status === "error") {
      throw new Error(checkJson?.msg || "PIN incorreto para essa playlist no CAP Player.");
    }
  }

  const delRes = await fetch(`${siteRoot}/deletePlayListUrl`, {
    method: "DELETE",
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      ...originHeaders(siteRoot),
    },
    body: new URLSearchParams({ playlist_url_id: match.id }).toString(),
  });
  const delJson = await delRes.json().catch(() => null);
  if (delRes.status !== 200 || delJson?.status !== "success") {
    throw new Error(delJson?.msg || delJson?.message || "Falha ao remover playlist no CAP Player.");
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
        { ok: false, error: "Device Key é obrigatório pro CAP Player — preencha o campo 'Device Key' desse app." },
        { status: 400 },
      );
    }

    const { data: integ, error: integErr } = await supabase
      .from("app_integrations")
      .select("api_url")
      .eq("app_name", "CAPPLAYER")
      .maybeSingle();

    if (integErr || !integ?.api_url) {
      return NextResponse.json({ ok: false, error: "Integração CAP Player não configurada." }, { status: 500 });
    }
    const siteRoot = new URL(integ.api_url).origin;

    // ===========================================================
    // ACTION: check — vencimento REAL, direto do painel /mylist.
    // ===========================================================
    if (action === "check") {
      const { cookie } = await capPlayerLogin(siteRoot, macValue, deviceKey);
      const { expireDate } = await getDeviceInfo(siteRoot, cookie);
      return NextResponse.json({
        ok: true,
        expireDate,
        message: expireDate ? "Vencimento atualizado." : "Não foi possível localizar o vencimento no painel.",
      });
    }

    // ===========================================================
    // ACTION: create — cria a playlist e devolve o expire_date atual.
    // ===========================================================
    if (action === "create") {
      if (!m3uUrl) {
        return NextResponse.json({ ok: false, error: "m3uUrl é obrigatório para create." }, { status: 400 });
      }

      const pin = String(password || "").replace(/\D/g, "");
      const { cookie } = await capPlayerLogin(siteRoot, macValue, deviceKey);
      await savePlaylist(siteRoot, cookie, { name: finalServerName || "Playlist", url: m3uUrl, pin });
      const { expireDate } = await getDeviceInfo(siteRoot, cookie);

      return NextResponse.json({
        ok: true,
        expireDate,
        message: "Playlist configurada com sucesso.",
      });
    }

    // ===========================================================
    // ACTION: delete — acha a playlist pelo nome na lista do próprio
    // dispositivo e apaga.
    // ===========================================================
    if (action === "delete") {
      const searchName = String(username || finalServerName || "").trim();
      if (!searchName) {
        return NextResponse.json({ ok: false, error: "Nome do servidor não informado." }, { status: 400 });
      }

      const pin = String(password || "").replace(/\D/g, "");
      const { cookie } = await capPlayerLogin(siteRoot, macValue, deviceKey);

      try {
        await deletePlaylistByName(siteRoot, cookie, searchName, pin);
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
