// app/api/integrations/apps/ottplayer/route.ts
//
// IPTV OTT Player (simpletv.live) — mesmo backend white-label do IPTV
// Duplex Play / IPTV Playerio (ver iptvplayerio/route.ts, que é o molde):
// confirmado ao vivo em 03/10/2026 com o device do Márcio (Insqueixa NaTV):
// api.simpletv.live responde com as mesmas rotas e os mesmos campos.
// Ciclo testado: criar playlist protegida por PIN → aparece na listagem →
// apagar com o PIN → lista volta vazia. Sem captcha, sem Cloudflare, sem VM.
//
// Fluxo:
//   1. GET  {base}validate_mac?mac=X  → {message:{auth_type:"device_key"|"code", payed, free_trial}}
//   2. POST {base}login_by_mac        {mac, key|code} → {message: <JWT>}
//   3. GET  {base}device              (Bearer) → {message:{payed, activation_expired,
//      free_trial, free_trial_expired, playlists:[{id, name, is_protected, expired_date}]}}
//   4. POST {base}playlist_with_mac   (multipart, SEM login) {name, mac, url,
//      is_protected:"true", pin, new_pin, confirm_pin} → cria (é o "adicionar
//      sem apagar": nunca mexe nas outras playlists do aparelho)
//   5. DELETE {base}palylist_from_web (Bearer) {id, pin?} → remove ("palylist" é deles)
//
// Diferenças de propósito em relação ao molde (03/10/2026):
//   • Vencimento = LICENÇA do app (activation_expired quando pago; senão o
//     fim do teste grátis, free_trial_expired, com isTrial:true — o aparelho
//     novo já vem com 7 dias de teste com data). O expired_date da playlist
//     é a validade do m3u (assinatura IPTV), não da licença do app.
//   • Apagar só pelo nome EXATO. O molde também apagava por nome parecido
//     ou "a única playlist do aparelho" — como Configurar sempre apaga antes
//     de criar, isso podia apagar uma playlist que o cliente pôs por conta.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";
import { extractDateOnly } from "@/lib/apps/panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRAND = "IPTV OTT Player";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

// O Cloudflare do parceiro corta rajadas (~7 chamadas seguidas → 429 por
// alguns instantes, às vezes uma página HTML) — medido ao vivo em 03/10/2026.
// Um "Configurar" (apagar + criar + conferir) fica perto disso, então 429 ou
// resposta que não é JSON = espera e tenta de novo, nunca vira um erro falso
// tipo "MAC não encontrado".
async function partnerFetch(url: string, init: RequestInit): Promise<{ status: number; json: any }> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1200 * attempt));
    const res = await fetch(url, init);
    lastStatus = res.status;
    const isJson = (res.headers.get("content-type") || "").includes("json");
    if (res.status === 429 || res.status === 503 || !isJson) {
      await res.text().catch(() => "");
      continue;
    }
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  throw new Error(`O ${BRAND} está recusando conexões agora (HTTP ${lastStatus}) — tente de novo em alguns segundos.`);
}

async function loginWith(base: string, body: Record<string, string>) {
  const { status, json } = await partnerFetch(`${base}login_by_mac`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify(body),
  });
  const ok = status === 200 && !json?.error && typeof json?.message === "string";
  return { ok, token: ok ? (json.message as string) : "", error: typeof json?.message === "string" ? json.message : "" };
}

// Login direto com "key" (1 chamada) — é o que todo aparelho usa na prática.
// Só se falhar pergunta ao parceiro se esse MAC usa "code" (validate_mac) —
// economiza 1 chamada por login (o parceiro corta rajadas, ver partnerFetch).
async function login(base: string, mac: string, deviceKey: string): Promise<string> {
  const first = await loginWith(base, { mac, key: deviceKey });
  if (first.ok) return first.token;

  const { status: vStatus, json: vJson } = await partnerFetch(`${base}validate_mac?mac=${encodeURIComponent(mac)}`, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (vStatus !== 200 || vJson?.error || !vJson?.message) {
    throw new Error(`MAC não encontrado no ${BRAND} — abra o app na TV uma vez e confira o MAC.`);
  }
  if (vJson.message.auth_type === "code") {
    const second = await loginWith(base, { mac, code: deviceKey });
    if (second.ok) return second.token;
  }
  throw new Error(
    /wrong key|invalid/i.test(first.error)
      ? `Device Key incorreta no ${BRAND} — confira o campo 'Device Key' desse app.`
      : `Falha no login do ${BRAND} — confira MAC e Device Key.`,
  );
}

type DeviceInfo = { playlists: any[]; expireDate: string | null; isTrial: boolean };

async function getDevice(base: string, authToken: string): Promise<DeviceInfo> {
  const { status, json } = await partnerFetch(`${base}device`, {
    method: "GET",
    headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json", "User-Agent": UA },
  });
  if (status !== 200 || json?.error) {
    throw new Error(json?.message || `Falha ao consultar o aparelho no ${BRAND}.`);
  }
  const dev = json?.message || {};
  const payed = !!dev.payed;
  const paidUntil = dev.activation_expired || dev.expired || null;
  const isTrial = !payed && !paidUntil && !!dev.free_trial;
  return {
    playlists: Array.isArray(dev.playlists) ? dev.playlists : [],
    expireDate: extractDateOnly(paidUntil || (isTrial ? dev.free_trial_expired : null)),
    isTrial,
  };
}

async function createPlaylistByMac(base: string, mac: string, { name, url, pin }: { name: string; url: string; pin: string }) {
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
  const { status, json } = await partnerFetch(`${base}playlist_with_mac`, {
    method: "POST",
    headers: { Accept: "application/json", "User-Agent": UA },
    body: form,
  });
  if (status !== 200 || json?.error) {
    throw new Error(json?.message || `Falha ao criar a playlist no ${BRAND} (status ${status}).`);
  }
}

async function deletePlaylistByName(base: string, authToken: string, searchName: string, pin: string) {
  const { playlists } = await getDevice(base, authToken);
  const target = searchName.toLowerCase().trim();
  const matches = playlists.filter((p) => String(p.name || "").toLowerCase().trim() === target);
  if (!matches.length) {
    throw Object.assign(
      new Error(`Nenhuma playlist com o nome '${searchName}' nesse aparelho (${playlists.length} playlist(s) no total).`),
      { notFound: true },
    );
  }
  // Pode haver repetidas com o mesmo nome (ex: configurado 2x antes) — apaga todas
  for (const match of matches) {
    if (match.is_protected && !pin) {
      throw new Error("Essa playlist está protegida por PIN e nenhum PIN está configurado na integração.");
    }
    const { status: delStatus, json: delJson } = await partnerFetch(`${base}palylist_from_web`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, "User-Agent": UA },
      body: JSON.stringify(match.is_protected ? { id: match.id, pin } : { id: match.id }),
    });
    if (delStatus !== 200 || delJson?.error) {
      throw new Error(delJson?.message || `Falha ao remover a playlist no ${BRAND}.`);
    }
  }
}

function trialMessage(info: Pick<DeviceInfo, "expireDate" | "isTrial">, okText: string) {
  if (info.isTrial) return info.expireDate ? "Ainda no teste grátis — vencimento do teste atualizado." : "Em teste grátis.";
  return info.expireDate ? okText : "Não encontrei o vencimento da licença nesse aparelho.";
}

export async function POST(req: Request) {
  try {
    if (hasBadInternalHeader(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const internal = isInternalRequest(req);

    let supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdmin>;
    if (internal) {
      supabase = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    } else {
      supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, macValue, finalServerName, m3uUrl, password, username, deviceKey } = body;

    if (!action) return NextResponse.json({ ok: false, error: "action é obrigatório." }, { status: 400 });
    if (!macValue) return NextResponse.json({ ok: false, error: "macValue é obrigatório." }, { status: 400 });
    if (!deviceKey) {
      return NextResponse.json(
        { ok: false, error: `Device Key é obrigatório pro ${BRAND} — preencha o campo 'Device Key' desse app.` },
        { status: 400 },
      );
    }

    const { data: integ, error: integErr } = await supabase
      .from("app_integrations")
      .select("api_url")
      .eq("app_name", "OTTPLAYER")
      .maybeSingle();
    if (integErr || !integ?.api_url) {
      return NextResponse.json({ ok: false, error: `Integração ${BRAND} não configurada.` }, { status: 500 });
    }
    // Link do Painel = site principal (https://simpletv.live/...) — a API mora
    // no subdomínio api.* (mesma regra do IPTVDUPLEX/IPTVPLAYERIO).
    const siteUrl = new URL(integ.api_url);
    const bareHost = siteUrl.hostname.replace(/^www\./, "");
    const apiHost = bareHost.startsWith("api.") ? bareHost : `api.${bareHost}`;
    const base = `${siteUrl.protocol}//${apiHost}/api/`;

    // ── check: vencimento da licença (ou do teste grátis), só leitura ──
    if (action === "check") {
      const authToken = await login(base, macValue, deviceKey);
      const info = await getDevice(base, authToken);
      return NextResponse.json({
        ok: true,
        expireDate: info.expireDate,
        isTrial: info.isTrial,
        message: trialMessage(info, "Vencimento atualizado."),
      });
    }

    // ── create: adiciona a playlist (nunca mexe nas outras do aparelho) ──
    if (action === "create") {
      if (!m3uUrl) return NextResponse.json({ ok: false, error: "m3uUrl é obrigatório para create." }, { status: 400 });
      const pin = String(password || "").replace(/\D/g, "");
      await createPlaylistByMac(base, macValue, { name: finalServerName || "Playlist", url: m3uUrl, pin });

      let info: Pick<DeviceInfo, "expireDate" | "isTrial"> = { expireDate: null, isTrial: false };
      try {
        const authToken = await login(base, macValue, deviceKey);
        info = await getDevice(base, authToken);
      } catch {
        // best-effort — a playlist já foi criada, não derruba
      }
      return NextResponse.json({
        ok: true,
        expireDate: info.expireDate,
        isTrial: info.isTrial,
        message: info.isTrial ? "Playlist configurada — aparelho no teste grátis." : "Playlist configurada com sucesso.",
      });
    }

    // ── delete: só a playlist com o nome exato do cliente ──
    if (action === "delete") {
      const searchName = String(username || finalServerName || "").trim();
      if (!searchName) return NextResponse.json({ ok: false, error: "Nome do servidor não informado." }, { status: 400 });
      const pin = String(password || "").replace(/\D/g, "");
      const authToken = await login(base, macValue, deviceKey);
      try {
        await deletePlaylistByName(base, authToken, searchName, pin);
      } catch (e: any) {
        if (e?.notFound) return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
        throw e;
      }
      return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
    }

    return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete | check" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Erro interno." }, { status: 500 });
  }
}
