import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Formata o telefone apenas com dígitos para enviar para a API de consulta
function onlyDigits(raw: string | null | undefined) {
  if (!raw) return "";
  return raw.replace(/\D+/g, "");
}

// 🪄 TRADUTOR DE LABELS PARA O GOOGLE (Mesmo das outras rotas)
function getGoogleLabel(label: string, defaultType: string) {
  if (!label) return { type: defaultType };
  const low = label.toLowerCase();
  if (["casa", "home"].includes(low)) return { type: "home" };
  if (["trabalho", "work", "empresa"].includes(low)) return { type: "work" };
  if (["celular", "mobile"].includes(low)) return { type: "mobile" };
  if (["pessoal", "other", "outro"].includes(low)) return { type: "other" };
  return { type: label }; // Aceita o nome da operadora direto
}

// 📡 INTEGRAÇÃO COM A API DE PORTABILIDADE/OPERADORA
async function consultarOperadoraExterna(phoneDigits: string): Promise<string | null> {
  try {
    // ⚠️ ATENÇÃO: Substitua este bloco pela chamada real da sua API de operadora (Telein, etc.)
    // Exemplo genérico:
    /*
    const res = await fetch(`https://api.sua-consulta.com.br/v1/numero/${phoneDigits}`, {
      headers: { "Authorization": "Bearer SEU_TOKEN_AQUI" }
    });
    const data = await res.json();
    if (data && data.operadora) {
      return data.operadora; // Ex: "Vivo", "Claro", "Tim"
    }
    */

    // MOCK TEMPORÁRIO PARA TESTES (Simula uma resposta baseada no final do número)
    // Remova isso quando plugar sua API real!
    const lastDigit = phoneDigits.slice(-1);
    if (["1", "2", "3"].includes(lastDigit)) return "Vivo";
    if (["4", "5", "6"].includes(lastDigit)) return "Claro";
    if (["7", "8", "9"].includes(lastDigit)) return "Tim";
    return "Oi";

  } catch (error) {
    console.error("Erro ao consultar operadora:", error);
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

          // Verifica se é um número do Brasil válido para consulta (DDI 55 + DDD + Numero)
          if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
            
            // Faz a consulta na API da Operadora
            const operadoraName = await consultarOperadoraExterna(digits);

            // Se achou uma operadora e ela for diferente do label atual, atualiza!
            if (operadoraName && phone.label !== operadoraName) {
              updatedPhones[i].label = operadoraName;
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
    console.error("Erro na sync de operadora:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}