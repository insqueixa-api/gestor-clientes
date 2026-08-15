// app/api/integrations/apps/iboplayer/route.ts
//
// IBO Player (iboplayer.com) — mesma "unified-backend" branca usada por
// MessiTV e BOB Player (ver messitv/route.ts e bobplayer/route.ts). Site
// DIFERENTE do domínio activation.iboplayer.com (hoje sem uso aqui).
// Handler standalone, cobre create/delete/check.
//
// Auth: igual MessiTV — login devolve JWT Bearer no corpo (sem cookie). MAS
// a listagem usa GET (igual BOB Player), não POST como no MessiTV — não
// assumir que é igual só porque o token é Bearer.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { Resvg } from "@resvg/resvg-js";
import { callGemini } from "@/lib/whatsapp/gemini-client";
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
    "x-client-origin": siteRoot,
    referer: `${siteRoot}/`,
  };
}

// Mesmo achado do MessiTV/BOB Player: width/height duplicados na tag <svg>
// quebram o parser XML estrito do resvg.
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
  if (!data?.svg || !data?.token) throw new Error("Falha ao gerar captcha do IBO Player.");

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
    // ✅ 15s -> 25s (14/08/2026): achado ao vivo — o modelo por trás de
    // "gemini-flash-latest" hoje "pensa" antes de responder (mesmo achado já
    // documentado em generate-variant/route.ts), um captcha real (imagem
    // maior, texto de verdade) passava dos 15s e abortava sempre. 25s dá
    // folga real sem deixar a rota pendurada pra sempre — maxDuration=60 no
    // topo do arquivo garante que a função da Vercel não mata antes disso.
    25_000,
  );
  const answer = geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!answer) throw new Error("Não foi possível ler o captcha do IBO Player.");
  return { token: data.token, answer: answer.toUpperCase() };
}

async function iboPlayerLogin(
  siteRoot: string,
  macAddress: string,
  deviceKey: string,
  geminiKey: string,
): Promise<{ authToken: string; device: any }> {
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
    if (res.status === 200 && json?.token) return { authToken: json.token, device: json.device };
    lastError = json?.message || `status ${res.status}`;
  }
  throw new Error(`Falha no login do IBO Player (mac/device key ou captcha): ${lastError}`);
}

async function listPlaylists(siteRoot: string, authToken: string): Promise<{ playlists: any[]; device: any }> {
  const res = await fetch(`${siteRoot}/frontend/device/playlists`, {
    method: "GET",
    headers: { Authorization: `Bearer ${authToken}`, Accept: "application/json", "User-Agent": UA, ...originHeaders(siteRoot) },
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200) throw new Error(json?.message || `Falha ao listar playlists (status ${res.status}).`);
  return { playlists: json?.playlists || [], device: json?.device };
}

async function savePlaylist(
  siteRoot: string,
  authToken: string,
  deviceId: string,
  { name, url, pin }: { name: string; url: string; pin: string },
) {
  const res = await fetch(`${siteRoot}/frontend/device/savePlaylist`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
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
      // ⚠️ iboplayer.com espera STRING "true"/"false" aqui, não 1/0 (diferente
      // de messitvplayer.com e bobplayer.com) — confirmado no bundle JS do
      // site (protect:d?"true":"false") depois que um create real veio com
      // is_protected:0 mesmo mandando protect:1 + pin preenchido.
      protect: pin ? "true" : "false",
      xml_url: "",
      pin: pin || "",
      device_id: deviceId,
    }),
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || json?.status !== "success") {
    throw new Error(json?.msg || json?.message || `Falha ao criar playlist no IBO Player (status ${res.status}).`);
  }
}

async function deletePlaylistByName(
  siteRoot: string,
  authToken: string,
  searchName: string,
  pin: string,
) {
  const { playlists } = await listPlaylists(siteRoot, authToken);
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
      Authorization: `Bearer ${authToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...originHeaders(siteRoot),
    },
    body: match.is_protected ? JSON.stringify({ pin }) : undefined,
  });
  const delJson = await delRes.json().catch(() => null);
  if (delRes.status !== 200 || delJson?.status !== "success") {
    throw new Error(delJson?.message || "Falha ao remover playlist no IBO Player.");
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
        { ok: false, error: "Device Key é obrigatório pro IBO Player — preencha o campo 'Device Key' desse app." },
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
      .eq("app_name", "IBOPLAYER")
      .maybeSingle();

    if (integErr || !integ?.api_url) {
      return NextResponse.json({ ok: false, error: "Integração IBO Player não configurada." }, { status: 500 });
    }
    const siteRoot = new URL(integ.api_url).origin;

    // ===========================================================
    // ACTION: check — vencimento REAL, direto do device.expire_date
    // devolvido pelo próprio login. Sem criar/alterar nada.
    // ===========================================================
    if (action === "check") {
      const { device } = await iboPlayerLogin(siteRoot, macValue, deviceKey, geminiKey);
      const expireDate = extractDateOnly(device?.expire_date);
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
      const { authToken, device } = await iboPlayerLogin(siteRoot, macValue, deviceKey, geminiKey);
      await savePlaylist(siteRoot, authToken, device._id, { name: finalServerName || "Playlist", url: m3uUrl, pin });

      return NextResponse.json({
        ok: true,
        expireDate: extractDateOnly(device?.expire_date),
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
      const { authToken } = await iboPlayerLogin(siteRoot, macValue, deviceKey, geminiKey);

      try {
        await deletePlaylistByName(siteRoot, authToken, searchName, pin);
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
