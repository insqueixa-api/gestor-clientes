// app/api/integrations/apps/utmplay/route.ts
//
// UTM Play (utmplay.wtf) — 04/10/2026. Site Express renderizado no servidor,
// sessão por cookie, sem captcha — testado ao vivo no aparelho do Márcio:
//   1. POST /device/login (form) {mac_address, device_key} → 302 /mylist
//      (key errada = 302 /login)
//   2. GET  /mylist → HTML com "Status: Active", "Expiration: AAAA-MM-DD" e a
//      tabela de listas (nome, url, data-current_id)
//   3. POST /savePlaylist (form) {current_playlist_url_id:-1, playlist_name,
//      playlist_url} → {status:"success", data:{_id}} — várias convivem
//   4. DELETE /deletePlayListUrl (form) {playlist_url_id} → {status:"success"}
//
// Regras (iguais às outras integrações):
//   • Vencimento = "Expiration" da licença. Vitalícia vem como 9999-12-31 e é
//     gravada assim mesmo (pedido do Márcio, 04/10/2026: mostrar no campo).
//     Status de teste grátis → isTrial:true.
//   • Apagar: nome exato → o mais parecido → todas do aparelho (pelo MAC) —
//     lib/integrations/playlist-match.ts.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";
import { extractDateOnly } from "@/lib/apps/panel";
import { pickPlaylistsToDelete } from "@/lib/integrations/playlist-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HANDLER = "UTMPLAY";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

type Session = { base: string; brand: string; jar: Record<string, string> };

function takeCookies(s: Session, res: Response) {
  const lines = typeof (res.headers as any).getSetCookie === "function" ? (res.headers as any).getSetCookie() : [];
  for (const line of lines as string[]) {
    const [nv] = line.split(";");
    const i = nv.indexOf("=");
    if (i > 0) s.jar[nv.slice(0, i).trim()] = nv.slice(i + 1).trim();
  }
}

function headers(s: Session, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "User-Agent": UA,
    Cookie: Object.entries(s.jar).map(([k, v]) => `${k}=${v}`).join("; "),
    Origin: s.base,
    Referer: `${s.base}/mylist`,
    ...extra,
  };
}

async function login(s: Session, mac: string, deviceKey: string) {
  const res = await fetch(`${s.base}/device/login`, {
    method: "POST",
    redirect: "manual",
    headers: headers(s, { "Content-Type": "application/x-www-form-urlencoded", Referer: `${s.base}/login` }),
    body: new URLSearchParams({ mac_address: mac.toLowerCase(), device_key: deviceKey }),
  });
  takeCookies(s, res);
  await res.text().catch(() => "");
  const location = res.headers.get("location") || "";
  if (res.status >= 500) throw new Error(`O ${s.brand} está fora do ar agora (HTTP ${res.status}) — tente de novo em instantes.`);
  if (!/mylist/i.test(location)) {
    throw new Error(`Login recusado no ${s.brand} — confira o MAC e a Device Key desse app.`);
  }
}

const decode = (v: string) =>
  v.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();

type Device = { lists: { id: string; name: string; url: string }[]; expireDate: string | null; isTrial: boolean; lifetime: boolean };

async function readDevice(s: Session): Promise<Device> {
  const res = await fetch(`${s.base}/mylist`, { headers: headers(s), cache: "no-store" });
  takeCookies(s, res);
  const html = await res.text();
  if (!res.ok || !html.includes("Manage Playlists")) {
    throw new Error(`Não consegui ler as listas do aparelho no ${s.brand} (sessão recusada).`);
  }
  const lists = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((m) => m[1])
    .filter((tr) => tr.includes("playlist-url-delete"))
    .map((tr) => {
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
      return {
        id: (tr.match(/playlist-url-delete" data-current_id="([^"]+)"/) || [])[1] || "",
        name: decode(tds[0] || ""),
        url: decode(tds[1] || ""),
      };
    })
    .filter((l) => l.id);
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const status = ((text.match(/Status:\s*([A-Za-z]+)/) || [])[1] || "").toLowerCase();
  const exp = extractDateOnly((text.match(/Expiration:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/) || [])[1] || null);
  const lifetime = !!exp && Number(exp.slice(0, 4)) >= 9000;
  const isTrial = status.includes("trial");
  return { lists, expireDate: exp, isTrial, lifetime };
}

function checkMessage(d: Device) {
  if (d.lifetime) return "Licença vitalícia (31/12/9999).";
  if (d.isTrial) return d.expireDate ? "Ainda no teste grátis — vencimento do teste atualizado." : "Em teste grátis.";
  return d.expireDate ? "Vencimento atualizado." : "Não encontrei o vencimento da licença nesse aparelho.";
}

export async function POST(req: Request) {
  let brand = "UTM Play";
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
      .select("api_url, label")
      .eq("app_name", HANDLER)
      .maybeSingle();
    // nome nas mensagens = o cadastrado na tela de Integrações
    if (integ?.label) brand = integ.label;
    if (integErr || !integ?.api_url) {
      return NextResponse.json({ ok: false, error: `Integração ${brand} não configurada.` }, { status: 500 });
    }
    if (!deviceKey) {
      return NextResponse.json(
        { ok: false, error: `Device Key é obrigatório pro ${brand} — preencha o campo 'Device Key' desse app.` },
        { status: 400 },
      );
    }
    const s: Session = { base: new URL(integ.api_url).origin, brand, jar: {} };
    await login(s, String(macValue), String(deviceKey));

    // ── check: licença, só leitura ──
    if (action === "check") {
      const d = await readDevice(s);
      return NextResponse.json({ ok: true, expireDate: d.expireDate, isTrial: d.isTrial, message: checkMessage(d) });
    }

    // ── create: adiciona a playlist (nunca mexe nas outras do aparelho) ──
    if (action === "create") {
      if (!m3uUrl) return NextResponse.json({ ok: false, error: "m3uUrl é obrigatório para create." }, { status: 400 });
      const res = await fetch(`${s.base}/savePlaylist`, {
        method: "POST",
        headers: headers(s, { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" }),
        body: new URLSearchParams({
          current_playlist_url_id: "-1",
          playlist_name: finalServerName || "Playlist",
          playlist_url: m3uUrl,
        }),
      });
      takeCookies(s, res);
      const json: any = await res.json().catch(() => null);
      if (!res.ok || json?.status !== "success") {
        throw new Error(json?.msg || `Falha ao criar a playlist no ${brand} (status ${res.status}).`);
      }
      let d: Device | null = null;
      try {
        d = await readDevice(s);
      } catch {
        // best-effort — a playlist já foi criada, não derruba
      }
      return NextResponse.json({
        ok: true,
        expireDate: d?.expireDate ?? null,
        isTrial: d?.isTrial ?? false,
        message: d?.isTrial ? "Playlist configurada — aparelho no teste grátis." : "Playlist configurada com sucesso.",
      });
    }

    // ── delete: exato → o mais parecido → todas do aparelho ──
    if (action === "delete") {
      const searchName = String(username || finalServerName || "").trim();
      if (!searchName) return NextResponse.json({ ok: false, error: "Nome do servidor não informado." }, { status: 400 });
      const d = await readDevice(s);
      const { matches } = pickPlaylistsToDelete(d.lists, searchName, (l) => l.name);
      if (!matches.length) {
        return NextResponse.json(
          { ok: false, error: `Nenhuma playlist com o nome '${searchName}' nesse aparelho (${d.lists.length} playlist(s) no total).` },
          { status: 404 },
        );
      }
      for (const l of matches) {
        const res = await fetch(`${s.base}/deletePlayListUrl`, {
          method: "DELETE",
          headers: headers(s, { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" }),
          body: new URLSearchParams({ playlist_url_id: l.id }),
        });
        takeCookies(s, res);
        const json: any = await res.json().catch(() => null);
        if (!res.ok || json?.status !== "success") throw new Error(json?.msg || `Falha ao remover a playlist no ${brand}.`);
      }
      return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
    }

    return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete | check" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Erro interno." }, { status: 500 });
  }
}
