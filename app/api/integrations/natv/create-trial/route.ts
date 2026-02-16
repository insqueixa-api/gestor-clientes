import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { integration_id, username, hours = 6 } = body;

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
    const minutes = Number(hours) * 60;

    // Validação de horas (2, 4, 6)
    if (![120, 240, 360].includes(minutes)) {
      return NextResponse.json({ ok: false, error: "Horas inválidas (2, 4 ou 6)" }, { status: 400 });
    }

    // Retry logic: até 3 tentativas
    let attemptUsername = username || `test${Date.now()}`;
    let finalData: any = null;
    let lastError: any = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log("🔵 NATV Trial API Call:", {
  url: "https://revenda.pixbot.link/user",
  username: attemptUsername,
  minutes,
  token: token ? `${token.substring(0, 10)}...` : "SEM TOKEN",
});
        const res = await fetch("https://revenda.pixbot.link/user", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  },
  body: JSON.stringify({
    username: attemptUsername,
    minutes: String(minutes), // ✅ CONVERTER PARA STRING
  }),
});

        console.log("🟢 NATV Trial Response:", {
  status: res.status,
  ok: res.ok,
  statusText: res.statusText,
});

        const text = await res.text();
        let data: any = {};
        try { data = JSON.parse(text); } catch { data = { raw: text }; }

        if (!res.ok) {
          // Se erro de username duplicado, tenta novamente
          const errMsg = (data.error || data.message || text || "").toLowerCase();
          if (errMsg.includes("username") || errMsg.includes("exist") || errMsg.includes("duplicate")) {
            const random = Math.floor(Math.random() * 900) + 100;
            attemptUsername = `${username || "test"}${random}`;
            lastError = new Error(`Username já existe (tentativa ${attempt}/3)`);
            continue;
          }

          throw new Error(data.error || data.message || text || "Erro na API NATV");
        }

        // Sucesso!
        finalData = data;
        break;

      } catch (err: any) {
        lastError = err;
        if (attempt < 3) {
          const random = Math.floor(Math.random() * 900) + 100;
          attemptUsername = `${username || "test"}${random}`;
        }
      }
    }

    if (!finalData) {
      throw lastError || new Error("Falha após 3 tentativas");
    }

    // Construir M3U URL
    const domain = finalData.domain || "natv.pm";
    const finalUsername = finalData.username || attemptUsername;
    const finalPassword = finalData.password || "";
    const m3u_url = `http://${domain}/get.php?username=${finalUsername}&password=${finalPassword}&type=m3u_plus&output=ts`;

    // Retornar dados
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

  } catch (err: any) {
    console.error("Erro create-trial NATV:", err);
    return NextResponse.json({ ok: false, error: err.message || "Erro desconhecido" }, { status: 500 });
  }
}
