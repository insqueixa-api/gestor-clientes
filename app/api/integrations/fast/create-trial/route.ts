import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { integration_id, username, password } = body;

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

    // Retry logic
    let attemptUsername = username || `trial${Date.now()}`;
    const attemptPassword = password || Math.random().toString(36).slice(-8);
    let finalData: any = null;
    let lastError: any = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`https://api.painelcliente.com/trial_create/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret,
            username: attemptUsername,
            password: attemptPassword,
            idbouquet: [attemptUsername], // Bouquet = username
          }),
        });

        const text = await res.text();
        let data: any = {};
        try { data = JSON.parse(text); } catch { data = { raw: text }; }

        if (!res.ok || data.result !== true) {
          const errMsg = (data.mens || data.error || text || "").toLowerCase();
          if (errMsg.includes("username") || errMsg.includes("exist") || errMsg.includes("duplicate") || errMsg.includes("já cadastrado")) {
            const random = Math.floor(Math.random() * 900) + 100;
            attemptUsername = `${username || "trial"}${random}`;
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
          attemptUsername = `${username || "trial"}${random}`;
        }
      }
    }

    if (!finalData) {
      throw lastError || new Error("Falha após 3 tentativas");
    }

    // Vencimento (4h a partir de agora)
    const now = new Date();
    const exp = new Date(now.getTime() + 4 * 60 * 60 * 1000); // +4h
    const exp_date = Math.floor(exp.getTime() / 1000);

    // M3U (FAST pode retornar domain no data, ou usar padrão)
    const domain = finalData.data?.domain || "painel.fast"; // ajustar se souber o padrão
    const m3u_url = `http://${domain}/get.php?username=${attemptUsername}&password=${attemptPassword}&type=m3u_plus&output=ts`;

    return NextResponse.json({
      ok: true,
      data: {
        username: attemptUsername,
        password: attemptPassword,
        exp_date,
        domain,
        m3u_url,
        owner_credits: null, // FAST não retorna créditos no trial
      },
    });

  } catch (err: any) {
    console.error("Erro create-trial FAST:", err);
    return NextResponse.json({ ok: false, error: err.message || "Erro desconhecido" }, { status: 500 });
  }
}
