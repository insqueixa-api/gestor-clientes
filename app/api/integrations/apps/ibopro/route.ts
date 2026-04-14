import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

// https://iboproapp.com → https://api.iboproapp.com
function apiBase(siteUrl: string): string {
  return siteUrl.replace(/^(https?:\/\/)/, "$1api.");
}

function authHeaders(token: string, siteUrl: string): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "pt,en;q=0.9,pt-BR;q=0.8",
    authorization: `Bearer ${token}`,
    "cache-control": "no-cache",
    "content-type": "application/json",
    origin: siteUrl,
    pragma: "no-cache",
    referer: `${siteUrl}/`,
    "user-agent": UA,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      action,        // "create" | "delete"
      mac_address,   // Device ID: "E8:47:39:EA:D4:4B"
      deviceKey,     // Device Key (senha de login): "820625"
      playlist_name, // Nome do servidor
      playlist_url,  // URL M3U completa
      pin,           // PIN para proteger a playlist (de app_integrations.pin)
      base_url,      // De app_integrations.api_url: "https://iboproapp.com"
    } = body;

    if (!action || !mac_address || !deviceKey || !base_url) {
      return NextResponse.json(
        { ok: false, error: "action, mac_address, deviceKey e base_url são obrigatórios." },
        { status: 400 }
      );
    }

    const SITE_URL = base_url.replace(/\/$/, "");
    const API_URL = apiBase(SITE_URL);
    const macLower = mac_address.toLowerCase();

    // ================================================================
    // STEP 1: Login → JWT token
    // ================================================================
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "pt,en;q=0.9,pt-BR;q=0.8",
        authorization: "Bearer",
        "cache-control": "no-cache",
        "content-type": "application/json",
        origin: SITE_URL,
        pragma: "no-cache",
        referer: `${SITE_URL}/`,
        "user-agent": UA,
      },
      body: JSON.stringify({ mac: mac_address, password: deviceKey }),
    });

    const loginJson = await loginRes.json().catch(() => ({}));
    if (!loginJson?.token) {
      throw new Error(loginJson?.message || "Falha no login do IBO Pro Player. Verifique o MAC e o Device Key.");
    }
    const token = loginJson.token;

    // ================================================================
    // ACTION: create
    // 1. POST /me          → expiration date
    // 2. POST /playlistw   → adiciona playlist
    // ================================================================
    if (action === "create") {
      if (!playlist_url) {
        return NextResponse.json(
          { ok: false, error: "playlist_url é obrigatório para create." },
          { status: 400 }
        );
      }

      // STEP 2: Busca data de vencimento do dispositivo
      const meRes = await fetch(`${API_URL}/me`, {
        method: "POST",
        headers: { ...authHeaders(token, SITE_URL), "content-length": "0" },
      });
      const meJson = await meRes.json().catch(() => ({}));
      // expiration vem como "2026-08-20 16:08:44" → extrai só a data
      const expireDate = meJson?.expiration
        ? String(meJson.expiration).split(" ")[0]
        : null;

      // STEP 3: Adiciona playlist
      const addBody: Record<string, any> = {
        mac_address: macLower,
        playlist_name: playlist_name || "Playlist",
        playlist_url,
        playlist_id: null,
        playlist_type: "URL",
        playlist_host: "",
        playlist_username: "",
        playlist_password: "",
        is_protected: Boolean(pin),
        type: "URL",
      };
      if (pin) addBody.pin = String(pin);

      const addRes = await fetch(`${API_URL}/playlistw`, {
        method: "POST",
        headers: authHeaders(token, SITE_URL),
        body: JSON.stringify(addBody),
      });

      const addJson = await addRes.json().catch(() => ({}));
      if (!addRes.ok || !addJson?.id) {
        throw new Error(addJson?.message || "Falha ao adicionar playlist no IBO Pro Player.");
      }

      return NextResponse.json({
        ok: true,
        expireDate: expireDate ?? null,
        message: "Playlist configurada com sucesso.",
      });
    }

    // ================================================================
    // ACTION: delete
    // 1. GET /playlistw          → lista playlists
    // 2. POST /playlistw/protected → valida PIN (se protegida)
    // 3. DELETE /playlistw       → remove playlist
    // ================================================================
    if (action === "delete") {
      // STEP 2: Lista playlists do dispositivo
      const listRes = await fetch(`${API_URL}/playlistw`, {
        method: "GET",
        headers: authHeaders(token, SITE_URL),
      });
      const listJson = await listRes.json().catch(() => []);
      const playlists = Array.isArray(listJson) ? listJson : [];

      if (playlists.length === 0) {
        throw new Error("Nenhuma playlist encontrada para este dispositivo.");
      }

      // Busca por nome (servidor); fallback para a primeira da lista
      const target =
        playlists.find(
          (p: any) =>
            String(p.name || "").toLowerCase() ===
            String(playlist_name || "").toLowerCase()
        ) || playlists[0];

      if (!target?.id) {
        throw new Error(`Playlist "${playlist_name}" não encontrada no IBO Pro Player.`);
      }

      // STEP 3: Valida PIN se a playlist for protegida
      if (target.is_protected && pin) {
        const pinRes = await fetch(`${API_URL}/playlistw/protected`, {
          method: "POST",
          headers: authHeaders(token, SITE_URL),
          body: JSON.stringify({ pin: String(pin), playlist_id: target.id }),
        });
        const pinJson = await pinRes.json().catch(() => ({}));
        if (!pinJson?.status) {
          throw new Error(pinJson?.message || "PIN inválido para a playlist protegida.");
        }
      }

      // STEP 4: Deleta a playlist
      const delRes = await fetch(`${API_URL}/playlistw`, {
        method: "DELETE",
        headers: authHeaders(token, SITE_URL),
        body: JSON.stringify({ mac_address: macLower, playlist_id: target.id }),
      });
      const delJson = await delRes.json().catch(() => ({}));

      if (!delJson?.status) {
        throw new Error(delJson?.message || "Falha ao remover playlist do IBO Pro Player.");
      }

      return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
    }

    return NextResponse.json(
      { ok: false, error: "action inválida. Use: create | delete" },
      { status: 400 }
    );
  } catch (e: any) {
    console.error("[IBOPRO API]", e);
    return NextResponse.json(
      { ok: false, error: e.message || "Erro interno." },
      { status: 500 }
    );
  }
}
