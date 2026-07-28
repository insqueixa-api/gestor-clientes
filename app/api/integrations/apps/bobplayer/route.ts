// app/api/integrations/apps/bobplayer/route.ts
//
// BOB Player (bobplayer.com) — mesma "unified-backend" branca usada por
// MessiTV (messitvplayer.com) e IBO Player (iboplayer.com, ver
// iboplayer/route.ts). Endpoints idênticos (/frontend/captcha/generate,
// /frontend/device/login, .../savePlaylist, .../deletePlayListUrl), MAS
// auth transport DIFERENTE: bobplayer.com usa cookie de sessão Express
// (set-cookie no login, sem "token" no corpo), enquanto messitvplayer.com
// devolve um JWT Bearer no corpo. GET /frontend/device/playlists só
// funciona com o cookie — com Bearer devolve HTML de 404.
//
// Fluxo:
//   1. GET  /frontend/captcha/generate       → {svg, token}
//   2. Resvg renderiza o SVG em PNG → Gemini lê o texto → answer
//   3. POST /frontend/device/login            {mac_address, device_key, captcha, token}
//      → Set-Cookie: express:sess(+.sig); corpo {status:"success", device:{_id, expire_date, ...}}
//   4. GET  /frontend/device/playlists         (Cookie) → {device, playlists:[{_id, playlist_name, is_protected}]}
//   5. POST /frontend/device/savePlaylist      {playlist_name, playlist_url, playlist_type:"general",
//      protect, pin, device_id, ...} (Cookie)
//   6. DELETE /frontend/device/deletePlayListUrl/{playlist_id}  {device_id, pin?} (Cookie)
//
// Sem sessão persistida entre chamadas — cada action resolve o captcha e
// loga de novo (mesmo padrão do MessiTV/IBO Player).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { Resvg } from "@resvg/resvg-js";
import { callGemini } from "@/lib/whatsapp/gemini-client";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

function originHeaders(siteRoot: string) {
  return {
    origin: siteRoot,
    "x-client-origin": siteRoot,
    referer: `${siteRoot}/`,
  };
}

function extractCookieString(headers: Headers): string {
  const rawList: string[] =
    typeof (headers as any).getSetCookie === "function"
      ? (headers as any).getSetCookie()
      : (headers.get("set-cookie") || "").split(/,(?=[^ ])/).filter(Boolean);
  return rawList.map((c) => c.split(";")[0]).join("; ");
}

// Mesmo achado do MessiTV: width/height duplicados na tag <svg> quebram o
// parser XML estrito do resvg.
function sanitizeCaptchaSvg(svg: string): string {
  return svg.replace(/^<svg\b[^>]*>/, (openTag) => {
    let cleaned = openTag;
    for (const attr of ["width", "height"]) {
      const re = new RegExp(`\\s${attr}="[^"]*"`, "g");
      const matches = cleaned.match(re);
      if (matches && matches.length > 1) {
        let first = true;
        cleaned = cleaned.replace(re, (m) => {
          if (first) {
            first = false;
            return m;
          }
          return "";
        });
      }
    }
    return cleaned;
  });
}

async function solveCaptcha(siteRoot: string, geminiKey: string): Promise<{ token: string; answer: string }> {
  const res = await fetch(`${siteRoot}/frontend/captcha/generate`, {
    headers: { Accept: "application/json", "User-Agent": UA, ...originHeaders(siteRoot) },
  });
  const data = await res.json().catch(() => null);
  if (!data?.svg || !data?.token) throw new Error("Falha ao gerar captcha do BOB Player.");

  const png = new Resvg(sanitizeCaptchaSvg(data.svg), { fitTo: { mode: "width", value: 400 } })
    .render()
    .asPng();

  const geminiRes = await callGemini(
    geminiKey,
    {
      contents: [
        {
          parts: [
            {
              text: "Esta é uma imagem de captcha com texto distorcido sobre fundo preto. Responda APENAS com os caracteres exatos que você consegue ler (letras e/ou números), sem espaços, sem explicação.",
            },
            { inline_data: { mime_type: "image/png", data: png.toString("base64") } },
          ],
        },
      ],
    },
    15_000,
  );
  const answer = geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!answer) throw new Error("Não foi possível ler o captcha do BOB Player.");
  return { token: data.token, answer: answer.toUpperCase() };
}

async function bobPlayerLogin(
  siteRoot: string,
  macAddress: string,
  deviceKey: string,
  geminiKey: string,
): Promise<{ cookie: string; device: any }> {
  let lastError = "captcha não resolvido";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { token, answer } = await solveCaptcha(siteRoot, geminiKey);
    const res = await fetch(`${siteRoot}/frontend/device/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": UA,
        ...originHeaders(siteRoot),
      },
      body: JSON.stringify({ mac_address: macAddress, device_key: deviceKey, captcha: answer, token }),
    });
    const json = await res.json().catch(() => null);
    if (res.status === 200 && json?.status === "success") {
      const cookie = extractCookieString(res.headers);
      if (!cookie) throw new Error("Login do BOB Player não devolveu cookie de sessão.");
      return { cookie, device: json.device };
    }
    lastError = json?.message || `status ${res.status}`;
  }
  throw new Error(`Falha no login do BOB Player (mac/device key ou captcha): ${lastError}`);
}

async function listPlaylists(siteRoot: string, cookie: string): Promise<{ playlists: any[]; device: any }> {
  const res = await fetch(`${siteRoot}/frontend/device/playlists`, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": UA, Cookie: cookie, ...originHeaders(siteRoot) },
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200) throw new Error(json?.message || `Falha ao listar playlists (status ${res.status}).`);
  return { playlists: json?.playlists || [], device: json?.device };
}

async function savePlaylist(
  siteRoot: string,
  cookie: string,
  deviceId: string,
  { name, url, pin }: { name: string; url: string; pin: string },
) {
  const res = await fetch(`${siteRoot}/frontend/device/savePlaylist`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...originHeaders(siteRoot),
    },
    body: JSON.stringify({
      current_playlist_url_id: -1,
      playlist_url: url,
      playlist_name: name || "Playlist",
      username: "",
      password: "",
      playlist_type: "general",
      email: "",
      whatsapp: "",
      protect: pin ? 1 : 0,
      xml_url: "",
      pin: pin || "",
      device_id: deviceId,
    }),
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || json?.status !== "success") {
    throw new Error(json?.msg || json?.message || `Falha ao criar playlist no BOB Player (status ${res.status}).`);
  }
}

async function deletePlaylistByName(
  siteRoot: string,
  cookie: string,
  deviceId: string,
  searchName: string,
  pin: string,
) {
  const { playlists } = await listPlaylists(siteRoot, cookie);
  if (!playlists.length) {
    throw Object.assign(new Error("Nenhuma playlist encontrada neste dispositivo."), { notFound: true });
  }

  const targetLower = searchName.toLowerCase().trim();
  const match =
    playlists.find((p) => String(p.playlist_name || "").toLowerCase().trim() === targetLower) ||
    playlists.find(
      (p) =>
        String(p.playlist_name || "").toLowerCase().includes(targetLower) ||
        targetLower.includes(String(p.playlist_name || "").toLowerCase()),
    ) ||
    (playlists.length === 1 ? playlists[0] : null);

  if (!match) {
    throw Object.assign(
      new Error(`Nenhuma playlist encontrada com o nome '${searchName}' nesse dispositivo (${playlists.length} playlist(s) no total).`),
      { notFound: true },
    );
  }

  if (match.is_protected && !pin) {
    throw new Error("Esta playlist está protegida por PIN e nenhum PIN está configurado no app.");
  }

  const delRes = await fetch(`${siteRoot}/frontend/device/deletePlayListUrl/${match._id}`, {
    method: "DELETE",
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...originHeaders(siteRoot),
    },
    body: JSON.stringify(match.is_protected ? { device_id: deviceId, pin } : { device_id: deviceId }),
  });
  const delJson = await delRes.json().catch(() => null);
  if (delRes.status !== 200) {
    throw new Error(delJson?.message || delJson?.status || "Falha ao remover playlist no BOB Player.");
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
        { ok: false, error: "Device Key é obrigatório pro BOB Player — preencha o campo 'Device Key' desse app." },
        { status: 400 },
      );
    }

    const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
    if (!geminiKey) {
      return NextResponse.json({ ok: false, error: "GEMINI_API_KEY não configurada no servidor." }, { status: 500 });
    }

    const { data: integ, error: integErr } = await supabase
      .from("app_integrations")
      .select("api_url")
      .eq("app_name", "BOBPLAYER")
      .maybeSingle();

    if (integErr || !integ?.api_url) {
      return NextResponse.json({ ok: false, error: "Integração BOB Player não configurada." }, { status: 500 });
    }
    const siteRoot = new URL(integ.api_url).origin;

    // ===========================================================
    // ACTION: check — vencimento REAL, direto do device.expire_date
    // devolvido pelo próprio login. Sem criar/alterar nada.
    // ===========================================================
    if (action === "check") {
      const { device } = await bobPlayerLogin(siteRoot, macValue, deviceKey, geminiKey);
      const expireDate = device?.expire_date || null;
      return NextResponse.json({
        ok: true,
        expireDate,
        message: expireDate ? "Vencimento atualizado." : "Não foi possível localizar o vencimento no painel.",
      });
    }

    // ===========================================================
    // ACTION: create — cria a playlist e já aproveita o expire_date
    // devolvido pelo login.
    // ===========================================================
    if (action === "create") {
      if (!m3uUrl) {
        return NextResponse.json({ ok: false, error: "m3uUrl é obrigatório para create." }, { status: 400 });
      }

      const pin = String(password || "").replace(/\D/g, "");
      const { cookie, device } = await bobPlayerLogin(siteRoot, macValue, deviceKey, geminiKey);
      await savePlaylist(siteRoot, cookie, device._id, { name: finalServerName || "Playlist", url: m3uUrl, pin });

      return NextResponse.json({
        ok: true,
        expireDate: device?.expire_date || null,
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
      const { cookie, device } = await bobPlayerLogin(siteRoot, macValue, deviceKey, geminiKey);

      try {
        await deletePlaylistByName(siteRoot, cookie, device._id, searchName, pin);
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
