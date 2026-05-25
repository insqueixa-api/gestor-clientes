/* Remover
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  

  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    
    // Dispara para a sua própria API
    const res = await fetch(`${origin}/api/notifications/manual-renewal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": String(process.env.INTERNAL_API_SECRET),
      },
      body: JSON.stringify({
        clientName: "Marcio (Teste Rápido)",
        serverUsername: "marcio.dev",
        serverName: "UniGestor Local",
        planLabel: "Semestral",
        amount: 6.00,
        currency: "BRL",
        mpPaymentId: "TESTE_12345",
        reason: "Simulação de erro: Servidor sem integração",
      }),
    });

    const data = await res.json();
    return NextResponse.json({ success: true, emailRes: data });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
  
*/ // Remover

export {}; // Nunca remover - Necessário para evitar conflitos de declarações com a rota real de envio de e-mails