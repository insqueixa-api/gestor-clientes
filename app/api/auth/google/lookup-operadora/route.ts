import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 🌍 MAPA DE DDI PARA IDENTIFICAÇÃO INTERNACIONAL
const DDI_OPTIONS = [
  { code: "1",   label: "EUA/Canadá" },
  { code: "351", label: "Portugal" },
  { code: "353", label: "Irlanda" },
  { code: "507", label: "Panamá" },
  { code: "506", label: "Costa Rica" },
  { code: "595", label: "Paraguai" },
  { code: "591", label: "Bolívia" },
  { code: "234", label: "Nigéria" },
  { code: "254", label: "Quênia" },
  { code: "212", label: "Marrocos" },
  { code: "971", label: "Emirados Árabes" },
  { code: "966", label: "Arábia Saudita" },
  { code: "44",  label: "Reino Unido" },
  { code: "34",  label: "Espanha" },
  { code: "49",  label: "Alemanha" },
  { code: "33",  label: "França" },
  { code: "39",  label: "Itália" },
  { code: "52",  label: "México" },
  { code: "54",  label: "Argentina" },
  { code: "56",  label: "Chile" },
  { code: "57",  label: "Colômbia" },
  { code: "58",  label: "Venezuela" },
  { code: "32",  label: "Bélgica" },
  { code: "46",  label: "Suécia" },
  { code: "31",  label: "Holanda" },
  { code: "41",  label: "Suíça" },
  { code: "45",  label: "Dinamarca" },
  { code: "48",  label: "Polônia" },
  { code: "30",  label: "Grécia" },
  { code: "27",  label: "África do Sul" },
  { code: "20",  label: "Egito" },
  { code: "86",  label: "China" },
  { code: "91",  label: "Índia" },
  { code: "81",  label: "Japão" },
  { code: "82",  label: "Coreia do Sul" },
  { code: "66",  label: "Tailândia" },
  { code: "62",  label: "Indonésia" },
  { code: "60",  label: "Malásia" },
  { code: "98",  label: "Irã" },
  { code: "90",  label: "Turquia" },
  { code: "61",  label: "Austrália" },
  { code: "64",  label: "Nova Zelândia" }
];

function inferCountryLabel(digits: string): string {
  if (!digits) return "Internacional";
  const sorted = [...DDI_OPTIONS].sort((a, b) => b.code.length - a.code.length);
  for (const opt of sorted) {
    if (digits.startsWith(opt.code)) return opt.label;
  }
  return "Internacional";
}

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

    let label = "Celular";

    if (phone.startsWith("55")) {
      const operadora = await consultarOperadoraExterna(phone);
      if (operadora) label = `${operadora}:`;
    } else {
      label = `${inferCountryLabel(phone)}:`;
    }
    
    return NextResponse.json({ operadora: label });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}