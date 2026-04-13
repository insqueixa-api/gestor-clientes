//app/api/integrations/apps/ibosol/ibosol.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// BASE_URL vem do corpo da requisição (salvo no banco em app_integrations.api_url)
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

// ============================================================
// Mapeamento estático: nome do app (lowercase) → product UUID
// Extraído do dropdown da página add-play-list em 13/04/2026
// ============================================================
const PRODUCT_MAP: Record<string, string> = {
  "ibo player":        "ef1d4975-a444-4392-9a45-2278757d91b7",
  "bob player":        "4486fbe9-66c0-436e-a5cb-6dd0eb48b88b",
  "duplex tv player":  "2537e55e-289c-4c65-9f09-4a6be7368cb1",
  "bob premium player":"2e19f09f-5867-42d4-bc34-716e49ad5e9e",
  "all player":        "ba9ab89d-bb36-4009-b948-824fb7ba2950",
  "abe player":        "b50c9aa5-a7cb-4d37-81b0-75f9de2c4343",
  "mac player":        "4527c7b0-eda5-4d5a-a077-67a2f9b19cd3",
  "virginia player":   "6ee4a89c-9269-4dc4-aa9c-4c61c7b3a6b4",
  "iboss player":      "f991e05b-0497-4a74-8458-1bb16a3f8e54",
  "family 4k player":  "e341eaa5-9c5e-4551-8980-92c85410c28a",
  "flixnet player":    "ccec7eb6-fa95-469f-93b2-4377e98b2d1f",
  "hush player":       "b1b1c674-e821-4e96-9f65-e7ab168f5e50",
  "king4kplayer":      "a8564a26-6988-4981-aa18-2bf1ad7989e1",
  "ibosol player":     "8ad3ef0f-1d58-49b4-8d22-396461cd46b9",
  "ibo stb":           "736fba95-5b8b-48eb-af00-e3d37d866f1b",
  "bobpro player":     "0b80c018-7b52-4ee0-a67c-0866b21d6aa5",
  "ktn player":        "63b33892-3a5a-4a41-a721-cb0099f53ada",
  "iboxx player":      "46e666c0-6928-44ab-9a9e-dcddd6b0983e",
  "cr player":         "28f1ec06-d626-4ac5-9fcb-043a64b926e8",
  "ibo vpn player":    "9340a973-e54d-4404-9913-68a4ee52d32d",
  "smartone pro":      "1f7b6ed8-53f8-49ef-963a-9f2382cac9c0",
  "messi player":      "190fe3fe-a320-4cb2-95eb-c925fb8c6a46",
  "hq player":         "5531e814-fab4-4a67-9821-9022c4f7a32a",
  "zero player":       "64e2d536-e6ab-4b4e-be4e-bba63e581399",
};

function resolveProductId(appName: string): string | null {
  const key = appName.toLowerCase().trim();
  if (PRODUCT_MAP[key]) return PRODUCT_MAP[key];
  // Fallback: match parcial (ex: "King4KPlayer" → "king4kplayer")
  for (const [k, v] of Object.entries(PRODUCT_MAP)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

// ============================================================
// Cookie jar simples para manter sessão entre requests
// ============================================================
class CookieJar {
  private store: Map<string, string> = new Map();

  absorb(headers: Headers) {
    // getSetCookie() disponível no Node 18+ / Next.js edge/node runtime
    const rawList: string[] =
      typeof (headers as any).getSetCookie === "function"
        ? (headers as any).getSetCookie()
        : (headers.get("set-cookie") || "").split(/,(?=[^ ])/).filter(Boolean);

    for (const raw of rawList) {
      const [nameVal] = raw.split(";");
      const eqIdx = nameVal.indexOf("=");
      if (eqIdx === -1) continue;
      const name = nameVal.slice(0, eqIdx).trim();
      const value = nameVal.slice(eqIdx + 1).trim();
      if (name) this.store.set(name, value);
    }
  }

  toString() {
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

// ============================================================
// Helpers de parsing HTML (sem dependências externas)
// ============================================================
function extractCsrfToken(html: string): string | null {
  const m = html.match(/name="_token"\s+value="([^"]+)"/);
  return m ? m[1] : null;
}

function extractExpireDate(html: string): string | null {
  // <div class="font-bold">Expiration Date</div>
  // <p class="opacity-70 text-sm">2054-09-26</p>
  const m = html.match(/Expiration Date<\/div>\s*<p[^>]*>\s*([\d-]+)\s*<\/p>/);
  return m ? m[1].trim() : null;
}

function didSucceed(html: string, keyword: string): boolean {
  return html.toLowerCase().includes(keyword.toLowerCase());
}

// ============================================================
// Headers base para todas as requisições
// ============================================================
function baseHeaders(cookie: string, referer: string, isPost = false, origin = ""): Record<string, string> {
  return {
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "pt,en;q=0.9,pt-BR;q=0.8",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "user-agent": UA,
    referer,
    cookie,
    ...(isPost
      ? {
          "content-type": "application/x-www-form-urlencoded",
          origin,
        }
      : {}),
  };
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      action,
      app_name,
      mac_address,
      device_key,
      deviceKey,        // ← modal manda nesse campo
      playlist_name,
      playlist_url,
      pin,
      base_url,
    } = body;

    // Aceita os dois formatos
    const resolvedDeviceKey = (device_key || deviceKey || "").trim();

    if (!base_url) {
      return NextResponse.json({ ok: false, error: "base_url é obrigatório." }, { status: 400 });
    }

    const BASE_URL = String(base_url).replace(/\/$/, "");

    // Validações básicas
    if (!action || !app_name || !mac_address) {
      return NextResponse.json(
        { ok: false, error: "action, app_name e mac_address são obrigatórios." },
        { status: 400 }
      );
    }

    const productId = resolveProductId(app_name);
    if (!productId) {
      return NextResponse.json(
        { ok: false, error: `App "${app_name}" não encontrado. Verifique o nome.` },
        { status: 400 }
      );
    }

    const jar = new CookieJar();

    // ===========================================================
    // ACTION: create
    // 1. GET add-play-list  → CSRF + cookies
    // 2. POST add-play-list → salva playlist
    // 3. Aguarda 2s
    // 4. GET check-mac      → CSRF fresco + cookies
    // 5. POST check-mac     → lê expiration date
    // ===========================================================
    if (action === "create") {
      if (!playlist_url) {
        return NextResponse.json(
          { ok: false, error: "playlist_url é obrigatório para create." },
          { status: 400 }
        );
      }

      // 1. GET add-play-list
      const getAddRes = await fetch(`${BASE_URL}/add-play-list`, {
        headers: baseHeaders("", `${BASE_URL}/`),
        redirect: "follow",
      });
      jar.absorb(getAddRes.headers);
      const getAddHtml = await getAddRes.text();

      const token = extractCsrfToken(getAddHtml);
      if (!token) throw new Error("CSRF token não encontrado em add-play-list.");

      // 2. POST add-play-list
      const addParams = new URLSearchParams();
      addParams.set("type", "");
      addParams.set("_token", token);
      addParams.set("_method", "POST");
      addParams.set("product", productId);
      addParams.set("mac_address", mac_address);
      addParams.set("device_key", resolvedDeviceKey);
      addParams.set("playlist_name", playlist_name || "Playlist");
      addParams.set("playlist_url", playlist_url);

      if (pin) {
        addParams.set("protect_pin", "1");
        addParams.set("pin_code", String(pin));
        addParams.set("pin_code_confirmation", String(pin));
      }

      const postAddRes = await fetch(`${BASE_URL}/add-play-list`, {
        method: "POST",
        headers: baseHeaders(jar.toString(), `${BASE_URL}/add-play-list`, true, BASE_URL),
        body: addParams.toString(),
        redirect: "follow",
      });
      jar.absorb(postAddRes.headers);
      const postAddHtml = await postAddRes.text();

      if (!didSucceed(postAddHtml, "saved successfully")) {
        // Tenta extrair mensagem de erro da resposta
        const errMatch = postAddHtml.match(
          /class="[^"]*(?:text-red|alert)[^"]*"[^>]*>\s*([\s\S]{1,300}?)\s*<\//
        );
        const errMsg = errMatch
          ? errMatch[1].replace(/<[^>]+>/g, "").trim()
          : "Falha ao adicionar playlist. Resposta inesperada do IBOSol.";
        throw new Error(errMsg);
      }

      // 3. Aguarda 2s para o servidor processar
      await new Promise((r) => setTimeout(r, 2000));

      // 4. GET check-mac (cookies da sessão já estão no jar)
      const getCheckRes = await fetch(`${BASE_URL}/check-mac`, {
        headers: baseHeaders(jar.toString(), `${BASE_URL}/add-play-list`),
        redirect: "follow",
      });
      jar.absorb(getCheckRes.headers);
      const getCheckHtml = await getCheckRes.text();

      const checkToken = extractCsrfToken(getCheckHtml);
      if (!checkToken) throw new Error("CSRF token não encontrado em check-mac.");

      // 5. POST check-mac
      const checkParams = new URLSearchParams();
      checkParams.set("_token", checkToken);
      checkParams.set("_method", "POST");
      checkParams.set("product", productId);
      checkParams.set("mac_address", mac_address);

      const postCheckRes = await fetch(`${BASE_URL}/check-mac`, {
        method: "POST",
        headers: baseHeaders(jar.toString(), `${BASE_URL}/check-mac`, true, BASE_URL),
        body: checkParams.toString(),
        redirect: "follow",
      });
      jar.absorb(postCheckRes.headers);
      const checkHtml = await postCheckRes.text();

      const expireDate = extractExpireDate(checkHtml);

      return NextResponse.json({
        ok: true,
        expireDate: expireDate ?? null,
        message: "Playlist configurada com sucesso.",
      });
    }

    // ===========================================================
    // ACTION: delete
    // 1. GET reset-playlist → CSRF + cookies
    // 2. POST reset-playlist → remove playlist
    // ===========================================================
    if (action === "delete") {
      // 1. GET reset-playlist
      const getDelRes = await fetch(`${BASE_URL}/reset-playlist`, {
        headers: baseHeaders("", `${BASE_URL}/check-mac`),
        redirect: "follow",
      });
      jar.absorb(getDelRes.headers);
      const getDelHtml = await getDelRes.text();

      const token = extractCsrfToken(getDelHtml);
      if (!token) throw new Error("CSRF token não encontrado em reset-playlist.");

      // 2. POST reset-playlist
      const delParams = new URLSearchParams();
      delParams.set("type", "");
      delParams.set("_token", token);
      delParams.set("_method", "POST");
      delParams.set("product", productId);
      delParams.set("mac_address", mac_address);
      delParams.set("device_key", resolvedDeviceKey);

      const postDelRes = await fetch(`${BASE_URL}/reset-playlist`, {
        method: "POST",
        headers: baseHeaders(jar.toString(), `${BASE_URL}/reset-playlist`, true, BASE_URL),
        body: delParams.toString(),
        redirect: "follow",
      });
      jar.absorb(postDelRes.headers);
      const postDelHtml = await postDelRes.text();

      if (!didSucceed(postDelHtml, "deleted successfully")) {
        const errMatch = postDelHtml.match(
          /class="[^"]*(?:text-red|alert)[^"]*"[^>]*>\s*([\s\S]{1,300}?)\s*<\//
        );
        const errMsg = errMatch
          ? errMatch[1].replace(/<[^>]+>/g, "").trim()
          : "Falha ao remover playlist. Resposta inesperada do IBOSol.";
        throw new Error(errMsg);
      }

      return NextResponse.json({ ok: true, message: "Playlist removida com sucesso." });
    }

    return NextResponse.json(
      { ok: false, error: "action inválida. Use: create | delete" },
      { status: 400 }
    );
  } catch (e: any) {
    console.error("[IBOSOL API]", e);
    return NextResponse.json(
      { ok: false, error: e.message || "Erro interno." },
      { status: 500 }
    );
  }
}