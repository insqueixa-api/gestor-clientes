import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { integration_id, username, months = 1, screens = 1 } = body;

    if (!integration_id) {
      return NextResponse.json({ ok: false, error: "integration_id obrigatório" }, { status: 400 });
    }

    // Criar cliente service_role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Buscar token
    const { data: integ, error: integErr } = await supabase
      .from("server_integrations")
      .select("api_token, provider")
      .eq("id", integration_id)
      .single();

    if (integErr || !integ) {
      return NextResponse.json({ ok: false, error: "Integração não encontrada" }, { status: 404 });
    }

    if (integ.provider !== "NATV") {
      return NextResponse.json({ ok: false, error: "Provider inválido" }, { status: 400 });
    }

    const token = integ.api_token;

    // Validação
    const finalMonths = Math.max(1, Math.min(12, Number(months)));

    // Retry logic para username
    let attemptUsername = username || `client${Date.now()}`;
    let userId: number | null = null;
    let finalPassword = "";
    let lastError: any = null;

    // ETAPA 1: Criar usuário teste (15 min)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
const res = await fetch("https://revenda.pixbot.link/user", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  },
  body: JSON.stringify({
    username: attemptUsername,
    minutes: "15", // ✅ STRING
  }),
});

        const text = await res.text();
        let data: any = {};
        try { data = JSON.parse(text); } catch { data = { raw: text }; }

        if (!res.ok) {
          const errMsg = (data.error || data.message || text || "").toLowerCase();
          if (errMsg.includes("username") || errMsg.includes("exist") || errMsg.includes("duplicate")) {
            const random = Math.floor(Math.random() * 900) + 100;
            attemptUsername = `${username || "client"}${random}`;
            lastError = new Error(`Username já existe (tentativa ${attempt}/3)`);
            continue;
          }

          throw new Error(data.error || data.message || text || "Erro ao criar usuário");
        }

        // Sucesso!
        userId = Number(data.id);
        finalPassword = data.password || "";
        break;

      } catch (err: any) {
        lastError = err;
        if (attempt < 3) {
          const random = Math.floor(Math.random() * 900) + 100;
          attemptUsername = `${username || "client"}${random}`;
        }
      }
    }

    if (!userId) {
      throw lastError || new Error("Falha ao criar usuário após 3 tentativas");
    }

    // ETAPA 2: Ativar/Renovar
    const activateRes = await fetch("https://revenda.pixbot.link/user/activation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        user_id: userId,
        months: finalMonths,
      }),
    });

    const activateText = await activateRes.text();
    let activateData: any = {};
    try { activateData = JSON.parse(activateText); } catch { activateData = { raw: activateText }; }

    if (!activateRes.ok) {
      throw new Error(activateData.error || activateData.message || activateText || "Erro ao ativar");
    }

    // Construir M3U URL
    const domain = activateData.domain || "natv.pm";
    const m3u_url = `http://${domain}/get.php?username=${attemptUsername}&password=${finalPassword}&type=m3u_plus&output=ts`;

    // Retornar dados
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

  } catch (err: any) {
    console.error("Erro create-client NATV:", err);
    return NextResponse.json({ ok: false, error: err.message || "Erro desconhecido" }, { status: 500 });
  }
}
