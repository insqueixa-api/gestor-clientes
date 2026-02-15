import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// ✅ Ajuste conforme seu padrão (normalmente você já tem isso no NaTV)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const FAST_BASE_URL = "https://api.painelcliente.com";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...(extra ? { extra } : {}) }, { status });
}

export async function POST(req: Request) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return jsonError("Config ausente: NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.", 500);
    }

    const body = await req.json().catch(() => ({}));
    const integration_id = String(body?.integration_id ?? "").trim();
    if (!integration_id) return jsonError("integration_id é obrigatório.");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // 1) Carrega integração
    const { data: integ, error: integErr } = await supabase
      .from("server_integrations")
      .select("id, tenant_id, provider, api_token, api_secret, is_active")
      .eq("id", integration_id)
      .single();

    if (integErr) return jsonError(integErr.message || "Falha ao buscar integração.", 500);
    if (!integ) return jsonError("Integração não encontrada.", 404);

    const provider = String(integ.provider ?? "").toUpperCase();
    if (provider !== "FAST") return jsonError("Integração não é FAST.");
    if (!integ.is_active) return jsonError("Integração está inativa.");

    const token = String(integ.api_token ?? "").trim();
    const secret = String(integ.api_secret ?? "").trim();
    if (!token) return jsonError("Token do FAST não cadastrado.");
    if (!secret) return jsonError("Secret Key do FAST não cadastrada.");

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

    if (!resp.ok) {
      return jsonError("FAST respondeu com erro HTTP.", 502, { status: resp.status, body: json });
    }

    // Padrão do FAST: { statusCode: 200, result: true/false, data, mens }
    if (!json || json?.result !== true) {
      return jsonError(json?.mens || "FAST: falha ao validar token/secret.", 400, { body: json });
    }

    const data = json?.data ?? {};
    const owner_id = data?.owner_id ?? null; // pode existir
    const owner_username = data?.username ?? null; // username da revenda
    const credits = data?.credits ?? null;

    // 3) Atualiza server_integrations
    const patch: any = {
      owner_id: owner_id == null ? null : Number(owner_id),
      owner_username: owner_username == null ? null : String(owner_username),
      credits_last_known: credits == null ? null : Number(credits),
      credits_last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), // se você tiver essa coluna
    };

    const { error: upErr } = await supabase
      .from("server_integrations")
      .update(patch)
      .eq("id", integration_id);

    if (upErr) return jsonError(upErr.message || "Falha ao atualizar integração.", 500);

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
        : e?.message ?? "Erro inesperado no sync do FAST.";
    return jsonError(msg, 500);
  }
}
