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

function looksLikeDuplicateUsername(msg: string) {
  const s = (msg || "").toLowerCase();
  return (
    s.includes("username") ||
    s.includes("exist") ||
    s.includes("duplicate") ||
    s.includes("já cadastrado") ||
    s.includes("cadastrado")
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const integration_id = String(body?.integration_id ?? "").trim();
    const usernameRaw = body?.username;
    const passwordRaw = body?.password;

    if (!integration_id) {
      return jsonError(400, "integration_id obrigatório");
    }

    // ✅ Gate: interno OU usuário autenticado (admin/painel)
    const internal = isInternal(req);
    if (!internal) {
      const supabaseAuth = await createSupabaseServer();
      const { data: auth, error: authErr } = await supabaseAuth.auth.getUser();
      if (authErr || !auth?.user?.id) {
        return jsonError(401, "Unauthorized");
      }
    }

    // ✅ Buscar token + secret dependendo da origem
    let integ = null;

    if (internal) {
      // ✅ PORTAL: Usa service role, mas OBRIGA a cruzar o tenant_id
      const tenant_id = String(body?.tenant_id ?? "").trim();
      if (!tenant_id) return jsonError(400, "tenant_id obrigatório (interno)");

      const supabaseAdmin = createSupabaseAdmin(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false },
      });

      const { data, error } = await supabaseAdmin
        .from("server_integrations")
        .select("api_token, api_secret, provider, is_active")
        .eq("id", integration_id)
        .eq("tenant_id", tenant_id) // TRAVA ABSOLUTA
        .single();

      if (error) return jsonError(500, "Falha ao buscar integração interna.");
      integ = data;
    } else {
      // ✅ PAINEL ADMIN: Usa o client do usuário logado (RLS protege automático)
      const supabaseAuth = await createSupabaseServer();
      const { data, error } = await supabaseAuth
        .from("server_integrations")
        .select("api_token, api_secret, provider, is_active")
        .eq("id", integration_id)
        .single();

      if (error) return jsonError(500, "Falha ao buscar integração do painel.");
      integ = data;
    }
    if (!integ) return jsonError(404, "Integração não encontrada");
    if (String(integ.provider ?? "").toUpperCase() !== "FAST") {
      return jsonError(400, "Provider inválido");
    }
    if (integ.is_active === false) {
      return jsonError(400, "Integração está inativa");
    }

    const token = String(integ.api_token ?? "").trim();
    const secret = String(integ.api_secret ?? "").trim();

    if (!token) return jsonError(400, "Token não configurado");
    if (!secret) return jsonError(400, "Secret não configurado");

    // ✅ NOVO: Buscar todos os pacotes (bouquets) disponíveis no painel
    let allBouquetIds: number[] = [];
    try {
      const bqRes = await fetch(`${FAST_BASE_URL}/bouquets/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const bqData = await bqRes.json();
      if (bqData?.result === true && Array.isArray(bqData?.data)) {
        // Extrai apenas os números (IDs) de cada pacote
        allBouquetIds = bqData.data.map((b: any) => Number(b.id));
      }
    } catch (err) {
      console.error("Erro ao buscar bouquets do Fast:", err);
    }

    // Se não conseguiu carregar nenhum pacote, bloqueia a criação para não dar erro na API deles
    if (allBouquetIds.length === 0) {
      return jsonError(502, "Falha ao carregar os pacotes (bouquets) do painel Fast. Verifique a comunicação.");
    }

    // ✅ HIGIENIZAÇÃO: Remove espaços e acentos, mantém maiúsculas/minúsculas
    const baseUser = (typeof usernameRaw === "string" && usernameRaw.trim()) 
      ? usernameRaw.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "") 
      : "";

    // Retry logic
    let attemptUsername = baseUser || `trial${Date.now()}`;

    // ✅ BLINDAGEM FAST: Se o nome for muito curto, o painel rejeita, gerando falso loop
    if (attemptUsername.length < 8) {
      attemptUsername = `${attemptUsername}${Math.floor(Math.random() * 90000) + 10000}`;
    }

    const attemptPassword =
      (typeof passwordRaw === "string" && passwordRaw.trim())
        ? passwordRaw.trim()
        : Math.random().toString(36).slice(-8);

    let finalData: any = null;
    let lastErrMsg = "Falha ao criar trial";

    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch(`${FAST_BASE_URL}/trial_create/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret,
            username: attemptUsername,
            password: attemptPassword,
            idbouquet: allBouquetIds, // ✅ Agora envia o array real de IDs dos pacotes (Pacote Completo)
          }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        const text = await res.text().catch(() => "");
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }

        const ok = res.ok && data?.result === true;
        if (!ok) {
          const mens = String(data?.mens || data?.error || text || "Erro na API FAST");
          lastErrMsg = mens;

          if (looksLikeDuplicateUsername(mens)) {
            const random = Math.floor(Math.random() * 900) + 100;
            attemptUsername = `${baseUser || "trial"}${random}`;
            continue;
          }

          // erro não relacionado a username => não insiste
          break;
        }

        finalData = data;
        break;
      } catch (e: any) {
        clearTimeout(timeout);
        lastErrMsg =
          e?.name === "AbortError" ? "Timeout ao chamar FAST." : (e?.message || "Erro ao chamar FAST.");

        if (attempt < 3) {
          const random = Math.floor(Math.random() * 900) + 100;
          // ✅ CORREÇÃO: Usa o baseUser limpo, para não injetar espaços na tentativa extra
          attemptUsername = `${baseUser || "trial"}${random}`;
        }
      }
    }

    if (!finalData) {
      // ✅ Expõe o erro REAL do painel para pararmos de adivinhar o que deu errado
      const msg = looksLikeDuplicateUsername(lastErrMsg)
        ? `Tentativas esgotadas. Erro do painel: ${lastErrMsg}`
        : `Falha no FAST. Detalhe: ${lastErrMsg}`;
      return jsonError(502, msg);
    }

    // Vencimento (4h a partir de agora) — (mantido igual ao seu)
    const now = new Date();
    const exp = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const exp_date = Math.floor(exp.getTime() / 1000);

    // ✅ A GRANDE MÁGICA: Devolvemos a m3u_url vazia! 
    // Assim, o Frontend NovoCliente vai puxar a URL correta do DNS cadastrado na tela de Servidores!
    const m3u_url = "";

    return NextResponse.json({
      ok: true,
      data: {
        username: attemptUsername,
        password: attemptPassword,
        exp_date,
        m3u_url, // Vazio
        owner_credits: null,
      },
    });
  } catch {
    return jsonError(500, "Erro create-trial FAST");
  }
}