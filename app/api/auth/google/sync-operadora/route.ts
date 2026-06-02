import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Formata o telefone apenas com dígitos para enviar para a API de consulta
function onlyDigits(raw: string | null | undefined) {
  if (!raw) return "";
  return raw.replace(/\D+/g, "");
}

// 🪄 TRADUTOR DE LABELS PARA O GOOGLE
function getGoogleLabel(label: string, defaultType: string) {
  if (!label) return { type: defaultType };
  const low = label.toLowerCase();
  if (["casa", "home"].includes(low)) return { type: "home" };
  if (["trabalho", "work", "empresa"].includes(low)) return { type: "work" };
  if (["celular", "mobile"].includes(low)) return { type: "mobile" };
  if (["pessoal", "other", "outro"].includes(low)) return { type: "other" };
  return { type: label }; // Aceita o nome da operadora direto
}

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

function inferDDI(digits: string): string {
  if (!digits) return "55";
  const sorted = [...DDI_OPTIONS].sort((a, b) => b.code.length - a.code.length);
  for (const opt of sorted) {
    if (digits.startsWith(opt.code)) return opt.code;
  }
  return "55";
}

// 📡 INTEGRAÇÃO COM A TELEIN DE PORTABILIDADE/OPERADORA
async function consultarOperadoraExterna(phoneDigits: string): Promise<string | null> {
  try {
    // Pega estritamente a variável da Vercel e limpa qualquer aspa ou espaço acidental
    const chave = (process.env.TELEIN_API_KEY || "").replace(/['"]/g, "").trim();
    if (!chave) return null;

    // Remove o '55' inicial se houver, pois a Telein trabalha melhor com DDD + Número (ex: 21999999999)
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
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const body = await req.json();
    const { contact_ids } = body;

    if (!contact_ids || !Array.isArray(contact_ids) || contact_ids.length === 0) {
      return NextResponse.json({ error: "Nenhum contato selecionado." }, { status: 400 });
    }

    // 1. Pega os dados do Tenant
    const { data: tenantData } = await supabase.from("tenant_members").select("tenant_id").eq("user_id", user.id).limit(1).single();
    const tenantId = tenantData?.tenant_id;

    // 2. Pega o Token do Google
    const { data: tenantConfig } = await supabase.from("tenants").select("google_refresh_token").eq("id", tenantId).single();
    if (!tenantConfig?.google_refresh_token) throw new Error("Conta do Google não vinculada.");

    // 3. Renova o Access Token do Google
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: tenantConfig.google_refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error("Falha ao renovar credenciais do Google.");
    const accessToken = tokenData.access_token;

    // 4. Busca os contatos selecionados no banco
    const { data: contacts } = await supabase
      .from("google_contacts")
      .select("*")
      .in("id", contact_ids)
      .eq("tenant_id", tenantId);

    if (!contacts || contacts.length === 0) {
      return NextResponse.json({ error: "Contatos não encontrados no banco." }, { status: 404 });
    }

    let successCount = 0;
    let errors: string[] = [];

    // 5. Loop de atualização contato por contato
    for (const contact of contacts) {
      try {
        let hasChanges = false;
        let updatedPhones = contact.phones ? [...contact.phones] : [];

        // Verifica os telefones do contato
        for (let i = 0; i < updatedPhones.length; i++) {
          const phone = updatedPhones[i];
          const digits = onlyDigits(phone.value);

          // 🧠 Lógica robusta de inferência
          const rawValue = phone.value || "";
          let ddi = "55";
          let national = digits;

          // Se tiver um "+" na frente ou for muito longo, inferimos o DDI real
          if (rawValue.trim().startsWith("+") || digits.length > 11) {
            ddi = inferDDI(digits);
            national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
          }

          if (ddi === "55") {
            // Limpa o zero inicial caso o contato esteja salvo como (021)
            if (national.startsWith("0")) national = national.slice(1);

            // Verifica se tem o tamanho correto (DDD + 8 ou 9 dígitos)
            if (national.length >= 10 && national.length <= 11) {
              const fullDigits = `55${national}`;
              const operadoraName = await consultarOperadoraExterna(fullDigits);
              
              if (operadoraName) {
                if (phone.label !== operadoraName) {
                  updatedPhones[i].label = operadoraName;
                  hasChanges = true;
                }
              } else {
                // AVISA O TOAST QUE DEU ERRO NESSE NÚMERO
                throw new Error(`Falha na Telein (Número: ${fullDigits})`);
              }
            }
          } else {
            // Internacional
            const countryLabel = DDI_OPTIONS.find(o => o.code === ddi)?.label || "Internacional";
            if (phone.label !== countryLabel) {
              updatedPhones[i].label = countryLabel;
              hasChanges = true;
            }
          }
        }

        // 6. Se teve mudança, envia pro Google e pro Banco
        if (hasChanges) {
          // Pega o ETag atualizado no Google (Obrigatório para fazer PATCH)
          const getPersonRes = await fetch(`https://people.googleapis.com/v1/${contact.google_resource_name}?personFields=metadata,phoneNumbers`, { 
            headers: { Authorization: `Bearer ${accessToken}` } 
          });
          const personCurrentData = await getPersonRes.json();
          if (!getPersonRes.ok) throw new Error(`Google ETag falhou para ${contact.display_name}`);

          // Monta o payload só com os telefones (O Google substitui a lista inteira)
          const googlePayload = {
            etag: personCurrentData.etag,
            phoneNumbers: updatedPhones.map((p: any) => ({ 
              value: p.value, 
              ...getGoogleLabel(p.label, "mobile") 
            }))
          };

          // Salva no Google
          const updateRes = await fetch(`https://people.googleapis.com/v1/${contact.google_resource_name}:updateContact?updatePersonFields=phoneNumbers`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(googlePayload),
          });
          
          if (!updateRes.ok) throw new Error(`Falha no Google API para ${contact.display_name}`);

          // Salva no Supabase
          await supabase
            .from("google_contacts")
            .update({ 
              phones: updatedPhones,
              synced_at: new Date().toISOString()
            })
            .eq("id", contact.id);

          successCount++;
        }

      } catch (err: any) {
        errors.push(`${contact.display_name}: ${err.message}`);
      }
      
      // Delay pequeno entre contatos para não estourar rate limit da API da Operadora e do Google
      await new Promise(r => setTimeout(r, 300));
    }

    return NextResponse.json({ 
      success: true, 
      message: `${successCount} contatos atualizados.`, 
      errors 
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}