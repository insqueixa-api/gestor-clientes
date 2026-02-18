import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient as createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const FAST_BASE_URL = "https://api.painelcliente.com";

function jsonError(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function isInternal(req: NextRequest) {
  const expected = process.env.INTERNAL_API_SECRET || "";
  const received = req.headers.get("x-internal-secret") || "";
  if (!expected || !received) return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
const body = await req.json().catch(() => ({}));
const tenant_id = String(body?.tenant_id ?? "").trim(); // ✅ só usado quando internal

const integration_id = String(body?.integration_id ?? "").trim();
const username = String(body?.username ?? "").trim();
const months = Number(body?.months);


    // Validação
    if (!integration_id || !username || !Number.isFinite(months)) {
      return jsonError(400, "integration_id, username e months são obrigatórios");
    }

    // FAST aceita 1..12
    const monthsNum = Math.trunc(months);
    if (monthsNum < 1 || monthsNum > 12) {
      return jsonError(400, "months deve ser entre 1 e 12");
    }

    // ✅ Gate: interno OU usuário autenticado (admin/painel)
    const internal = isInternal(req);
if (internal && !tenant_id) {
  return jsonError(400, "tenant_id é obrigatório (internal)");
}


    if (!internal) {
      const supabaseAuth = await createSupabaseServer();
      const { data: auth, error: authErr } = await supabaseAuth.auth.getUser();
      if (authErr || !auth?.user?.id) {
        return jsonError(401, "Unauthorized");
      }
    }

    // ✅ Admin client (service_role) só roda após passar no gate acima
    const supabase = createSupabaseAdmin(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // 1) Buscar integração (secrets)
let integQuery = supabase
  .from("server_integrations")
  .select("api_token, api_secret, provider, is_active")
  .eq("id", integration_id);

if (internal) {
  // ✅ trava cross-tenant quando usa service role
  integQuery = integQuery.eq("tenant_id", tenant_id);
}

const { data: integ, error: integErr } = await integQuery.single();


    if (integErr) return jsonError(500, "Falha ao buscar integração.");
    if (!integ) return jsonError(404, "Integração não encontrada");

    const provider = String(integ.provider ?? "").toUpperCase();
    if (provider !== "FAST") return jsonError(400, "Integração não é FAST");
    if (integ.is_active === false) return jsonError(400, "Integração está inativa");

    const token = String(integ.api_token ?? "").trim();
    const secret = String(integ.api_secret ?? "").trim();
    if (!token) return jsonError(400, "Token do FAST não cadastrado");
    if (!secret) return jsonError(400, "Secret Key do FAST não cadastrada");

    // 2) Chamar FAST (/renew_client/{token})
    const apiUrl = `${FAST_BASE_URL}/renew_client/${encodeURIComponent(token)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const apiRes = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        username,
        month: monthsNum,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    // Rate limit específico
    if (apiRes.status === 429) {
      return jsonError(429, "Aguarde 1 minuto antes de renovar este usuário novamente");
    }

    const apiJson = await apiRes.json().catch(() => null);

    if (!apiRes.ok) {
      // ✅ Não expõe body do FAST
      return jsonError(502, "FAST respondeu com erro HTTP.");
    }

    // Verificar se API retornou sucesso
    if (!apiJson || apiJson?.result !== true) {
      // ✅ Não expõe mens detalhado do FAST
      return jsonError(400, "FAST: falha ao renovar o usuário.");
    }

    // 3) Extrair dados (somente o necessário)
    const expDate = apiJson?.data?.exp_date; // unix
    const connection = apiJson?.data?.connection ?? null;
    const credits = apiJson?.data?.credits ?? null;

    if (!expDate) {
      return jsonError(500, "API não retornou exp_date");
    }

    const expDateISO = new Date(Number(expDate) * 1000).toISOString();

    // 4) Retornar sucesso (sanitizado)
    return NextResponse.json({
      ok: true,
      data: {
        username,
        exp_date: Number(expDate),
        exp_date_iso: expDateISO,
        connection,
        credits,
      },
    });
  } catch (err: any) {
    const msg =
      err?.name === "AbortError"
        ? "Timeout ao chamar FAST."
        : "Erro ao renovar cliente FAST";
    return jsonError(500, msg);
  }
}
