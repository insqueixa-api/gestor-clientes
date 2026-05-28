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

// 📡 INTEGRAÇÃO COM A TELEIN DE PORTABILIDADE/OPERADORA
async function consultarOperadoraExterna(phoneDigits: string): Promise<string | null> {
  try {
    const chave = process.env.TELEIN_API_KEY ?? "";
    if (!chave) return null;

    // Remove o '55' inicial se houver, pois a Telein trabalha com DDD + Número (ex: 21999999999)
    const numeroTratado = phoneDigits.startsWith("55") ? phoneDigits.substring(2) : phoneDigits;

    // Utilizando o servidor 1 da Telein com a resposta resumida
    const res = await fetch(
      `http://consultanumero1.telein.com.br/sistema/consulta_numero.php?chave=${chave}&numero=${numeroTratado}`,
      { signal: AbortSignal.timeout(5000) }
    );
    
    if (!res.ok) return null;

    // Lê a resposta em texto puro (ex: "21#21992347771")
    const textoRetorno = await res.text();
    const partes = textoRetorno.split("#");
    
    if (partes.length === 0) return null;
    
    const codigoDaOperadora = partes[0].trim();

    // Tratamento de erros da Telein (códigos 99, 990 a 999)
    if (codigoDaOperadora.startsWith("99")) {
      console.error("Aviso/Erro da Telein:", textoRetorno);
      return null;
    }

    // Mapeamento oficial dos códigos da Telein para o nome da operadora
    const mapOperadoras: Record<string, string> = {
      "20": "Vivo",
      "21": "Claro",
      "31": "Oi",
      "41": "TIM",
      "12": "Algar",
      "14": "Oi",       // Antiga Brasil Telecom
      "77": "Claro",    // Antiga Nextel
      "34": "Vivo",     // Telefônica Fixo
      "35": "Claro",    // Embratel Fixo
      "36": "Oi",       // Telemar Fixo
      "38": "Vivo",     // GVT Fixo
      "40": "TIM",      // TIM Fixo
    };

    return mapOperadoras[codigoDaOperadora] || "Celular/Fixo";

  } catch (error) {
    console.error("Erro na consulta Telein:", error);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { phone } = await req.json();
    if (!phone) return NextResponse.json({ error: "Telefone não fornecido" }, { status: 400 });

    if (phone.startsWith("55")) {
      const operadora = await consultarOperadoraExterna(phone);
      if (operadora) {
        return NextResponse.json({ operadora: `${operadora}:` });
      } else {
        // AGORA ELE AVISA O FRONT QUE DEU ERRO! (Botão vai ficar vermelho)
        return NextResponse.json({ error: "Falha ao consultar operadora na Telein (Verifique a chave ou limite)." }, { status: 400 });
      }
    } else {
      return NextResponse.json({ operadora: `${inferCountryLabel(phone)}:` });
    }
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}