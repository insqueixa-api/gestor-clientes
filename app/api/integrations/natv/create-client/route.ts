import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient as createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function jsonError(status: number, msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status });
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

function looksLikeDuplicateUsername(msg: string) {
  const s = (msg || "").toLowerCase();
  return (
    s.includes("username") ||
    s.includes("exist") ||
    s.includes("duplicate") ||
    s.includes("já existe") ||
    s.includes("ja existe")
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { integration_id, username, months = 1, screens = 1 } = body;

    if (!integration_id) {
      return jsonError(400, "integration_id obrigatório");
    }

    // ✅ Gate de segurança (interno OU admin logado)
    const internal = isInternal(req);
    if (!internal) {
      const supabaseAuth = await createSupabaseServer();
      const { data: auth, error: authErr } = await supabaseAuth.auth.getUser();
      if (authErr || !auth?.user?.id) {
        return jsonError(401, "Unauthorized");
      }
    }

    // Validação months (mantém teu comportamento: 1..12)
    const finalMonths = Math.max(1, Math.min(12, Number(months) || 1));

    // (screens está no payload hoje; não altero a assinatura do endpoint)
    void screens;

    // ✅ Token:
    // - Interno: service_role (server-to-server)
    // - Não interno: provider via RLS + token via RPC segura
    let token: string | null = null;

    if (internal) {
      const supabase = createSupabaseAdmin(supabaseUrl, supabaseServiceKey);

      const { data: integ, error: integErr } = await supabase
        .from("server_integrations")
        .select("api_token, provider")
        .eq("id", String(integration_id))
        .single();

      if (integErr || !integ) return jsonError(404, "Integração não encontrada");
      if (integ.provider !== "NATV") return jsonError(400, "Provider inválido");

      token =
        typeof integ.api_token === "string" && integ.api_token.trim()
          ? integ.api_token.trim()
          : null;
    } else {
      const supabase = await createSupabaseServer();

      const { data: integ, error: integErr } = await supabase
        .from("server_integrations")
        .select("provider")
        .eq("id", String(integration_id))
        .single();

      if (integErr || !integ) return jsonError(404, "Integração não encontrada");
      if (integ.provider !== "NATV") return jsonError(400, "Provider inválido");

      const { data: tkn, error: tokenErr } = await supabase.rpc(
        "get_server_integration_token",
        { p_integration_id: String(integration_id) }
      );

      if (tokenErr) return jsonError(500, "Falha ao obter token.");
      token = typeof tkn === "string" && tkn.trim() ? tkn.trim() : null;
    }

    if (!token) {
      return jsonError(404, "Token não encontrado");
    }

    // Retry logic para username
    let attemptUsername = (username ? String(username) : `client${Date.now()}`).trim();
    if (!attemptUsername) attemptUsername = `client${Date.now()}`;

    let userId: number | null = null;
    let finalPassword = "";
    let lastError: any = null;

    // ETAPA 1: Criar usuário (15 min)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch("https://revenda.pixbot.link/user", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            username: attemptUsername,
            minutes: "15", // ✅ STRING (mantido)
          }),
        });

        const text = await res.text().catch(() => "");
        let data: any = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {};
        }

        if (!res.ok) {
          const rawMsg = String(data?.error || data?.message || text || "");
          if (looksLikeDuplicateUsername(rawMsg)) {
            const random = Math.floor(Math.random() * 900) + 100;
            attemptUsername = `${(username || "client").toString().trim() || "client"}${random}`;
            lastError = new Error(`Username já existe (tentativa ${attempt}/3)`);
            continue;
          }

          // ✅ erros sanitizados (não devolve raw da NATV)
          if (res.status === 402) return jsonError(402, "Créditos insuficientes no servidor");
          if (res.status === 404) return jsonError(404, "Endpoint NATV não encontrado");

          return jsonError(502, "Falha ao criar usuário no servidor");
        }

        // Sucesso
        userId = Number(data?.id);
        finalPassword = String(data?.password || "");
        break;
      } catch (err: any) {
        lastError = err;
        if (attempt < 3) {
          const random = Math.floor(Math.random() * 900) + 100;
          attemptUsername = `${(username || "client").toString().trim() || "client"}${random}`;
        }
      }
    }

    if (!userId) {
      // ✅ sem detalhes
      void lastError;
      return jsonError(502, "Falha ao criar usuário no servidor");
    }

    // ETAPA 2: Ativar/Renovar
    const activateRes = await fetch("https://revenda.pixbot.link/user/activation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        user_id: userId,
        months: finalMonths,
      }),
    });

    const activateText = await activateRes.text().catch(() => "");
    let activateData: any = {};
    try {
      activateData = activateText ? JSON.parse(activateText) : {};
    } catch {
      activateData = {};
    }

    if (!activateRes.ok) {
      // ✅ erros sanitizados
      if (activateRes.status === 402) return jsonError(402, "Créditos insuficientes no servidor");
      if (activateRes.status === 404) return jsonError(404, "Usuário não encontrado no servidor");
      return jsonError(502, "Falha ao ativar usuário no servidor");
    }

    // Construir M3U URL
    const domain = activateData.domain || "natv.pm";
    const m3u_url = `http://${domain}/get.php?username=${attemptUsername}&password=${finalPassword}&type=m3u_plus&output=ts`;

    return NextResponse.json({
      ok: true,
      data: {
        username: attemptUsername,
        password: finalPassword,
        exp_date: activateData.exp_date,
        domain,
        m3u_url,
        owner_credits: activateData.owner?.credits || null,
      },
    });
  } catch {
    // ✅ nada de stack / detalhes
    return jsonError(500, "Erro interno");
  }
}
