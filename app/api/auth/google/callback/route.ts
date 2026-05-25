import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Helper simples para normalizar o telefone do Google
function normalizePhone(raw: string | null | undefined) {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  // Se o usuário digitou com +, mantém. Se começa com 55, adiciona +. Se não, assume Brasil (+55).
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.startsWith("55")) return "+" + digits;
  return "+55" + digits;
}

export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");

  // Se você cancelar ou negar o acesso lá na tela do Google
  if (errorParam) return NextResponse.redirect(`${origin}/admin/agenda?error=google_auth_denied`);
  if (!code) return NextResponse.redirect(`${origin}/admin/agenda?error=no_code`);

  try {
    // 1. Validar quem é o usuário logado no UniGestor
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.redirect(`${origin}/login`);

    // Pega o seu Tenant ID
    const { data: tenantData } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!tenantData?.tenant_id) throw new Error("Tenant não encontrado");
    const tenantId = tenantData.tenant_id;

    // 2. Trocar o código secreto do Google pela "Chave de Acesso" (Access Token)
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${origin}/api/auth/google/callback`,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || "Erro ao obter token do Google");

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;

// SALVA O REFRESH TOKEN NO BANCO (Apenas se o Google enviar)
if (refreshToken) {
  // ATENÇÃO: Aqui estou assumindo que você tem uma tabela 'tenants' 
  // e vai precisar criar uma coluna 'google_refresh_token' (tipo text) nela.
  const { error: tokenErr } = await supabase
    .from("tenants")
    .update({ google_refresh_token: refreshToken })
    .eq("id", tenantId);
    
  if (tokenErr) console.error("Erro ao salvar refresh_token:", tokenErr.message);
}

    // 3. Buscar Rótulos/Grupos (Labels) que você tem no Gmail
    const groupsRes = await fetch("https://people.googleapis.com/v1/contactGroups", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const groupsData = await groupsRes.json();
    const groupMap = new Map<string, string>();
    if (groupsData.contactGroups) {
      groupsData.contactGroups.forEach((g: any) => {
        groupMap.set(g.resourceName, g.name || g.formattedName);
      });
    }

    // 4. Buscar Contatos (Até 1.000 contatos de uma vez)
    const contactsRes = await fetch(
      "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,photos,birthdays,memberships&pageSize=1000",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const contactsData = await contactsRes.json();
    const connections = contactsData.connections || [];

    // 5. Mapear, Limpar e Preparar os dados para o seu Banco de Dados
    const recordsToInsert = connections.map((person: any) => {
      const rawPhone = person.phoneNumbers?.[0]?.value || null;
      
      // Traduz os IDs dos rótulos para os nomes reais (ex: "Clientes VIP")
      const labels: string[] = [];
      if (person.memberships) {
        person.memberships.forEach((m: any) => {
          const groupId = m.contactGroupMembership?.contactGroupResourceName;
          if (groupId && groupMap.has(groupId)) {
            labels.push(groupMap.get(groupId)!);
          }
        });
      }

      // Trata o Aniversário
      let birthdayText = person.birthdays?.[0]?.text || null;
      if (!birthdayText && person.birthdays?.[0]?.date) {
        const d = person.birthdays[0].date;
        birthdayText = `${d.year ? d.year + '-' : '--'}${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
      }

      return {
        tenant_id: tenantId,
        google_resource_name: person.resourceName,
        display_name: person.names?.[0]?.displayName || "Sem Nome",
        email: person.emailAddresses?.[0]?.value || null,
        phone_raw: rawPhone,
        phone_e164: normalizePhone(rawPhone),
        avatar_url: person.photos?.[0]?.url || null,
        birthday: birthdayText,
        labels: labels,
        synced_at: new Date().toISOString()
      };
    });

    // 6. Salvar TUDO no Supabase de uma vez (Se o contato já existir, ele atualiza!)
    if (recordsToInsert.length > 0) {
      const { error: dbErr } = await supabase
        .from("google_contacts")
        .upsert(recordsToInsert, { onConflict: "tenant_id, google_resource_name" });
      
      if (dbErr) throw new Error("Erro ao salvar no banco: " + dbErr.message);
    }

    // 7. Sucesso! Redireciona você de volta para a tela de agenda
    return NextResponse.redirect(`${origin}/admin/agenda?sync=success&count=${recordsToInsert.length}`);

  } catch (err: any) {
    console.error("Erro no Callback do Google:", err);
    // HACK DE PRODUÇÃO: Manda a mensagem de erro real direto para a URL
    return NextResponse.redirect(`${origin}/admin/agenda?error=${encodeURIComponent(err.message)}`);
  }
}