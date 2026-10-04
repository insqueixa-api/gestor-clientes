// app/api/integrations/apps/ibosmarters/route.ts
//
// IBO Smarters Player (ibosmartersplayer.com) — 03/10/2026. API própria
// hospedada no Railway (achada no bundle do site), testada ao vivo no aparelho
// do Márcio:
//   1. POST /devices/login          {mac, device_key} → {token, activated, payed}
//                                    (key errada = 401 INVALID_DEVICE_KEY)
//   2. GET  /devices/{MAC}/info      → {activated, payed, expiresAt,
//                                    freeTrialExpiresAt, isExpired, ...}
//   3. GET  /playlist/by-device?mac= → {playlists:[{id, name, url, ...}]}
//   4. POST /playlist/upload-with-url {mac, playlistName, playlistUrl}
//      — o servidor deles BAIXA a m3u na hora (lista fora do ar = 400
//      PARSE_ERROR "Failed to fetch playlist"); várias listas convivem.
//   5. DELETE /playlist/{id}         → apaga só aquela lista.
//
// Regras (iguais às outras integrações):
//   • Vencimento = licença do app (expiresAt). Sem licença e sem teste vencido =
//     modo de avaliação (isTrial:true, igual DUPLECAST), com a data do teste se vier.
//   • Apagar: nome exato → o mais parecido → todas do aparelho (pelo MAC) —
//     lib/integrations/playlist-match.ts.
//   • Base da API: app_integrations.extra_config.api_base, senão o padrão abaixo.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";
import { extractDateOnly } from "@/lib/apps/panel";
import { pickPlaylistsToDelete } from "@/lib/integrations/playlist-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HANDLER = "IBOSMARTERS";
const DEFAULT_API_BASE = "https://ativeplay-production-production.up.railway.app/api";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

type Ctx = { brand: string; base: string; origin: string };

function headers(ctx: Ctx, token?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": UA,
    Origin: ctx.origin,
    Referer: `${ctx.origin}/`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// O parceiro limita rajadas (x-ratelimit-limit: 5 no login — medido 03/10/2026):
// 429 = espera e tenta de novo, nunca vira erro falso de MAC/key.
async function call(ctx: Ctx, path: string, init: RequestInit = {}): Promise<{ status: number; json: any }> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      const retryAfter = Number(res?.headers.get("retry-after")) || 0;
      await new Promise((r) => setTimeout(r, Math.min(retryAfter * 1000 || 2500 * attempt, 10000)));
    }
    res = await fetch(`${ctx.base}${path}`, { ...init, cache: "no-store" });
    if (res.status !== 429) break;
    await res.text().catch(() => "");
  }
  if (res!.status === 429) {
    throw new Error(`O ${ctx.brand} está limitando conexões agora — tente de novo em 1 minuto.`);
  }
  const text = await res!.text().catch(() => "");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res!.status, json };
}

async function login(ctx: Ctx, mac: string, deviceKey: string): Promise<string> {
  const { status, json } = await call(ctx, "/devices/login", {
    method: "POST",
    headers: headers(ctx),
    body: JSON.stringify({ mac, device_key: deviceKey }),
  });
  if (status === 200 && json?.token) return json.token as string;
  if (json?.code === "INVALID_DEVICE_KEY") {
    throw new Error(`Device Key incorreta no ${ctx.brand} — confira o campo 'Device Key' desse app.`);
  }
  throw new Error(json?.error || `Falha no login do ${ctx.brand} — confira MAC e Device Key.`);
}

type DeviceInfo = { expireDate: string | null; isTrial: boolean };

async function getInfo(ctx: Ctx, mac: string, token: string): Promise<DeviceInfo> {
  const { status, json } = await call(ctx, `/devices/${encodeURIComponent(mac)}/info`, { headers: headers(ctx, token) });
  if (status !== 200 || !json) throw new Error(json?.error || `Falha ao consultar o aparelho no ${ctx.brand}.`);
  const paidUntil = json.expiresAt || null;
  // Modo de avaliação (igual DUPLECAST): sem licença paga e o teste ainda não
  // venceu — aparelho novo vem activated:false, sem data nenhuma, e o app
  // funciona normal na TV. Teste vencido (isTrialExpired) não é trial.
  const isTrial = !paidUntil && !json.isTrialExpired && !json.isExpired;
  return { expireDate: extractDateOnly(paidUntil || (isTrial ? json.freeTrialExpiresAt : null)), isTrial };
}

async function listPlaylists(ctx: Ctx, mac: string, token: string): Promise<any[]> {
  const { status, json } = await call(ctx, `/playlist/by-device?mac=${encodeURIComponent(mac)}`, { headers: headers(ctx, token) });
  if (status !== 200 || !json?.success) throw new Error(json?.error || `Falha ao listar as playlists no ${ctx.brand}.`);
  return Array.isArray(json.playlists) ? json.playlists : [];
}

function trialMessage(info: DeviceInfo, okText: string) {
  if (info.isTrial) {
    return info.expireDate
      ? "Ainda no teste grátis — vencimento do teste atualizado."
      : "Dispositivo em modo de avaliação — o app não informa vencimento até ativar a licença.";
  }
  return info.expireDate ? okText : "Teste grátis vencido e sem licença ativa nesse app.";
}

export async function POST(req: Request) {
  let brand = "IBO Smarters Player";
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
    const { action, macValue, finalServerName, m3uUrl, username, deviceKey } = body;

    if (!action) return NextResponse.json({ ok: false, error: "action é obrigatório." }, { status: 400 });
    if (!macValue) return NextResponse.json({ ok: false, error: "macValue é obrigatório." }, { status: 400 });

    const { data: integ, error: integErr } = await supabase
      .from("app_integrations")
      .select("api_url, label, extra_config")
      .eq("app_name", HANDLER)
      .maybeSingle();
    // nome nas mensagens = o cadastrado na tela de Integrações
    if (integ?.label) brand = integ.label;
    if (integErr || !integ) {
      return NextResponse.json({ ok: false, error: `Integração ${brand} não configurada.` }, { status: 500 });
    }
    if (!deviceKey) {
      return NextResponse.json(
        { ok: false, error: `Device Key é obrigatório pro ${brand} — preencha o campo 'Device Key' desse app.` },
        { status: 400 },
      );
    }
    const site = integ.api_url ? new URL(integ.api_url) : new URL("https://ibosmartersplayer.com");
    const ctx: Ctx = {
      brand,
      base: String((integ.extra_config as any)?.api_base || DEFAULT_API_BASE).replace(/\/+$/, ""),
      origin: `${site.protocol}//${site.host}`,
    };

    // ── check: vencimento da licença (ou do teste grátis), só leitura ──
    if (action === "check") {
      const token = await login(ctx, macValue, deviceKey);
      const info = await getInfo(ctx, macValue, token);
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
      const token = await login(ctx, macValue, deviceKey);
      const { status, json } = await call(ctx, "/playlist/upload-with-url", {
        method: "POST",
        headers: headers(ctx, token),
        body: JSON.stringify({ mac: macValue, playlistName: finalServerName || "Playlist", playlistUrl: m3uUrl }),
      });
      if (status !== 200 || !json?.success) {
        const msg = json?.code === "PARSE_ERROR"
          ? `O ${brand} não conseguiu baixar a lista (m3u fora do ar ou bloqueada pro servidor deles).`
          : json?.error || `Falha ao criar a playlist no ${brand} (status ${status}).`;
        throw new Error(msg);
      }

      let info: DeviceInfo = { expireDate: null, isTrial: false };
      try {
        info = await getInfo(ctx, macValue, token);
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

    // ── delete: exato → o mais parecido → todas do aparelho ──
    if (action === "delete") {
      const searchName = String(username || finalServerName || "").trim();
      if (!searchName) return NextResponse.json({ ok: false, error: "Nome do servidor não informado." }, { status: 400 });
      const token = await login(ctx, macValue, deviceKey);
      const playlists = await listPlaylists(ctx, macValue, token);
      const { matches } = pickPlaylistsToDelete(playlists, searchName, (p: any) => String(p.name || ""));
      if (!matches.length) {
        return NextResponse.json(
          { ok: false, error: `Nenhuma playlist com o nome '${searchName}' nesse aparelho (${playlists.length} playlist(s) no total).` },
          { status: 404 },
        );
      }
      for (const p of matches) {
        const { status, json } = await call(ctx, `/playlist/${encodeURIComponent(p.id)}`, {
          method: "DELETE",
          headers: headers(ctx, token),
        });
        if (status !== 200 || !json?.success) throw new Error(json?.error || `Falha ao remover a playlist no ${brand}.`);
      }
      return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
    }

    return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete | check" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Erro interno." }, { status: 500 });
  }
}
