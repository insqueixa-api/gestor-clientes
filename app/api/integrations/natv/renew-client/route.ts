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

    // Validar months permitidos
    const validMonths = [1, 2, 3, 4, 5, 6, 12];
    if (!validMonths.includes(Number(months))) {
      return NextResponse.json(
        { ok: false, error: "months deve ser 1, 2, 3, 4, 5, 6 ou 12" },
        { status: 400 }
      );
    }

    // ✅ CORRIGIDO: Usar Supabase Server
    const supabase = await createClient();

    // 1. Buscar integração
    const { data: integ, error: integErr } = await supabase
      .from("server_integrations")
      .select("api_token, provider")
      .eq("id", integration_id)
      .single();

    if (integErr || !integ) {
      console.error("Erro ao buscar integração:", integErr);
      return NextResponse.json(
        { ok: false, error: "Integração não encontrada" },
        { status: 404 }
      );
    }

    if (integ.provider !== "NATV") {
      return NextResponse.json(
        { ok: false, error: "Integração não é NATV" },
        { status: 400 }
      );
    }

    const token = integ.api_token;

    // 2. Chamar API NATV (/user/activation)
    const apiUrl = "https://revenda.pixbot.link/user/activation";
    
    const apiRes = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        username: username,
        months: Number(months),
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error("NATV API Error:", apiRes.status, errText);
      
      // Erros específicos
      if (apiRes.status === 402) {
        return NextResponse.json(
          { ok: false, error: "Créditos insuficientes no servidor" },
          { status: 402 }
        );
      }
      if (apiRes.status === 404) {
        return NextResponse.json(
          { ok: false, error: "Usuário não encontrado no servidor" },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { ok: false, error: `NATV API retornou erro: ${apiRes.status}` },
        { status: apiRes.status }
      );
    }

    const apiJson = await apiRes.json();

    // 3. Extrair dados da resposta
    const expDate = apiJson.exp_date; // timestamp Unix
    const password = apiJson.password;

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
        password: password || null,
        credits: apiJson.owner?.credits || null,
      },
    });

  } catch (err: any) {
    console.error("NATV Renew Error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Erro ao renovar cliente NATV" },
      { status: 500 }
    );
  }
}