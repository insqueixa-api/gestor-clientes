// app/api/integrations/apps/ninjaplus/route.ts
// Ninja Plus — quickplayer.life, API própria (/api/public/customer/*),
// mesma família de produto do Quick Player "clássico" (api.quickplayer.app)
// mas domínio e contrato diferentes:
//   1. POST /api/public/customer/auth {mac, device_key} → {error, data:{token, device:{...}}}
//      (o "device" da resposta de auth já tem payed/expired/free_trial —
//      dá pra usar isso direto no check, sem precisar de uma 2ª chamada)
//   2. GET  /api/public/customer/me (Bearer)           → {error, data:{...mesmos campos do device}}
//   3. GET  /api/public/customer/playlists (Bearer)     → {error, data:[{id, name, ...}]}
//   4. POST /api/public/customer/playlist (Bearer)      → body {name, url, pin} (JSON puro, sem FormData)
//   5. DELETE /api/public/customer/playlist/{id} (Bearer) → body {pin}
// Achado + testado ao vivo pelo Márcio (29/08/2026) com MAC/device real —
// o catálogo "Ninja Plus" estava errado, apontando pro backend Laravel de
// meta-player.app (NINJAPLAYER antigo), que não é o app de verdade por trás
// desse nome no catálogo dele.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = "https://quickplayer.life/api/public/customer";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function buildM3uUrl(dnsHost: string, username: string, password: string): string {
  const cleanHost = dnsHost.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `http://${cleanHost}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=ts`;
}

// Login por MAC + Device Key — a resposta de /auth já vem com o "device"
// embutido (payed/expired/free_trial/free_trial_expired), então create e
// check reaproveitam essa mesma chamada em vez de precisar de um GET /me
// separado depois.
async function authenticate(mac: string, deviceKey: string): Promise<{ token: string; device: any }> {
  const res = await fetch(`${API_BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ mac, device_key: deviceKey }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error || !json.data?.token) {
    throw new Error(json?.message || `Falha no login (HTTP ${res.status}). Confira o MAC e o Device Key.`);
  }
  return { token: json.data.token as string, device: json.data.device || {} };
}

// Sem passar por new Date() — mesma regra do resto do projeto.
function extractExpireFromDevice(dev: any): { expireDate: string | null; isTrial: boolean } {
  const payed = !!dev?.payed;
  const isTrial = !payed && !!dev?.free_trial;
  const rawDate: string | null = payed ? dev?.expired : dev?.free_trial_expired;
  return { expireDate: rawDate ? String(rawDate).slice(0, 10) : null, isTrial };
}

async function getPin(): Promise<string> {
  const { data: integ } = await supabaseAdmin
    .from("app_integrations")
    .select("pin")
    .eq("app_name", "NINJAPLUS")
    .eq("is_active", true)
    .maybeSingle();
  return (integ?.pin || "").trim();
}

export async function POST(req: Request) {
  try {
    if (hasBadInternalHeader(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!isInternalRequest(req)) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, mac, deviceKey, device_key, username, password, server_id, playlist_name } = body;
    const key = deviceKey || device_key;

    if (!mac || !key) {
      return NextResponse.json({ ok: false, error: "mac e deviceKey são obrigatórios." }, { status: 400 });
    }

    // ── check ────────────────────────────────────────────────────────────
    if (action === "check") {
      try {
        const { device } = await authenticate(mac, key);
        const { expireDate, isTrial } = extractExpireFromDevice(device);

        return NextResponse.json({
          ok: true,
          expireDate,
          isTrial,
          message: expireDate
            ? isTrial
              ? "Ainda em teste gratuito — vencimento do trial atualizado."
              : "Vencimento atualizado."
            : "Login ok, mas não encontrei vencimento nem trial pra esse dispositivo.",
        });
      } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "Falha ao verificar vencimento." }, { status: 400 });
      }
    }

    // ── delete ───────────────────────────────────────────────────────────
    if (action === "delete") {
      try {
        const { token } = await authenticate(mac, key);
        const pin = await getPin();

        const listRes = await fetch(`${API_BASE}/playlists`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        const listJson = await listRes.json().catch(() => null);
        const allPlaylists: any[] = Array.isArray(listJson?.data) ? listJson.data : [];

        // Mesma regra de segurança do QUICKPLAYER: filtra por nome antes de
        // apagar — não apaga tudo que estiver no MAC.
        const rawWanted = (playlist_name || "").toString().trim();
        const playlists = rawWanted
          ? allPlaylists.filter((pl) => String(pl?.name || "").trim() === rawWanted)
          : allPlaylists;

        if (playlists.length === 0) {
          return NextResponse.json({ ok: true, message: "Nenhuma playlist configurada neste dispositivo." });
        }

        for (const pl of playlists) {
          const delRes = await fetch(`${API_BASE}/playlist/${pl.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ pin }),
          });
          const delJson = await delRes.json().catch(() => null);
          if (!delRes.ok || !delJson || delJson.error) {
            return NextResponse.json(
              { ok: false, error: delJson?.message || `Falha ao apagar playlist ${pl.id}.` },
              { status: 400 }
            );
          }
        }

        return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
      } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "Falha ao remover playlist." }, { status: 400 });
      }
    }

    // ── create ───────────────────────────────────────────────────────────
    if (action !== "create") {
      return NextResponse.json({ ok: false, error: "action inválida. Use: check | create | delete" }, { status: 400 });
    }
    if (!username || !server_id) {
      return NextResponse.json({ ok: false, error: "username e server_id são obrigatórios." }, { status: 400 });
    }

    const { data: server, error: serverErr } = await supabaseAdmin
      .from("servers")
      .select("dns")
      .eq("id", server_id)
      .single();

    const dnsList: string[] = Array.isArray(server?.dns) ? server.dns : [];
    if (serverErr || dnsList.length === 0) {
      return NextResponse.json({ ok: false, error: "Servidor sem DNS cadastrado." }, { status: 400 });
    }
    const m3uUrl = buildM3uUrl(dnsList[0], username, password || "");
    const pin = await getPin();

    let token: string;
    let device: any;
    try {
      ({ token, device } = await authenticate(mac, key));
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message }, { status: 400 });
    }

    const rawName = (playlist_name || username || "UniGestor").toString().trim();
    const safeName = rawName.length > 30 ? rawName.slice(0, 30) : rawName;

    const createRes = await fetch(`${API_BASE}/playlist`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name: safeName, url: m3uUrl, pin }),
    });
    const createJson = await createRes.json().catch(() => null);
    if (!createRes.ok || !createJson || createJson.error) {
      return NextResponse.json(
        { ok: false, error: createJson?.message || `Falha ao adicionar playlist (HTTP ${createRes.status}).` },
        { status: 400 }
      );
    }

    // ✅ 29/08/2026, pedido do Márcio: vencimento tem que vir junto no
    // create, não só depois de clicar "Verificar vencimento" à parte — o
    // device já veio no login (authenticate), sem chamada extra.
    const { expireDate, isTrial } = extractExpireFromDevice(device);

    return NextResponse.json({
      ok: true,
      expireDate,
      isTrial,
      message: "Playlist configurada com sucesso.",
      data: createJson.data,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno." }, { status: 500 });
  }
}
