// app/api/integrations/apps/cortex/route.ts
//
// Cortex Player (cortexplayer.site) — 03/10/2026. API própria, achada no
// código da "Página do Cliente" do site (lista.html), testada ao vivo:
//   1. GET  /{DEVICE}/overview?mac=MAC → {device, license:{state, plan,
//      expiresAt, trialDaysLeft}, lists:[...]}
//      DEVICE = os 6 números que o app mostra (campo "Device Key" do
//      catálogo). Resolve pro id REAL do aparelho (UUID, às vezes "pc-…").
//   2. POST /{id}/lists     {name, type:"m3u", m3uUrl} → cria (várias convivem)
//   3. DELETE /{id}/lists/{listId}
//   Aparelho com PIN (controle parental) exige o header X-Client-Pin — sem o
//   PIN do cliente não dá pra mexer, vira erro claro.
//
// ⚠️ A API aceita QUALQUER texto como id e cria o registro na hora (achado
// 03/10/2026: um teste com o MAC no lugar do id criou um registro "fantasma"
// que passou a responder pelo código do aparelho). Gravar nesse fantasma
// responde "sucesso" mas nunca chega na TV — por isso o id resolvido precisa
// ter cara de id de aparelho (UUID), nunca de MAC/código.
//
// Regras (iguais às outras integrações):
//   • Vencimento = licença (expiresAt). Em teste grátis = fim do teste com
//     isTrial:true. Licença coberta pelo servidor/vitalícia vem sem data.
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

const HANDLER = "CORTEX";
const DEFAULT_API_BASE = "https://tvbox.agente.website/api/client";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

type Ctx = { brand: string; base: string; origin: string };

function headers(ctx: Ctx): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": UA,
    Origin: ctx.origin,
    Referer: `${ctx.origin}/`,
  };
}

async function call(ctx: Ctx, path: string, init: RequestInit = {}): Promise<{ status: number; json: any }> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2500 * attempt));
    res = await fetch(`${ctx.base}${path}`, { ...init, cache: "no-store" });
    if (res.status !== 429) break;
    await res.text().catch(() => "");
  }
  if (res!.status === 429) throw new Error(`O ${ctx.brand} está limitando conexões agora — tente de novo em alguns minutos.`);
  const text = await res!.text().catch(() => "");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res!.status, json };
}

// id de aparelho de verdade = UUID (às vezes com prefixo, ex: "pc-<uuid>").
// MAC ou só números = registro fantasma (ver comentário do topo).
const looksLikeDeviceId = (id: string) =>
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

type Overview = { device: string; lists: any[]; expireDate: string | null; isTrial: boolean; message: string | null };

async function overview(ctx: Ctx, mac: string, deviceCode: string): Promise<Overview> {
  const code = String(deviceCode || "").replace(/\D/g, "");
  if (code.length !== 6) {
    throw new Error(`O DEVICE do ${ctx.brand} tem 6 números — confira o campo 'Device Key' desse app.`);
  }
  const { status, json } = await call(ctx, `/${code}/overview?mac=${encodeURIComponent(mac.toUpperCase())}`, {
    headers: headers(ctx),
  });
  if (status !== 200 || !json?.device) {
    throw new Error(json?.error || `Aparelho não encontrado no ${ctx.brand} — confira MAC e DEVICE.`);
  }
  const device = String(json.device);
  if (!looksLikeDeviceId(device)) {
    throw new Error(
      `O ${ctx.brand} não devolveu o aparelho real pra esse DEVICE/MAC — abra o app na TV e tente de novo (se continuar, fale com o suporte do ${ctx.brand}).`,
    );
  }
  const lic = json.license || {};
  if (lic.state === "blocked") throw new Error(`Aparelho bloqueado no ${ctx.brand} — fale com o suporte deles.`);
  const isTrial = lic.state === "trial";
  return {
    device,
    lists: Array.isArray(json.lists) ? json.lists : [],
    expireDate: extractDateOnly(lic.expiresAt || null),
    isTrial,
    message: null,
  };
}

function needsPin(json: any) {
  return !!json?.pinRequired;
}

export async function POST(req: Request) {
  let brand = "Cortex Player";
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
        { ok: false, error: `O DEVICE (6 números) é obrigatório pro ${brand} — preencha o campo 'Device Key' desse app.` },
        { status: 400 },
      );
    }
    const site = integ.api_url ? new URL(integ.api_url) : new URL("https://cortexplayer.site");
    const ctx: Ctx = {
      brand,
      base: String((integ.extra_config as any)?.api_base || DEFAULT_API_BASE).replace(/\/+$/, ""),
      origin: `${site.protocol}//${site.host}`,
    };

    // ── check: licença (ou teste grátis), só leitura ──
    if (action === "check") {
      const ov = await overview(ctx, macValue, deviceKey);
      return NextResponse.json({
        ok: true,
        expireDate: ov.expireDate,
        isTrial: ov.isTrial,
        message: ov.isTrial
          ? ov.expireDate ? "Ainda no teste grátis — vencimento do teste atualizado." : "Em teste grátis."
          : ov.expireDate ? "Vencimento atualizado." : "Licença ativa sem data de vencimento (coberta pelo servidor ou vitalícia).",
      });
    }

    // ── create: adiciona a playlist (nunca mexe nas outras do aparelho) ──
    if (action === "create") {
      if (!m3uUrl) return NextResponse.json({ ok: false, error: "m3uUrl é obrigatório para create." }, { status: 400 });
      const ov = await overview(ctx, macValue, deviceKey);
      const { status, json } = await call(ctx, `/${encodeURIComponent(ov.device)}/lists`, {
        method: "POST",
        headers: headers(ctx),
        body: JSON.stringify({ name: finalServerName || "Playlist", type: "m3u", m3uUrl }),
      });
      if (needsPin(json)) throw new Error(`Esse aparelho tem PIN no ${brand} — configure pela TV ou peça o PIN ao cliente.`);
      if (status !== 200 && status !== 201) {
        throw new Error(json?.error || `Falha ao criar a playlist no ${brand} (status ${status}).`);
      }
      return NextResponse.json({
        ok: true,
        expireDate: ov.expireDate,
        isTrial: ov.isTrial,
        message: ov.isTrial
          ? "Playlist configurada — aparelho no teste grátis. Na TV, abra o app de novo pra ela valer."
          : "Playlist configurada com sucesso. Na TV, abra o app de novo pra ela valer.",
      });
    }

    // ── delete: exato → o mais parecido → todas do aparelho ──
    if (action === "delete") {
      const searchName = String(username || finalServerName || "").trim();
      if (!searchName) return NextResponse.json({ ok: false, error: "Nome do servidor não informado." }, { status: 400 });
      const ov = await overview(ctx, macValue, deviceKey);
      const { matches } = pickPlaylistsToDelete(ov.lists, searchName, (l: any) => String(l.name || ""));
      if (!matches.length) {
        return NextResponse.json(
          { ok: false, error: `Nenhuma playlist com o nome '${searchName}' nesse aparelho (${ov.lists.length} playlist(s) no total).` },
          { status: 404 },
        );
      }
      for (const l of matches) {
        const { status, json } = await call(ctx, `/${encodeURIComponent(ov.device)}/lists/${encodeURIComponent(l.id)}`, {
          method: "DELETE",
          headers: headers(ctx),
        });
        if (needsPin(json)) throw new Error(`Esse aparelho tem PIN no ${brand} — remova pela TV ou peça o PIN ao cliente.`);
        if (status !== 200 || json?.ok === false) throw new Error(json?.error || `Falha ao remover a playlist no ${brand}.`);
      }
      return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
    }

    return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete | check" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Erro interno." }, { status: 500 });
  }
}
