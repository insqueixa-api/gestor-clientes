import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── IDs dos campos no banco (field_values de client_apps) ────────────────────
const FIELDS = {
  duplecast: {
    app_id:     "33fa56bb-f3e9-4969-89f1-87b3956b4c1a",
    mac:        "2ae67ff3-be7f-43ab-ad0e-25bbf6f4ff2a",
    device_key: "f_xj5qx",
    obs:        "f_vemy2",   // ← blesta_sid fica aqui temporariamente
  },
  duplexplay: {
    app_id:     "985ae0e8-d8b5-46b2-8f7a-6f14c3cf768e",
    mac:        "b6bf7599-29e6-4481-8336-ef77df731631",
    device_key: "f_b1ukp",
    obs:        "f_197j0",   // ← blesta_sid fica aqui temporariamente
  },
} as const;

const DUPLECAST_BASE = "https://duplecast.com";
const ADD_URL        = `${DUPLECAST_BASE}/plugin/duplecast/device_main/add/`;
const POST_URL       = `${DUPLECAST_BASE}/plugin/duplecast/device_main/`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

function extractCsrf(html: string): string | null {
  const m = html.match(/name="_csrf_token"\s+value="([^"]+)"/);
  return m ? m[1] : null;
}

function isExpired(html: string): boolean {
  return (
    html.includes("/plugin/duplecast/device_login/") ||
    (html.includes("Device ID") && !html.includes("_csrf_token"))
  );
}

// ─── POST /api/aplicativos/duplecast/add-playlist ─────────────────────────────
//
// Body:
//   client_id      obrigatório — lê blesta_sid + mac do banco
//   playlist_name  obrigatório
//   m3u_url        opcional — se não vier, busca do cadastro do cliente
//   pin            opcional
//   app_type       opcional: "duplecast" | "duplexplay" (default: "duplecast")
//
export async function POST(req: NextRequest) {
  try {
    // 1. Auth
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ ok: false, error: "Token inválido." }, { status: 401 });

    // 2. Body
    const body = await req.json();
    const { client_id, playlist_name, m3u_url, pin, app_type = "duplecast" } = body;

    if (!client_id)     return NextResponse.json({ ok: false, error: "client_id é obrigatório." }, { status: 400 });
    if (!playlist_name) return NextResponse.json({ ok: false, error: "playlist_name é obrigatório." }, { status: 400 });

    const cfg = app_type === "duplexplay" ? FIELDS.duplexplay : FIELDS.duplecast;

    // 3. m3u_url — usa o que veio ou busca do cadastro do cliente
    let finalM3uUrl = (m3u_url || "").trim();
    if (!finalM3uUrl) {
      const { data: clientRow } = await supabaseAdmin
        .from("clients")
        .select("m3u_url")
        .eq("id", client_id)
        .maybeSingle();
      finalM3uUrl = clientRow?.m3u_url?.trim() || "";
    }
    if (!finalM3uUrl) {
      return NextResponse.json(
        { ok: false, error: "m3u_url não encontrado. Preencha o link M3U no cadastro do cliente." },
        { status: 400 }
      );
    }

    // 4. Busca dados do app do cliente no banco
    const { data: appRow, error: appErr } = await supabaseAdmin
      .from("client_apps")
      .select("field_values")
      .eq("client_id", client_id)
      .eq("app_id", cfg.app_id)
      .maybeSingle();

    if (appErr)  return NextResponse.json({ ok: false, error: appErr.message }, { status: 500 });
    if (!appRow) return NextResponse.json({ ok: false, error: `App ${app_type} não configurado para este cliente.` }, { status: 404 });

    const fv = (appRow.field_values || {}) as Record<string, string>;
    const mac       = fv[cfg.mac]?.trim()        || "";
    const blestaSid = fv[cfg.obs]?.trim()        || ""; // blesta_sid no campo obs

    if (!mac) {
      return NextResponse.json({ ok: false, error: "MAC (Device ID) não preenchido no app do cliente." }, { status: 400 });
    }
    if (!blestaSid) {
      return NextResponse.json({
        ok: false,
        error: "Sessão não encontrada. Cole o blesta_sid no campo Obs do app DupleCast do cliente.",
        expired: true,
      }, { status: 401 });
    }

    const [bSid, cfClearance] = blestaSid.split("|");
const cookie = cfClearance
  ? `blesta_sid=${bSid}; cf_clearance=${cfClearance}`
  : `blesta_sid=${bSid}`;

    // 5. GET → extrai _csrf_token
    const getRes = await fetch(ADD_URL, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        "Accept":     "text/html,application/xhtml+xml",
        "Cookie":     cookie,
        "Referer":    `${DUPLECAST_BASE}/plugin/duplecast/device_login/`,
      },
      redirect: "follow",
    });

    if (!getRes.ok) {
      return NextResponse.json({ ok: false, error: `Duplecast retornou HTTP ${getRes.status}.` }, { status: 502 });
    }

    const html = await getRes.text();

    if (isExpired(html)) {
      return NextResponse.json({
        ok: false,
        error: "Sessão expirada. Faça login no Duplecast, copie o blesta_sid e cole no campo Obs.",
        expired: true,
      }, { status: 401 });
    }

    const csrfToken = extractCsrf(html);
    if (!csrfToken) {
      return NextResponse.json({
        ok: false,
        error: "Não foi possível extrair o token de segurança. Sessão inválida.",
        expired: true,
      }, { status: 502 });
    }

    // 6. POST → adiciona playlist
    const formData = new URLSearchParams({
      _csrf_token:  csrfToken,
      form_action:  "generate_m3u_playlist",
      m3u_name:     playlist_name,
      m3u_playlist: finalM3uUrl,
      epg_url:      "",
      note:         "",
      locked:       pin ? "1" : "0",
    });

    if (pin) {
      formData.set("pin",         String(pin));
      formData.set("confirm_pin", String(pin));
    }

    const postRes = await fetch(POST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":   UA,
        "Accept":       "text/html,application/xhtml+xml",
        "Cookie":       cookie,
        "Referer":      ADD_URL,
        "Origin":       DUPLECAST_BASE,
      },
      body:     formData.toString(),
      redirect: "follow",
    });

    const postHtml = await postRes.text();

    // Ainda no form = erro de validação
    if (postHtml.includes("_csrf_token") && postHtml.includes("form_action")) {
      const errMatch = postHtml.match(/class="alert[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      const errMsg   = errMatch
        ? errMatch[1].replace(/<[^>]+>/g, "").trim()
        : "Duplecast recusou a playlist. Verifique os dados.";
      return NextResponse.json({ ok: false, error: errMsg }, { status: 422 });
    }

    return NextResponse.json({
      ok:      true,
      message: "Playlist adicionada com sucesso no Duplecast.",
      mac,
      app_type,
      m3u_url: finalM3uUrl,
    });

  } catch (err: any) {
    console.error("[aplicativos/duplecast/add-playlist]", err);
    return NextResponse.json({ ok: false, error: err?.message || "Erro interno." }, { status: 500 });
  }
}
