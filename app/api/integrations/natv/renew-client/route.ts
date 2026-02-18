import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient as createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function isInternal(req: NextRequest) {
  const expected = String(process.env.INTERNAL_API_SECRET || "").trim();
  const received = String(req.headers.get("x-internal-secret") || "").trim();

  if (!expected || !received) return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}


export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
const tenant_id = String(body?.tenant_id ?? "").trim(); // ✅ só usado quando internal
const integration_id = String(body?.integration_id ?? "").trim();
const username = String(body?.username ?? "").trim();
const months = Number(body?.months);



    // Validação
if (!integration_id || !username || !Number.isFinite(months)) {
  return jsonError(400, "integration_id, username e months são obrigatórios");
}


    // ✅ Meses permitidos (ajuste para o seu padrão real)
    const validMonths = [1, 2, 3, 6, 12];
    if (!validMonths.includes(Number(months))) {
      return jsonError(400, "months deve ser 1, 2, 3, 6 ou 12");
    }

    const internal = isInternal(req);
    if (internal && !tenant_id) {
  return jsonError(400, "tenant_id é obrigatório (internal)");
}


    // ✅ Supabase:
    // - Interno: usa Service Role (não depende de cookie / RLS)
    // - Não-interno: exige usuário logado (RLS protege)
    const supabase = internal
      ? createSupabaseAdmin(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
      : await createSupabaseServer();

    if (!internal) {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) {
        return jsonError(401, "Unauthorized");
      }
    }

    // 1. Buscar integração
let integQuery = supabase
  .from("server_integrations")
  .select("api_token, provider")
  .eq("id", integration_id);

if (internal) {
  // ✅ evita cross-tenant quando usa service role
  integQuery = integQuery.eq("tenant_id", String(tenant_id));
}

const { data: integ, error: integErr } = await integQuery.single();


    if (integErr || !integ) {
      // log “cego”
      console.error("NATV renew: integração não encontrada");
      return jsonError(404, "Integração não encontrada");
    }

    if (integ.provider !== "NATV") {
      return jsonError(400, "Integração não é NATV");
    }

    const token = integ.api_token;

    // 2. Chamar API NATV (/user/activation)
    const apiUrl = "https://revenda.pixbot.link/user/activation";

    const apiRes = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        username: String(username),
        months: Number(months),
      }),
    });

    if (!apiRes.ok) {
      // ⚠️ NÃO retorna texto cru para o cliente final
      // log “cego”
      console.error("NATV renew: apiRes not ok", apiRes.status);

      if (apiRes.status === 402) {
        return jsonError(402, "Créditos insuficientes no servidor");
      }
      if (apiRes.status === 404) {
        return jsonError(404, "Usuário não encontrado no servidor");
      }

      return jsonError(apiRes.status, "Falha ao renovar no servidor");
    }

    const apiJson = await apiRes.json().catch(() => null);

    const expDate = apiJson?.exp_date; // timestamp Unix
    const password = apiJson?.password ?? null;

    if (!expDate) {
      console.error("NATV renew: exp_date ausente");
      return jsonError(500, "Falha ao renovar no servidor");
    }

    const expDateISO = new Date(Number(expDate) * 1000).toISOString();

    return NextResponse.json({
      ok: true,
      data: {
        username: String(username),
        exp_date: Number(expDate),
        exp_date_iso: expDateISO,
        password: password ? String(password) : null,
        credits: apiJson?.owner?.credits ?? null,
      },
    });
  } catch (err) {
    // log “cego”
    console.error("NATV renew: crash");
    return jsonError(500, "Erro interno");
  }
}
