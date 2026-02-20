import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

function isAuthorizedInternal(req: NextRequest) {
  // ✅ Se o secret não existir no env, considera tudo bloqueado
  if (!INTERNAL_API_SECRET) return false;

  const got = req.headers.get("x-internal-secret") || "";
  return got === INTERNAL_API_SECRET;
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    // ✅ BLINDAGEM: só interno (não revela que existe)
    if (!isAuthorizedInternal(req)) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));

    const integration_id = String(body?.integration_id ?? "").trim();
    const username = String(body?.username ?? "").trim();
    const password = String(body?.password ?? "").trim();

    const months = body?.months ?? 1;
    const screens = body?.screens ?? 1;

    if (!integration_id) {
      return NextResponse.json({ ok: false, error: "integration_id obrigatório" }, { status: 400 });
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ ok: false, error: "Config ausente no servidor" }, { status: 500 });
    }

    // Criar cliente service_role (server-only)
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Buscar token + secret
    const { data: integ, error: integErr } = await supabase
      .from("server_integrations")
      .select("api_token, api_secret, provider")
      .eq("id", integration_id)
      .single();

    if (integErr || !integ) {
      return NextResponse.json({ ok: false, error: "Integração não encontrada" }, { status: 404 });
    }

    if (String(integ.provider || "").toUpperCase() !== "FAST") {
      return NextResponse.json({ ok: false, error: "Provider inválido" }, { status: 400 });
    }

    const token = String(integ.api_token || "").trim();
    const secret = String(integ.api_secret || "").trim();

    if (!token) {
      return NextResponse.json({ ok: false, error: "Token não configurado" }, { status: 400 });
    }

    if (!secret) {
      return NextResponse.json({ ok: false, error: "Secret não configurado" }, { status: 400 });
    }

    // ✅ NOVO: Buscar todos os pacotes (bouquets) disponíveis no painel
    let allBouquetIds: number[] = [];
    try {
      const bqRes = await fetch(`https://api.painelcliente.com/bouquets/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const bqText = await bqRes.text().catch(() => "");
      const bqData = safeJsonParse(bqText);
      if (bqData?.result === true && Array.isArray(bqData?.data)) {
        allBouquetIds = bqData.data.map((b: any) => Number(b.id));
      }
    } catch (err) {
      console.error("Erro ao buscar bouquets do Fast (create-client):", err);
    }

    // Se não conseguiu carregar nenhum pacote, bloqueia a criação
    if (allBouquetIds.length === 0) {
      return NextResponse.json({ ok: false, error: "Falha ao carregar os pacotes (bouquets) do painel Fast." }, { status: 502 });
    }

    // Validação (mantém sua lógica)
    const finalMonths = Math.max(1, Math.min(12, Number(months)));
    const finalConnections = Math.max(1, Number(screens) || 1);

// ✅ HIGIENIZAÇÃO: Remove espaços e acentos, mantém maiúsculas/minúsculas
    const baseUser = username ? username.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "") : "";

    // Retry logic (mantém sua lógica)
    let attemptUsername = baseUser || `client${Date.now()}`;
    const attemptPassword = password || Math.random().toString(36).slice(-8);

    let finalData: any = null;
    let lastError: any = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(`https://api.painelcliente.com/create_client/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            secret,
            username: attemptUsername,
            password: attemptPassword,
            idbouquet: allBouquetIds, // ✅ Envia o array real de IDs numéricos (Pacote Completo)
            month: finalMonths,
            connections: finalConnections,
          }),
        }).finally(() => clearTimeout(timeout));

        const text = await res.text().catch(() => "");
        const data = safeJsonParse(text) ?? {};

        // ✅ NÃO expõe text/raw pro cliente: só usa internamente pra decidir retry
        if (!res.ok || data?.result !== true) {
          const msg = String(data?.mens || data?.error || "").toLowerCase();

          if (
            msg.includes("username") ||
            msg.includes("exist") ||
            msg.includes("duplicate") ||
            msg.includes("já cadastrado")
          ) {
            const random = Math.floor(Math.random() * 900) + 100;
            attemptUsername = `${baseUser || "client"}${random}`;
            lastError = new Error("Username já existe");
            continue;
          }

          lastError = new Error(data?.mens || data?.error || "Erro na API FAST");
          continue;
        }

        finalData = data;
        break;
      } catch (err: any) {
        lastError = err;
        if (attempt < 3) {
          const random = Math.floor(Math.random() * 900) + 100;
          attemptUsername = `${username || "client"}${random}`;
        }
      }
    }

    if (!finalData) {
      // ✅ resposta limpa
      const msg =
        lastError?.name === "AbortError"
          ? "Timeout ao chamar FAST"
          : "Falha ao criar cliente no FAST";
      return NextResponse.json({ ok: false, error: msg }, { status: 502 });
    }

    // Vencimento (meses a partir de agora) — mantém seu comportamento
    const now = new Date();
    const exp = new Date(now);
    exp.setMonth(exp.getMonth() + finalMonths);
    const exp_date = Math.floor(exp.getTime() / 1000);

    // M3U (mantém sua lógica)
    const domain = finalData?.data?.domain || "painel.fast";
    const m3u_url = `http://${domain}/get.php?username=${attemptUsername}&password=${attemptPassword}&type=m3u_plus&output=ts`;

    return NextResponse.json({
      ok: true,
      data: {
        username: attemptUsername,
        password: attemptPassword,
        exp_date,
        domain,
        m3u_url,
        owner_credits: null,
      },
    });
  } catch (err: any) {
    // ✅ log só no servidor (não volta stack/msg interno pro caller)
    console.error("FAST create-client internal error:", err?.message || err);

    return NextResponse.json(
      { ok: false, error: "Erro ao processar solicitação" },
      { status: 500 }
    );
  }
}
