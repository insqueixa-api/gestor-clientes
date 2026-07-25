// app/api/integrations/apps/quickplayer/route.ts
// Integração direta com api.quickplayer.app (Quick Player e Quick Player
// Pro — mesma API pros dois). Login é por MAC + Device Key (por aparelho,
// não por conta de revenda). Confirmado via testes reais (Márcio, 21/07/2026):
//   1. POST /api/login_by_mac {mac, key}         → token JWT
//   2. POST /api/playlist_with_mac (FormData!)   → adiciona a playlist
//      campos: name, mac, url, is_protected (+ pin/confirm_pin se protegido)
//
// A URL m3u NUNCA reaproveita o m3u_url já salvo no cliente — é montada aqui
// com o DNS #1 cadastrado no servidor (servers.dns[0]) + usuário/senha do
// cliente. Só o DNS #1 libera a licença do Quick Player (achado real do
// Márcio) — se o DNS mudar, só atualiza no cadastro do servidor, sem deploy.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = "https://api.quickplayer.app/api";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function buildM3uUrl(dnsHost: string, username: string, password: string): string {
  const cleanHost = dnsHost.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `http://${cleanHost}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=ts`;
}

// Login por MAC + Device Key — devolve o token JWT (message) ou lança erro.
async function loginByMac(mac: string, key: string): Promise<string> {
  const loginRes = await fetch(`${API_BASE}/login_by_mac`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ mac, key }),
  });
  const loginJson = await loginRes.json().catch(() => null);
  if (!loginRes.ok || !loginJson || loginJson.error) {
    throw new Error(loginJson?.message || `Falha no login (HTTP ${loginRes.status}). Confira o MAC e o Device Key.`);
  }
  return loginJson.message as string;
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
    const key = deviceKey || device_key; // aceita os dois formatos (o modal injeta "deviceKey")

    if (action === "delete") {
      if (!mac || !key) {
        return NextResponse.json({ ok: false, error: "mac e deviceKey são obrigatórios." }, { status: 400 });
      }
      try {
        const token = await loginByMac(mac, key);

        // Playlist protegida por PIN exige o PIN também pra deletar
        // ("Pin is required" — confirmado, 21/07/2026).
        const { data: integ } = await supabaseAdmin
          .from("app_integrations")
          .select("pin")
          .eq("app_name", "QUICKPLAYER")
          .eq("is_active", true)
          .maybeSingle();
        const pin = (integ?.pin || "").trim();

        const listRes = await fetch(`${API_BASE}/playlist`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        const listJson = await listRes.json().catch(() => null);
        const playlists: any[] = Array.isArray(listJson?.message) ? listJson.message : [];

        if (playlists.length === 0) {
          return NextResponse.json({ ok: true, message: "Nenhuma playlist configurada neste dispositivo." });
        }

        const doDelete = async (id: number, withPin: string | null) => {
          const delBody: Record<string, any> = { id };
          if (withPin) delBody.pin = withPin;
          const res = await fetch(`${API_BASE}/palylist_from_web`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(delBody),
          });
          const json = await res.json().catch(() => null);
          return { ok: res.ok && !!json && !json.error, message: json?.message };
        };

        for (const pl of playlists) {
          const firstAttempt = await doDelete(pl.id, pl.is_protected && pin ? pin : null);
          if (firstAttempt.ok) continue;

          // ✅ Retry sem PIN — pedido do Márcio (25/07/2026): raras exceções
          // têm cliente com playlist configurada sem PIN mesmo com o PIN
          // padrão cadastrado em app_integrations, e mandar um PIN nesse
          // caso faz a API recusar o delete. Só tenta de novo se a 1ª
          // tentativa mandou PIN — sem isso repetir a mesma chamada não
          // muda nada.
          if (pl.is_protected && pin) {
            const retry = await doDelete(pl.id, null);
            if (retry.ok) continue;
          }

          return NextResponse.json(
            { ok: false, error: firstAttempt.message || `Falha ao apagar playlist ${pl.id}.` },
            { status: 400 }
          );
        }

        return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
      } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "Falha ao remover playlist." }, { status: 400 });
      }
    }

    if (action !== "create") {
      return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete" }, { status: 400 });
    }
    if (!mac || !key || !username || !server_id) {
      return NextResponse.json({ ok: false, error: "mac, deviceKey, username e server_id são obrigatórios." }, { status: 400 });
    }

    // ── 1. DNS #1 do servidor ──────────────────────────────────────────────
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

    // ── 2. PIN configurado em API de Integrações (protege a playlist) ────────
    const { data: integ } = await supabaseAdmin
      .from("app_integrations")
      .select("pin")
      .eq("app_name", "QUICKPLAYER")
      .eq("is_active", true)
      .maybeSingle();
    const pin = (integ?.pin || "").trim();

    // ── 3. Login por MAC + Device Key ────────────────────────────────────────
    let token: string;
    try {
      token = await loginByMac(mac, key);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message }, { status: 400 });
    }

    // ── 4. Adiciona a playlist (FormData — a API não aceita JSON aqui) ─────
    // A API do Quick Player rejeita nome de playlist com mais de 30 caracteres
    const rawName = (playlist_name || username || "UniGestor").toString().trim();
    const safeName = rawName.length > 30 ? rawName.slice(0, 30) : rawName;

    const form = new FormData();
    form.append("name", safeName);
    form.append("mac", mac);
    form.append("url", m3uUrl);
    if (pin) {
      form.append("is_protected", "true");
      form.append("pin", pin);
      form.append("confirm_pin", pin);
    } else {
      form.append("is_protected", "false");
    }

    const uploadRes = await fetch(`${API_BASE}/playlist_with_mac`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      body: form,
    });
    const uploadJson = await uploadRes.json().catch(() => null);
    if (!uploadRes.ok || !uploadJson || uploadJson.error) {
      return NextResponse.json(
        { ok: false, error: uploadJson?.message || `Falha ao adicionar playlist (HTTP ${uploadRes.status}).` },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, message: "Playlist configurada com sucesso.", data: uploadJson.message });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno." }, { status: 500 });
  }
}
