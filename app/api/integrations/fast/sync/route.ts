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
    const integration_id = String(body?.integration_id ?? "").trim();
    if (!integration_id) return jsonError(400, "integration_id é obrigatório.");

    // ✅ Gate de segurança: interno OU usuário autenticado (admin/painel)
    const internal = isInternal(req);
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

    // 1) Carrega integração
    const { data: integ, error: integErr } = await supabase
      .from("server_integrations")
      .select("id, provider, api_token, api_secret, is_active")
      .eq("id", integration_id)
      .single();

    if (integErr) return jsonError(500, "Falha ao buscar integração.");
    if (!integ) return jsonError(404, "Integração não encontrada.");

    const provider = String(integ.provider ?? "").toUpperCase();
    if (provider !== "FAST") return jsonError(400, "Integração não é FAST.");
    if (!integ.is_active) return jsonError(400, "Integração está inativa.");

    const token = String(integ.api_token ?? "").trim();
    const secret = String(integ.api_secret ?? "").trim();
    if (!token) return jsonError(400, "Token do FAST não cadastrado.");
    if (!secret) return jsonError(400, "Secret Key do FAST não cadastrada.");

    // 2) Chama o FAST /profile/{TOKEN}
    const url = `${FAST_BASE_URL}/profile/${encodeURIComponent(token)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const json = await resp.json().catch(() => null);

    // ✅ Respostas sanitizadas (nunca devolve body bruto do FAST)
    if (!resp.ok) {
      return jsonError(502, "FAST respondeu com erro HTTP.");
    }

    // Padrão do FAST: { statusCode: 200, result: true/false, data, mens }
    if (!json || json?.result !== true) {
      // não expõe detalhes do FAST; mensagem genérica
      return jsonError(400, "FAST: falha ao validar token/secret.");
    }

    const data = json?.data ?? {};
    const owner_id =
      data?.owner_id == null ? null : Number(data.owner_id);
    const owner_username =
      data?.username == null ? null : String(data.username);
    const credits =
      data?.credits == null ? null : Number(data.credits);

    // 3) Atualiza server_integrations (sem “achismo” de coluna)
    const patch: any = {
      owner_id: Number.isFinite(owner_id) ? owner_id : null,
      owner_username: owner_username ? String(owner_username) : null,
      credits_last_known: Number.isFinite(credits) ? credits : null,
      credits_last_sync_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabase
      .from("server_integrations")
      .update(patch)
      .eq("id", integration_id);

    if (upErr) return jsonError(500, "Falha ao atualizar integração.");

    return NextResponse.json({
      ok: true,
      message: "FAST sincronizado com sucesso.",
      provider: "FAST",
      integration_id,
      owner_username,
      owner_id,
      credits,
    });
  } catch (e: any) {
    const msg =
      e?.name === "AbortError"
        ? "Timeout ao chamar FAST."
        : "Erro inesperado no sync do FAST.";
    return jsonError(500, msg);
  }
}
