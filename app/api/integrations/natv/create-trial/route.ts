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
    const { integration_id, username, hours = 6 } = body;

    if (!integration_id) {
      return jsonError(400, "integration_id obrigatório");
    }

    const internal = isInternal(req);

    // ✅ Se não for interno, exige usuário logado (admin/painel)
    if (!internal) {
      const supabaseAuth = await createSupabaseServer();
      const { data: auth, error: authErr } = await supabaseAuth.auth.getUser();
      if (authErr || !auth?.user?.id) {
        return jsonError(401, "Unauthorized");
      }
    }

    const minutes = Number(hours) * 60;

    // Validação de horas (2, 4, 6)
    if (![120, 240, 360].includes(minutes)) {
      return jsonError(400, "Horas inválidas (2, 4 ou 6)");
    }

    // ✅ Token:
    // - Interno: usa service_role (server-to-server)
    // - Não-interno: usa RPC segura + RLS (admin logado)
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

      // provider (via RLS)
      const { data: integ, error: integErr } = await supabase
        .from("server_integrations")
        .select("provider")
        .eq("id", String(integration_id))
        .single();

      if (integErr || !integ) return jsonError(404, "Integração não encontrada");
      if (integ.provider !== "NATV") return jsonError(400, "Provider inválido");

      // token via RPC segura (SECURITY DEFINER)
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

// Retry logic: até 3 tentativas
    let attemptUsername = (username ? String(username) : `test${Date.now()}`).trim();
    if (!attemptUsername) attemptUsername = `test${Date.now()}`;
    
    // ✅ BLINDAGEM NATV: O username precisa ter entre 8 e 48 caracteres (Documentação)
    if (attemptUsername.length < 8) {
      // Preenche com números aleatórios se for muito curto
      attemptUsername = `${attemptUsername}${Math.floor(Math.random() * 90000) + 10000}`;
    }

    let finalData: any = null;
    let lastError: any = null;

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
            minutes: String(minutes), // ✅ NATV espera string
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
          // ✅ NATV devolve a mensagem de erro no campo "detail" (pode ser string ou array se for 422)
          const detailValue = typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail || "");
          const rawMsg = String(data?.error || data?.message || detailValue || text || "");
          
          // ✅ A API da NATV especificamente retorna status 505 com detail: "Usuario já existe!"
          if (res.status === 505 || looksLikeDuplicateUsername(rawMsg)) {
            const random = Math.floor(Math.random() * 90000) + 10000;
            // Pega uma base menor e adiciona o randômico para não estourar os 48 caracteres permitidos
            attemptUsername = `${(username || "test").toString().trim().slice(0, 15)}${random}`;
            lastError = new Error(`Username já existe (tentativa ${attempt}/3)`);
            continue;
          }

          // ✅ erro sanitizado (não devolve raw da NATV)
          if (res.status === 402) return jsonError(402, "Créditos insuficientes no servidor");
          if (res.status === 404) return jsonError(404, "Endpoint NATV não encontrado");
          if (res.status === 422) return jsonError(422, "Erro de formatação: nome muito curto ou com caracteres inválidos");

          return jsonError(502, "Falha ao criar teste no servidor");
        }

        // Sucesso!
        finalData = data;
        break;
      } catch (err: any) {
        lastError = err;
        if (attempt < 3) {
          const random = Math.floor(Math.random() * 900) + 100;
          attemptUsername = `${(username || "test").toString().trim() || "test"}${random}`;
        }
      }
    }

    if (!finalData) {
      return jsonError(502, "Falha ao criar teste no servidor");
    }

    // Construir M3U URL
    const domain = finalData.domain || "natv.pm";
    const finalUsername = finalData.username || attemptUsername;
    const finalPassword = finalData.password || "";
    const m3u_url = `http://${domain}/get.php?username=${finalUsername}&password=${finalPassword}&type=m3u_plus&output=ts`;

    // Retornar dados (somente para admin/interno)
    return NextResponse.json({
      ok: true,
      data: {
        username: finalUsername,
        password: finalPassword,
        exp_date: finalData.exp_date,
        domain,
        m3u_url,
        owner_credits: finalData.owner?.credits || null,
      },
    });
  } catch {
    // ✅ sem logs detalhados
    return jsonError(500, "Erro interno");
  }
}
