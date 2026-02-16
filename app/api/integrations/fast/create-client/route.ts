import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { integration_id, username, password, months = 1, screens = 1 } = body;

    if (!integration_id) {
      return NextResponse.json({ ok: false, error: "integration_id obrigatório" }, { status: 400 });
    }

    // Criar cliente service_role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Buscar token + secret
    const { data: integ, error: integErr } = await supabase
      .from("server_integrations")
      .select("api_token, api_secret, provider")
      .eq("id", integration_id)
      .single();

    if (integErr || !integ) {
      return NextResponse.json({ ok: false, error: "Integração não encontrada" }, { status: 404 });
    }

    if (integ.provider !== "FAST") {
      return NextResponse.json({ ok: false, error: "Provider inválido" }, { status: 400 });
    }

    const token = integ.api_token;
    const secret = integ.api_secret;

    if (!secret) {
      return NextResponse.json({ ok: false, error: "Secret não configurado" }, { status: 400 });
    }

    // Validação
    const finalMonths = Math.max(1, Math.min(12, Number(months)));
    const finalConnections = Math.max(1, Number(screens));

    // Retry logic
    let attemptUsername = username || `client${Date.now()}`;
    const attemptPassword = password || Math.random().toString(36).slice(-8);
    let finalData: any = null;
    let lastError: any = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`https://api.painelcliente.com/create_client/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret,
            username: attemptUsername,
            password: attemptPassword,
            idbouquet: [attemptUsername], // Bouquet = username
            month: finalMonths,
            connections: finalConnections,
          }),
        });

        const text = await res.text();
        let data: any = {};
        try { data = JSON.parse(text); } catch { data = { raw: text }; }

        if (!res.ok || data.result !== true) {
          const errMsg = (data.mens || data.error || text || "").toLowerCase();
          if (errMsg.includes("username") || errMsg.includes("exist") || errMsg.includes("duplicate") || errMsg.includes("já cadastrado")) {
            const random = Math.floor(Math.random() * 900) + 100;
            attemptUsername = `${username || "client"}${random}`;
            lastError = new Error(`Username já existe (tentativa ${attempt}/3)`);
            continue;
          }

          throw new Error(data.mens || data.error || text || "Erro na API FAST");
        }

        // Sucesso!
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
      throw lastError || new Error("Falha após 3 tentativas");
    }

    // Vencimento (meses a partir de agora)
    const now = new Date();
    const exp = new Date(now);
    exp.setMonth(exp.getMonth() + finalMonths);
    const exp_date = Math.floor(exp.getTime() / 1000);

    // M3U (FAST pode retornar domain no data, ou usar padrão)
    const domain = finalData.data?.domain || "painel.fast"; // ajustar se souber o padrão
    const m3u_url = `http://${domain}/${attemptUsername}/${attemptPassword}/playlist.m3u8`;

    return NextResponse.json({
      ok: true,
      data: {
        username: attemptUsername,
        password: attemptPassword,
        exp_date,
        domain,
        m3u_url,
        owner_credits: null, // FAST não retorna créditos por padrão
      },
    });

  } catch (err: any) {
    console.error("Erro create-client FAST:", err);
    return NextResponse.json({ ok: false, error: err.message || "Erro desconhecido" }, { status: 500 });
  }
}
