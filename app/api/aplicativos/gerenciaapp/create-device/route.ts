import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UA     = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

// IDs dos apps no gerenciaapp.top (ranking_app_id)
const RANKING_APP_IDS: Record<string, number> = {
  "ibo_revenda": 10,
  // adicionar outros conforme descobrirmos
};

// Field IDs do catálogo de apps no UniGestor (client_apps.field_values)
// Precisamos descobrir o app_id e field IDs do "IBO Revenda" no banco
// Por ora deixamos flexível — lê pelo tipo mac
const IBO_APP_NAME = "IBO Revenda";

// ─── helpers ──────────────────────────────────────────────────────────────────

function expireDateOneYear(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

function parseCookies(setCookieHeaders: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of setCookieHeaders) {
    const part = h.split(";")[0];
    const eq   = part.indexOf("=");
    if (eq === -1) continue;
    map[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return map;
}

function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function extractXsrfFromCookies(cookies: Record<string, string>): string {
  const raw = cookies["XSRF-TOKEN"] || "";
  return decodeURIComponent(raw);
}

// ─── POST /api/aplicativos/gerenciaapp/create-device ──────────────────────────
//
// Body:
//   client_id       obrigatório
//   ranking_app_id  opcional (default: 10 = IBO Revenda)
//   expire_date     opcional (default: 1 ano a partir de hoje)
//
// Credenciais do gerenciaapp.top vêm de variáveis de ambiente:
//   GERENCIAAPP_EMAIL
//   GERENCIAAPP_PASSWORD
//
export async function POST(req: NextRequest) {
  try {
    // 1. Auth UniGestor
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ ok: false, error: "Token inválido." }, { status: 401 });

    // 2. Body
    const body = await req.json();
    const {
      client_id,
      ranking_app_id = 10,
      expire_date = expireDateOneYear(),
    } = body;

    if (!client_id) return NextResponse.json({ ok: false, error: "client_id é obrigatório." }, { status: 400 });

    // 3. Credenciais do painel (env vars)
    const panelEmail    = process.env.GERENCIAAPP_EMAIL    || "";
    const panelPassword = process.env.GERENCIAAPP_PASSWORD || "";
    if (!panelEmail || !panelPassword) {
      return NextResponse.json({
        ok: false,
        error: "Credenciais do gerenciaapp.top não configuradas. Adicione GERENCIAAPP_EMAIL e GERENCIAAPP_PASSWORD nas variáveis de ambiente."
      }, { status: 500 });
    }

    // 4. Busca dados do cliente no UniGestor
    const { data: clientRow, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("display_name, server_username, server_password, m3u_url, server_id")
      .eq("id", client_id)
      .maybeSingle();

    if (clientErr) return NextResponse.json({ ok: false, error: clientErr.message }, { status: 500 });
    if (!clientRow) return NextResponse.json({ ok: false, error: "Cliente não encontrado." }, { status: 404 });

    const { server_username, server_password, m3u_url, server_id } = clientRow as any;

    if (!server_username) return NextResponse.json({ ok: false, error: "Usuário do servidor não preenchido." }, { status: 400 });
    if (!m3u_url)         return NextResponse.json({ ok: false, error: "Link M3U não preenchido no cadastro do cliente." }, { status: 400 });

    // 5. Busca nome do servidor para montar server_name
    let serverShortName = "";
    if (server_id) {
      const { data: srv } = await supabaseAdmin
        .from("servers")
        .select("name")
        .eq("id", server_id)
        .maybeSingle();
      // Remove espaços e pega só a primeira palavra ou nome curto
      serverShortName = (srv as any)?.name?.replace(/\s+/g, "") || "";
    }

    // Formato: Insqueixa_NaTV (server_username + _ + server_name)
    const serverName = serverShortName
      ? `${server_username}_${serverShortName}`
      : server_username;

    // 6. Busca MAC e URL do app IBO Revenda do cliente
    const { data: appRows } = await supabaseAdmin
      .from("client_apps")
      .select("field_values, apps!inner(name, fields_config, info_url)")
      .eq("client_id", client_id)
      .ilike("apps.name", `%${IBO_APP_NAME}%`);

    // Extrai o MAC e a BASE (URL de Configuração) do primeiro resultado
    let mac = "";
    let BASE = "";
    if (appRows && appRows.length > 0) {
      const fv      = (appRows[0].field_values || {}) as Record<string, string>;
      const appData = (appRows[0] as any).apps;
      const fields  = Array.isArray(appData?.fields_config) ? appData.fields_config : [];

      // Pega a URL salva no modal do aplicativo e limpa a barra final, se houver
      BASE = appData?.info_url?.trim() || "";
      if (BASE.endsWith("/")) BASE = BASE.slice(0, -1);

      // Procura campo tipo mac
      const macField = fields.find((f: any) =>
        String(f?.type || "").toLowerCase() === "mac" ||
        String(f?.label || "").toLowerCase().includes("mac") ||
        String(f?.label || "").toLowerCase().includes("device")
      );

      if (macField) {
        mac = fv[macField.id]?.trim() || fv[macField.label]?.trim() || "";
      }

      // Fallback: procura qualquer valor que pareça MAC
      if (!mac) {
        mac = Object.values(fv).find((v) =>
          /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(String(v))
        ) || "";
      }
    }

    if (!mac) {
      return NextResponse.json({
        ok: false,
        error: `MAC não encontrado. Configure o app "${IBO_APP_NAME}" no cadastro do cliente.`
      }, { status: 400 });
    }

    if (!BASE) {
      return NextResponse.json({
        ok: false,
        error: `URL de configuração não encontrada no app "${IBO_APP_NAME}". Edite o aplicativo e adicione a URL.`
      }, { status: 400 });
    }

    // ─── ETAPA 1: Login no painel ────────────────────────────────────

    // Primeiro GET para pegar XSRF inicial
    const loginPageRes = await fetch(`${BASE}/`, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      redirect: "follow",
    });

    const loginPageCookies = parseCookies(
      loginPageRes.headers.getSetCookie?.() || []
    );

    // Algumas versões do Node não têm getSetCookie — fallback
    if (!loginPageCookies["XSRF-TOKEN"]) {
      const rawCookieHeader = loginPageRes.headers.get("set-cookie") || "";
      const xsrfMatch = rawCookieHeader.match(/XSRF-TOKEN=([^;]+)/);
      if (xsrfMatch) loginPageCookies["XSRF-TOKEN"] = xsrfMatch[1];
      const sessionMatch = rawCookieHeader.match(/ibo_new_session=([^;]+)/);
      if (sessionMatch) loginPageCookies["ibo_new_session"] = sessionMatch[1];
    }

    const initialXsrf = extractXsrfFromCookies(loginPageCookies);

    const loginRes = await fetch(`${BASE}/login`, {
      method:   "POST",
      redirect: "follow",
      headers: {
        "User-Agent":       UA,
        "Accept":           "text/html, application/xhtml+xml",
        "Content-Type":     "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-XSRF-TOKEN":     initialXsrf,
        "X-Inertia":        "true",
        "Cookie":           buildCookieHeader(loginPageCookies),
        "Referer":          `${BASE}/`,
        "Origin":           BASE,
      },
      body: JSON.stringify({
        email:    panelEmail,
        password: panelPassword,
        remember: true,
      }),
    });

    if (!loginRes.ok && loginRes.status !== 302) {
      return NextResponse.json({
        ok: false,
        error: `Falha no login do gerenciaapp.top (HTTP ${loginRes.status}). Verifique as credenciais nas variáveis de ambiente.`
      }, { status: 502 });
    }

    // Acumula cookies da resposta de login
    const loginCookies = { ...loginPageCookies };
    const loginSetCookies = loginRes.headers.getSetCookie?.() || [];
    if (loginSetCookies.length > 0) {
      Object.assign(loginCookies, parseCookies(loginSetCookies));
    } else {
      const raw = loginRes.headers.get("set-cookie") || "";
      for (const part of raw.split(/,(?=[^;]*=)/)) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;
        const k = part.split(";")[0].slice(0, eq).trim();
        const v = part.slice(eq + 1).split(";")[0].trim();
        loginCookies[k] = v;
      }
    }

    // ─── ETAPA 2: GET /users/create → pega XSRF atualizado ────────────────────

    const createPageRes = await fetch(`${BASE}/users/create`, {
      headers: {
        "User-Agent":       UA,
        "Accept":           "text/html, application/xhtml+xml",
        "X-Requested-With": "XMLHttpRequest",
        "X-Inertia":        "true",
        "Cookie":           buildCookieHeader(loginCookies),
        "Referer":          `${BASE}/users`,
      },
      redirect: "follow",
    });

    const createSetCookies = createPageRes.headers.getSetCookie?.() || [];
    if (createSetCookies.length > 0) {
      Object.assign(loginCookies, parseCookies(createSetCookies));
    }

    const finalXsrf = extractXsrfFromCookies(loginCookies);

    // ─── ETAPA 3: POST /users → cria o dispositivo ────────────────────────────

    const payload = {
      modo_selecao:     1,            // M3U8
      mac_device:       mac,
      server_name:      serverName,
      account_username: "",
      account_password: "",
      xteam_username:   "",
      xteam_password:   "",
      username_login:   server_username,
      password_login:   server_password || "",
      ranking_app_id:   ranking_app_id,
      dns:              "",
      m3u8_list:        m3u_url,
      url_epg:          "",
      price:            0,
      plan_id:          "",
      expire_date:      expire_date,
      dnsOptions:       "",
      whatsapp:         "",
      is_trial:         0,
    };

    const createRes = await fetch(`${BASE}/users`, {
      method:   "POST",
      redirect: "follow",
      headers: {
        "User-Agent":       UA,
        "Accept":           "text/html, application/xhtml+xml",
        "Content-Type":     "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Inertia":        "true",
        "X-Inertia-Version":"6ccb7842afd8909334c33ce7c3b40e73",
        "X-XSRF-TOKEN":     finalXsrf,
        "Cookie":           buildCookieHeader(loginCookies),
        "Referer":          `${BASE}/users/create`,
        "Origin":           BASE,
      },
      body: JSON.stringify(payload),
    });

    const createText = await createRes.text();

    // Inertia redireciona com 302 em sucesso
    if (createRes.ok || createRes.status === 302 || createRes.redirected) {
      return NextResponse.json({
        ok:          true,
        message:     "Dispositivo criado com sucesso no GerenciaApp.",
        mac,
        server_name: serverName,
        expire_date,
      });
    }

    // Tenta extrair erro do JSON (Inertia retorna JSON com erros de validação)
    let apiError = `GerenciaApp retornou HTTP ${createRes.status}.`;
    try {
      const json = JSON.parse(createText);
      const errors = json?.props?.errors || json?.errors || {};
      const firstError = Object.values(errors)[0];
      if (firstError) apiError = String(Array.isArray(firstError) ? firstError[0] : firstError);
    } catch {}

    return NextResponse.json({ ok: false, error: apiError }, { status: 502 });

  } catch (err: any) {
    console.error("[aplicativos/gerenciaapp/create-device]", err);
    return NextResponse.json({ ok: false, error: err?.message || "Erro interno." }, { status: 500 });
  }
}
