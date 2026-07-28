// app/api/integrations/apps/iptvduplex/route.ts
//
// IPTV Duplex Play (iptvduplex.com) — NÃO confundir com "DuplexPlay"
// (app descontinuado no catálogo, recomenda migrar pra DupleCast — ver
// lib/apps/panel.ts) nem com o handler "DUPLECAST" (duplecast.com, outro
// site). Vendor diferente da família IBO/Messi/BOB — esse aqui é Next.js,
// com marcas irmãs no mesmo backend (api.i-player.live, api.ibopremium.com,
// api.ottplus.app etc.).
//
// Fluxo (SEM captcha, diferente da família IBO):
//   1. GET  {base}/validate_mac?mac=X       → {message:{auth_type: "device_key"|"code", ...}}
//      auth_type decide se o login manda "key" ou "code" — mesmo valor do
//      campo Device Key do app, só muda o nome da chave no JSON.
//   2. POST {base}/login_by_mac             {mac, key|code} → {message: <JWT>}
//      (sem captcha — mais simples que IBO/Messi/BOB)
//   3. GET  {base}/device                   (Bearer) → {message:{..., activation_expired,
//      playlists:[{id, name, url, is_protected, expired_date, ...}]}}
//      activation_expired = validade da CONTA/dispositivo inteiro;
//      cada playlist tem seu próprio expired_date (vencimento do m3u em si,
//      é esse que usamos pro campo "date" do app — populado pelo backend
//      deles depois de checar o m3u, não vem na hora da criação).
//   4. POST {base}/playlist_with_mac (multipart/form-data, SEM login)
//      {name, mac, url, is_protected:"true", pin, new_pin, confirm_pin}
//      → cria playlist direto por mac, sem precisar logar antes.
//   5. DELETE {base}/palylist_from_web (Bearer) {id, pin?} → remove
//      (nome com erro de digitação é deles mesmo, "palylist")
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

async function validateMac(base: string, mac: string): Promise<{ authType: string }> {
  const res = await fetch(`${base}validate_mac?mac=${encodeURIComponent(mac)}`, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || json?.error || !json?.message) {
    throw new Error(json?.message || "MAC não encontrado ou inválido no IPTV Duplex Play.");
  }
  return { authType: json.message.auth_type || "device_key" };
}

async function login(base: string, mac: string, deviceKey: string): Promise<string> {
  const { authType } = await validateMac(base, mac);
  const body: Record<string, string> = { mac };
  if (authType === "device_key") body.key = deviceKey;
  else body.code = deviceKey;

  const res = await fetch(`${base}login_by_mac`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || json?.error || !json?.message) {
    throw new Error(json?.message || "Falha no login do IPTV Duplex Play — confira MAC e Device Key.");
  }
  return json.message as string;
}

async function getDevice(base: string, authToken: string): Promise<{ playlists: any[]; activationExpired: string | null }> {
  const res = await fetch(`${base}device`, {
    method: "GET",
    headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json", "User-Agent": UA },
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || json?.error) {
    throw new Error(json?.message || "Falha ao consultar dispositivo no IPTV Duplex Play.");
  }
  return {
    playlists: json?.message?.playlists || [],
    activationExpired: json?.message?.activation_expired || null,
  };
}

async function createPlaylistByMac(
  base: string,
  mac: string,
  { name, url, pin }: { name: string; url: string; pin: string },
) {
  const form = new FormData();
  form.append("name", name || "Playlist");
  form.append("mac", mac);
  form.append("url", url);
  if (pin) {
    form.append("is_protected", "true");
    form.append("pin", pin);
    form.append("new_pin", pin);
    form.append("confirm_pin", pin);
  }

  const res = await fetch(`${base}playlist_with_mac`, {
    method: "POST",
    headers: { Accept: "application/json", "User-Agent": UA },
    body: form,
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || json?.error) {
    throw new Error(json?.message || `Falha ao criar playlist no IPTV Duplex Play (status ${res.status}).`);
  }
}

async function deletePlaylistByName(base: string, authToken: string, searchName: string, pin: string) {
  const { playlists } = await getDevice(base, authToken);
  if (!playlists.length) {
    throw Object.assign(new Error("Nenhuma playlist encontrada neste dispositivo."), { notFound: true });
  }

  const targetLower = searchName.toLowerCase().trim();
  const match =
    playlists.find((p) => String(p.name || "").toLowerCase().trim() === targetLower) ||
    playlists.find(
      (p) =>
        String(p.name || "").toLowerCase().includes(targetLower) ||
        targetLower.includes(String(p.name || "").toLowerCase()),
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

  const delRes = await fetch(`${base}palylist_from_web`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, "User-Agent": UA },
    body: JSON.stringify(match.is_protected ? { id: match.id, pin } : { id: match.id }),
  });
  const delJson = await delRes.json().catch(() => null);
  if (delRes.status !== 200 || delJson?.error) {
    throw new Error(delJson?.message || "Falha ao remover playlist no IPTV Duplex Play.");
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
        { ok: false, error: "Device Key é obrigatório pro IPTV Duplex Play — preencha o campo 'Device Key' desse app." },
        { status: 400 },
      );
    }

    const { data: integ, error: integErr } = await supabase
      .from("app_integrations")
      .select("api_url")
      .eq("app_name", "IPTVDUPLEX")
      .maybeSingle();

    if (integErr || !integ?.api_url) {
      return NextResponse.json({ ok: false, error: "Integração IPTV Duplex Play não configurada." }, { status: 500 });
    }
    // O Link do Painel cadastrado é o site principal (ex: https://iptvduplex.com,
    // igual aos outros apps da tela de Integrações) — a API de verdade mora no
    // subdomínio api.*, então resolve isso aqui em vez de exigir que o admin
    // descubra e cadastre o subdomínio certo.
    const siteUrl = new URL(integ.api_url);
    const bareHost = siteUrl.hostname.replace(/^www\./, "");
    const apiHost = bareHost.startsWith("api.") ? bareHost : `api.${bareHost}`;
    const base = `${siteUrl.protocol}//${apiHost}/api/`;

    // ===========================================================
    // ACTION: check — vencimento REAL da playlist específica
    // (expired_date), com fallback pro vencimento da conta inteira
    // (activation_expired) se a playlist ainda não tiver sido checada
    // pelo backend deles. Sem criar/alterar nada.
    // ===========================================================
    if (action === "check") {
      const searchName = String(username || finalServerName || "").trim();
      const authToken = await login(base, macValue, deviceKey);
      const { playlists, activationExpired } = await getDevice(base, authToken);

      const targetLower = searchName.toLowerCase();
      const match = playlists.find((p) => String(p.name || "").toLowerCase().trim() === targetLower);
      const expireDate = match?.expired_date || activationExpired || null;

      return NextResponse.json({
        ok: true,
        expireDate,
        message: expireDate ? "Vencimento atualizado." : "Não foi possível localizar o vencimento no painel.",
      });
    }

    // ===========================================================
    // ACTION: create — não precisa de login (playlist_with_mac aceita
    // direto por mac). Tenta um GET device best-effort pra pegar o
    // expired_date real, mas normalmente vem null na hora (o backend deles
    // populam depois de checar o m3u).
    // ===========================================================
    if (action === "create") {
      if (!m3uUrl) {
        return NextResponse.json({ ok: false, error: "m3uUrl é obrigatório para create." }, { status: 400 });
      }

      const pin = String(password || "").replace(/\D/g, "");
      await createPlaylistByMac(base, macValue, { name: finalServerName || "Playlist", url: m3uUrl, pin });

      let expireDate: string | null = null;
      try {
        const authToken = await login(base, macValue, deviceKey);
        const { playlists, activationExpired } = await getDevice(base, authToken);
        const created = playlists.find(
          (p) => String(p.name || "").toLowerCase().trim() === String(finalServerName || "").toLowerCase().trim(),
        );
        // Mesmo fallback do "check": o expired_date da playlist em si só vem
        // depois que o parceiro valida o m3u de forma assíncrona (sempre
        // null na hora de criar), então sem o fallback pro vencimento da
        // conta o create não tem nada pra mostrar.
        expireDate = created?.expired_date || activationExpired || null;
      } catch {
        // best-effort — create já foi feito, não bloqueia
      }

      return NextResponse.json({ ok: true, expireDate, message: "Playlist configurada com sucesso." });
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
      const authToken = await login(base, macValue, deviceKey);

      try {
        await deletePlaylistByName(base, authToken, searchName, pin);
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
