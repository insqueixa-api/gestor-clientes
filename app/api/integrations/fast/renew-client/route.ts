import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { integration_id, username, months } = body;

    // Validação
    if (!integration_id || !username || !months) {
      return NextResponse.json(
        { ok: false, error: "integration_id, username e months são obrigatórios" },
        { status: 400 }
      );
    }

    // Validar months (Fast aceita 1-12)
    const monthsNum = Number(months);
    if (monthsNum < 1 || monthsNum > 12) {
      return NextResponse.json(
        { ok: false, error: "months deve ser entre 1 e 12" },
        { status: 400 }
      );
    }

    // ✅ CORRIGIDO: Usar Supabase Server
    const supabase = await createClient();

    // 1. Buscar integração
    const { data: integ, error: integErr } = await supabase
      .from("server_integrations")
      .select("api_token, api_secret, provider")
      .eq("id", integration_id)
      .single();

    if (integErr || !integ) {
      console.error("Erro ao buscar integração:", integErr);
      return NextResponse.json(
        { ok: false, error: "Integração não encontrada" },
        { status: 404 }
      );
    }

    if (integ.provider !== "FAST") {
      return NextResponse.json(
        { ok: false, error: "Integração não é FAST" },
        { status: 400 }
      );
    }

    const token = integ.api_token;
    const secret = integ.api_secret;

    // 2. Chamar API FAST (/renew_client/{token})
    const apiUrl = `https://api.painelcliente.com/renew_client/${token}`;
    
    const apiRes = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret: secret,
        username: username,
        month: monthsNum,
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error("FAST API Error:", apiRes.status, errText);
      
      // Erro 429: rate limit (1 minuto entre renovações)
      if (apiRes.status === 429) {
        return NextResponse.json(
          { ok: false, error: "Aguarde 1 minuto antes de renovar este usuário novamente" },
          { status: 429 }
        );
      }
      
      return NextResponse.json(
        { ok: false, error: `FAST API retornou erro: ${apiRes.status}` },
        { status: apiRes.status }
      );
    }

    const apiJson = await apiRes.json();

    // Verificar se API retornou sucesso
    if (!apiJson.result) {
      return NextResponse.json(
        { ok: false, error: apiJson.mens || "Erro desconhecido na API" },
        { status: 400 }
      );
    }

    // 3. Extrair dados da resposta
    const expDate = apiJson.data?.exp_date; // timestamp Unix
    const connection = apiJson.data?.connection;
    const credits = apiJson.data?.credits;

    if (!expDate) {
      return NextResponse.json(
        { ok: false, error: "API não retornou exp_date" },
        { status: 500 }
      );
    }

    // Converter timestamp Unix para ISO
    const expDateISO = new Date(expDate * 1000).toISOString();

    // 4. Retornar sucesso
    return NextResponse.json({
      ok: true,
      data: {
        username: username,
        exp_date: expDate,
        exp_date_iso: expDateISO,
        connection: connection || null,
        credits: credits || null,
      },
    });

  } catch (err: any) {
    console.error("FAST Renew Error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Erro ao renovar cliente FAST" },
      { status: 500 }
    );
  }
}
