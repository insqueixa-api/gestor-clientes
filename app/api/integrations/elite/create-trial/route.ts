import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ENV necessários:
 * - INTERNAL_API_SECRET
 * - ELITE_BASE_URL            ex: https://adminx.offo.dad
 * - ELITE_COOKIE              cookie completo (office_session + XSRF-TOKEN + etc)
 * - ELITE_CSRF_TOKEN          token que você viu no _token e no x-csrf-token
 */

function getInternalSecretFromReq(req: Request) {
  const a = req.headers.get("authorization");
  if (a?.toLowerCase().startsWith("bearer ")) return a.slice(7).trim();
  return req.headers.get("x-internal-secret")?.trim() || "";
}

function randDigits(n: number) {
  let out = "";
  for (let i = 0; i < n; i++) out += String(crypto.randomInt(0, 10));
  return out;
}

function normalizeBaseUsername(v: unknown) {
  const raw = String(v ?? "").trim();
  // somente letras/números (evita espaço, acento, símbolos)
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned;
}

/**
 * Regra que você pediu:
 * - Se base >= 12: usa base + 3 números aleatórios
 * - Se base < 12: completa com números aleatórios até ficar com 15 no total
 */
function buildEliteUsername(baseInput: unknown) {
  const base = normalizeBaseUsername(baseInput);

  if (base.length >= 12) {
    return base + randDigits(3);
  }

  const targetLen = 15; // "uns 15 dígitos está ótimo"
  const need = Math.max(0, targetLen - base.length);
  return base + randDigits(need);
}

async function readSafeBody(res: Response) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null as any, text };
  }
}

function pickFirst(obj: any, paths: string[]) {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const k of parts) {
      if (cur && typeof cur === "object" && k in cur) cur = cur[k];
      else {
        ok = false;
        break;
      }
    }
    if (ok && cur !== undefined && cur !== null) return cur;
  }
  return null;
}

async function eliteFetch(baseUrl: string, path: string, init: RequestInit & { cookie: string; csrf?: string }) {
  const url = baseUrl.replace(/\/+$/, "") + path;

  const headers = new Headers(init.headers || {});
  headers.set("accept", headers.get("accept") || "application/json");
  headers.set("cookie", init.cookie);
  headers.set("x-requested-with", "XMLHttpRequest");

  if (init.csrf) headers.set("x-csrf-token", init.csrf);

  // não setar content-type manualmente quando mandar FormData
  const finalInit: RequestInit = { ...init, headers };
  delete (finalInit as any).cookie;
  delete (finalInit as any).csrf;

  return fetch(url, finalInit);
}

export async function POST(req: Request) {
  try {
    // 0) segurança interna
    const expected = String(process.env.INTERNAL_API_SECRET || "");
    const got = getInternalSecretFromReq(req);
    if (!expected || got !== expected) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // 1) inputs
    const body = await req.json().catch(() => ({} as any));
    const desiredBase = body?.desired_username ?? body?.username ?? body?.trialnotes ?? "";

    const baseUrl = String(process.env.ELITE_BASE_URL || "").trim();
    const cookie = String(process.env.ELITE_COOKIE || "").trim();
    const csrf = String(process.env.ELITE_CSRF_TOKEN || "").trim();

    if (!baseUrl || !cookie || !csrf) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing env. Configure ELITE_BASE_URL, ELITE_COOKIE e ELITE_CSRF_TOKEN no .env (e redeploy).",
        },
        { status: 400 }
      );
    }

    // 2) gerar username final
    const finalUsername = buildEliteUsername(desiredBase);

    // 3) criar trial (maketrial)
    const createForm = new FormData();
    createForm.set("_token", csrf);
    createForm.set("trialx", "1");
    createForm.set("trialnotes", finalUsername);

    const createRes = await eliteFetch(baseUrl, "/api/iptv/maketrial", {
      method: "POST",
      cookie,
      body: createForm,
    });

    const createParsed = await readSafeBody(createRes);

    if (!createRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: "maketrial",
          status: createRes.status,
          error: "Elite maketrial failed",
          details_preview: String(createParsed.text || "").slice(0, 600),
        },
        { status: 502 }
      );
    }

    // 4) tentar pegar ID retornado
    const createdId =
      pickFirst(createParsed.json, ["id", "user_id", "data.id", "data.user_id"]) ??
      null;

    if (!createdId) {
      // sem ID: ainda retorna ok, mas avisa (se isso acontecer, a gente habilita fallback de busca por lista)
      return NextResponse.json({
        ok: true,
        provider: "ELITE",
        created: true,
        updated_username: false,
        username: finalUsername,
        note: "Trial criado, mas o endpoint não retornou user_id/id. Me mande o JSON de resposta do maketrial pra eu completar o fluxo de update automático.",
        raw_create: createParsed.json ?? createParsed.text,
      });
    }

    // 5) buscar detalhes do usuário (pra pegar password e bouquets atuais)
    const detailsRes = await eliteFetch(baseUrl, `/api/iptv/${createdId}`, {
      method: "GET",
      cookie,
      csrf,
    });

    const detailsParsed = await readSafeBody(detailsRes);
    if (!detailsRes.ok) {
      return NextResponse.json({
        ok: true,
        provider: "ELITE",
        created: true,
        updated_username: false,
        external_user_id: String(createdId),
        username: finalUsername,
        note: "Trial criado, mas falhou ao ler detalhes para aplicar update automático.",
        details_status: detailsRes.status,
        details_preview: String(detailsParsed.text || "").slice(0, 600),
      });
    }

    const details = detailsParsed.json ?? {};

    const currentPassword =
      pickFirst(details, ["password", "data.password", "user.password"]) ?? "";

    // bouquets podem vir em formatos diferentes; tentamos alguns
    const bouquetsRaw =
      pickFirst(details, ["bouquet", "bouquets", "bouquet_ids", "data.bouquet", "data.bouquets"]) ?? [];
    const bouquets: Array<string> = Array.isArray(bouquetsRaw)
      ? bouquetsRaw.map((x) => String(x))
      : [];

    // 6) update username (e notas)
    const updForm = new FormData();
    updForm.set("user_id", String(createdId));
    updForm.set("usernamex", finalUsername);
    updForm.set("passwordx", String(currentPassword));
    updForm.set("reseller_notes", finalUsername);

    for (const b of bouquets) {
      updForm.append("bouquet[]", String(b));
    }

    const updRes = await eliteFetch(baseUrl, `/api/iptv/update/${createdId}`, {
      method: "POST",
      cookie,
      csrf,
      body: updForm,
    });

    const updParsed = await readSafeBody(updRes);

    if (!updRes.ok) {
      return NextResponse.json({
        ok: true,
        provider: "ELITE",
        created: true,
        updated_username: false,
        external_user_id: String(createdId),
        username: finalUsername,
        password: String(currentPassword || ""),
        note: "Trial criado, mas falhou ao aplicar update automático do username.",
        update_status: updRes.status,
        update_preview: String(updParsed.text || "").slice(0, 600),
      });
    }

    // ✅ sucesso total
    return NextResponse.json({
      ok: true,
      provider: "ELITE",
      created: true,
      updated_username: true,
      external_user_id: String(createdId),
      username: finalUsername,
      password: String(currentPassword || ""),
      raw_create: createParsed.json ?? null,
      raw_update: updParsed.json ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}