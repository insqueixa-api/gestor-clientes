// app/api/integrations/apps/ibopro/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isInternalRequest, hasBadInternalHeader } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = "https://api.iboproapp.com";

// ============================================================
// Assinatura de requisição — cópia fiel do algoritmo extraído do
// bundle JS do iboproapp.com (chunk _app-*.js). A API deles exige
// esses headers em toda chamada, calculados a partir de mac+segredo+
// timestamp. Validado ao vivo (login real com MAC/deviceKey de um
// cliente) antes de subir isso pra produção.
// ============================================================
function btoaNode(str: string): string {
  return Buffer.from(str, "binary").toString("base64");
}

function f(t: string): string {
  return t.length >= 6
    ? t.substring(0, 3) + "iBo" + t.substring(3, t.length - 3) + "PrO" + t.substring(t.length - 3, t.length)
    : t.length >= 3
      ? t.substring(0, 3) + "iBo" + t.substring(3)
      : t + "PrO";
}
function d(t: string): string {
  return btoaNode(t);
}
function p(t: string): string {
  return f(d(f(t)));
}
function extractDigits(t: string): number[] {
  const e: number[] = [];
  let n = t.length - 1;
  while (e.length < 3) {
    const o = t.charAt(n);
    if (o > "0") e.push(parseInt(o, 10));
    n--;
  }
  return e;
}
function weirdMath(t: number, e: number, n: number, o: number): number {
  return (Math.pow(e, n) + Math.pow(n + t, 3) + (e + n) * (o + t)) % 5;
}
function m(t: string): string {
  const e = Date.now().toString();
  const n = p(t + e);
  const [r, a, i] = extractDigits(e);
  const bytes = new TextEncoder().encode(n).map((byte, idx) => byte + weirdMath(idx, r, a, i));
  const c = new TextDecoder().decode(bytes);
  return d(c + e);
}
function randomString(len: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
function signedHeaders(t: string, e?: string): Record<string, string> {
  const n = Date.now();
  const secondArg = e || randomString(6);
  return {
    "X-Gc-Token": m(`${t}${n}${2 * n}`),
    "x-hash": m(`${t}___${secondArg}`),
    "x-hash-2": m(`${t}___${secondArg}__${n}`),
    "x-token": m(`${t}${n}`),
    "x-token-2": m(t),
    "x-token-3": p(t),
  };
}

async function apiCall(
  method: string,
  path: string,
  mac: string,
  token: string | null,
  body?: any,
  signSecond?: string,
) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...signedHeaders(mac, signSecond),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function login(mac: string, deviceKey: string): Promise<string> {
  const res = await apiCall("POST", "/auth/login", mac, null, { mac, password: deviceKey }, deviceKey);
  if (!res.json?.status || !res.json?.token) {
    throw new Error(res.json?.message || "Login no IBO Pro falhou. Verifique MAC/Device Key.");
  }
  return res.json.token;
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
    const { action, mac, deviceKey, playlist_name, playlist_url, pin } = body;

    if (!action) return NextResponse.json({ ok: false, error: "action é obrigatório." }, { status: 400 });
    if (!mac) return NextResponse.json({ ok: false, error: "mac é obrigatório." }, { status: 400 });
    if (!deviceKey) return NextResponse.json({ ok: false, error: "deviceKey é obrigatório." }, { status: 400 });

    const token = await login(mac, deviceKey);

    // ===========================================================
    // ACTION: create
    // 1. POST /me → data de expiração
    // 2. POST /playlistw → cria a playlist
    // ===========================================================
    if (action === "create") {
      if (!playlist_url) {
        return NextResponse.json({ ok: false, error: "playlist_url é obrigatório para create." }, { status: 400 });
      }

      let expireDate: string | null = null;
      try {
        const meRes = await apiCall("POST", "/me", mac, token);
        const rawExp = meRes.json?.expiration;
        if (rawExp) {
          const d2 = new Date(String(rawExp).replace(" ", "T") + "-03:00");
          if (!isNaN(d2.getTime())) {
            expireDate = `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, "0")}-${String(d2.getDate()).padStart(2, "0")}`;
          }
        }
      } catch {
        // não bloqueia o create
      }

      const createRes = await apiCall("POST", "/playlistw", mac, token, {
        mac_address: mac.toLowerCase(),
        playlist_name: playlist_name || "Playlist",
        playlist_url,
        playlist_id: null,
        playlist_type: "URL",
        playlist_host: "",
        playlist_username: "",
        playlist_password: "",
        is_protected: !!pin,
        type: "URL",
        pin: pin || "",
      });

      if (createRes.status !== 200 || !createRes.json?.id) {
        return NextResponse.json(
          { ok: false, error: createRes.json?.message || `Falha ao criar playlist (HTTP ${createRes.status}).` },
          { status: 500 },
        );
      }

      return NextResponse.json({ ok: true, expireDate, message: "Playlist criada com sucesso." });
    }

    // ===========================================================
    // ACTION: delete
    // 1. GET /playlistw → acha a playlist pelo nome
    // 2. DELETE /playlistw {mac_address, playlist_id}
    // ===========================================================
    if (action === "delete") {
      const searchName = String(playlist_name || "").trim().toLowerCase();

      const listRes = await apiCall("GET", "/playlistw", mac, token);
      const playlists: any[] = Array.isArray(listRes.json) ? listRes.json : [];

      // ✅ Só cai pro fallback "é a única da lista" quando não há ambiguidade —
      // nunca apaga "a primeira" de uma lista com múltiplas playlists sem
      // bater o nome, pra não remover a playlist errada de um device.
      const byName = searchName ? playlists.find((p2) => String(p2.name || "").toLowerCase() === searchName) : null;
      const target = byName || (playlists.length === 1 ? playlists[0] : null);

      if (!target) {
        return NextResponse.json(
          { ok: false, error: `Nenhuma playlist encontrada com o nome '${playlist_name}' nesse dispositivo (${playlists.length} playlist(s) no total).` },
          { status: 404 },
        );
      }

      const delRes = await apiCall("DELETE", "/playlistw", mac, token, {
        mac_address: mac.toLowerCase(),
        playlist_id: target.id,
      });

      if (!delRes.json?.status) {
        return NextResponse.json({ ok: false, error: delRes.json?.message || "Falha ao remover playlist." }, { status: 500 });
      }

      return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
    }

    return NextResponse.json({ ok: false, error: "action inválida. Use: create | delete" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Erro interno." }, { status: 500 });
  }
}
