import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 📡 INTEGRAÇÃO COM A API DE PORTABILIDADE/OPERADORA
async function consultarOperadoraExterna(phoneDigits: string): Promise<string | null> {
  try {
    // ⚠️ MOCK TEMPORÁRIO PARA TESTES
    // Substitua pela sua chamada real (Telein, etc) depois
    const lastDigit = phoneDigits.slice(-1);
    if (["1", "2", "3"].includes(lastDigit)) return "Vivo";
    if (["4", "5", "6"].includes(lastDigit)) return "Claro";
    if (["7", "8", "9"].includes(lastDigit)) return "Tim";
    return "Oi";
  } catch (error) {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { phone } = await req.json();
    if (!phone) return NextResponse.json({ error: "Telefone não fornecido" }, { status: 400 });

    const operadora = await consultarOperadoraExterna(phone);
    
    return NextResponse.json({ operadora: operadora || "Celular" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}