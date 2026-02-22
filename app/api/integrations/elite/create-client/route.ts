import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Helper para extrair o Bearer Token que o Frontend mandou
function getBearer(req: Request) {
  const a = req.headers.get("authorization") || "";
  if (a.toLowerCase().startsWith("bearer ")) return a.slice(7).trim();
  return "";
}

export async function POST(req: Request) {
  const trace: any[] = [];

  try {
    // 1) Pega as credenciais internas e a origem (URL base do seu próprio painel)
    const token = getBearer(req);
    const internalSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
    
    // A mágica: descobre a URL do seu sistema automaticamente (ex: https://seupainel.com)
    const origin = new URL(req.url).origin;

    const body = await req.json().catch(() => ({}));
    const { integration_id, tenant_id, username, password, technology, notes, months } = body;

    if (!integration_id || !months) {
      return NextResponse.json({ ok: false, error: "Integração e quantidade de meses são obrigatórios." }, { status: 400 });
    }

    // =========================================================================
    // PASSO 1: CRIAR A CONTA COMO TESTE (TRIAL)
    // =========================================================================
    trace.push({ step: "calling_create_trial" });
    
    const trialRes = await fetch(`${origin}/api/integrations/elite/create-trial`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(internalSecret ? { "x-internal-secret": internalSecret } : {})
      },
      body: JSON.stringify({ integration_id, tenant_id, username, password, technology, notes })
    });

    const trialJson = await trialRes.json().catch(() => null);
    
    if (!trialRes.ok || !trialJson?.ok) {
       throw new Error(trialJson?.error || "Falha ao criar o usuário inicial no painel.");
    }

    // Pega os dados validados que a nossa API de trial blindada devolveu
    // (Lembrando que nossa API do trial já limpa e descobre o ID verdadeiro pro P2P e IPTV)
    const trialData = trialJson.data || trialJson; 
    const external_user_id = trialData.external_user_id;
    const server_username = trialData.username || trialData.server_username;
    const server_password = trialData.password || trialData.server_password;

    if (!external_user_id) {
        throw new Error("Usuário criado, mas não foi possível obter o ID numérico para realizar a renovação.");
    }

    trace.push({ step: "trial_created", external_user_id, server_username });

    // =========================================================================
    // PASSO 2: RENOVAR A CONTA (CONVERTER PARA CLIENTE OFICIAL)
    // =========================================================================
    trace.push({ step: "calling_renew", months });
    
    const renewRes = await fetch(`${origin}/api/integrations/elite/renew`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(internalSecret ? { "x-internal-secret": internalSecret } : {})
      },
      body: JSON.stringify({
        integration_id,
        tenant_id,
        external_user_id,
        technology,
        months
      })
    });

    const renewJson = await renewRes.json().catch(() => null);
    
    if (!renewRes.ok || !renewJson?.ok) {
       throw new Error(renewJson?.error || "Conta criada, mas houve uma falha ao adicionar os meses.");
    }
    
    trace.push({ step: "renew_successful" });

    // =========================================================================
    // PASSO 3: SINCRONIZAR CRÉDITOS DO SERVIDOR (BACKGROUND)
    // =========================================================================
    // Não usamos await aqui para não fazer o cliente esperar. Roda em segundo plano!
    trace.push({ step: "calling_sync_background" });
    fetch(`${origin}/api/integrations/elite/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(internalSecret ? { "x-internal-secret": internalSecret } : {})
      },
      body: JSON.stringify({ integration_id, tenant_id })
    }).catch(() => {}); // Ignora erros de rede nesse background task

    // =========================================================================
    // PASSO FINAL: DEVOLVER OS DADOS LINDOS PARA O FRONTEND (NovoCliente)
    // =========================================================================
    return NextResponse.json({
      ok: true,
      provider: "ELITE",
      data: {
         external_user_id,
         username: server_username,
         password: server_password,
         // O seu Frontend (NovoCliente) já sabe calcular perfeitamente o 
         // novo vencimento baseando-se nos meses. Não precisamos devolver exp_date_iso aqui.
      },
      trace
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Erro interno ao criar cliente.", trace },
      { status: 500 }
    );
  }
}