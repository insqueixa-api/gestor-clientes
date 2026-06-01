import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/whatsapp/contact-photo
 *
 * Busca a foto de perfil do WhatsApp de um contato pelo JID,
 * faz upload para o Google Contact e atualiza o avatar_url local.
 *
 * Body: { contact_id: string, jid: string }
 *
 * ⚠️  Requer na VM (DigitalOcean):
 *      GET /whatsapp/profile-picture?jid=XXXXXXX@s.whatsapp.net
 *      → { url: "https://pps.whatsapp.net/v/..." } | { error: "não disponível" }
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const { contact_id, jid } = await req.json();
    if (!contact_id || !jid) return NextResponse.json({ error: "contact_id e jid são obrigatórios." }, { status: 400 });

    // Carrega o tenant e o refresh_token do Google
    const { data: tenantData } = await supabase.from("tenant_members").select("tenant_id").eq("user_id", user.id).limit(1).single();
    const tenantId = tenantData?.tenant_id;

    const { data: tenantConfig } = await supabase.from("tenants").select("google_refresh_token").eq("id", tenantId).single();
    if (!tenantConfig?.google_refresh_token) throw new Error("Conta do Google não vinculada.");

    // 1. Busca foto na VM WhatsApp
    const VM_BASE = process.env.UNIGESTOR_WA_BASE_URL ?? "";
const picRes = await fetch(`${VM_BASE}/profile-picture?jid=${encodeURIComponent(jid)}`, {
  headers: {
    "Authorization": `Bearer ${process.env.UNIGESTOR_WA_TOKEN ?? ""}`,
    "x-session-key": process.env.UNIGESTOR_WA_SESSION_KEY ?? "75d06e80",

  },
});

    const picText = await picRes.text();

if (!picRes.ok) {
  return NextResponse.json({ error: "Foto não disponível ou protegida.", vm_status: picRes.status, vm_body: picText }, { status: 404 });
}

const picData = JSON.parse(picText);
const photoUrl: string | null = picData?.url ?? null;
if (!photoUrl) return NextResponse.json({ error: "Foto protegida.", vm_response: picData }, { status: 404 });

    // 2. Baixa a imagem e converte para base64
    const imgRes = await fetch(photoUrl);
    if (!imgRes.ok) throw new Error("Falha ao baixar a imagem do WhatsApp.");
    const imgBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(imgBuffer).toString("base64");
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";

    // 3. Busca o google_resource_name do contato
    const { data: contact } = await supabase
      .from("google_contacts")
      .select("google_resource_name, avatar_url")
      .eq("id", contact_id)
      .eq("tenant_id", tenantId)
      .single();

    if (!contact?.google_resource_name) throw new Error("Contato não encontrado.");

    // 4. Renova o access_token do Google
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
    if (!tokenRes.ok) throw new Error("Falha ao renovar credenciais Google.");
    const accessToken = tokenData.access_token;

    // 5. Envia foto para o Google People API
    const uploadRes = await fetch(`https://people.googleapis.com/v1/${contact.google_resource_name}:updateContactPhoto`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ photoBytes: base64 }),
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json();
      throw new Error(`Google API: ${err.error?.message ?? "Erro ao enviar foto."}`);
    }

    // 6. Busca a URL pública da foto recém-enviada
    const freshRes = await fetch(`https://people.googleapis.com/v1/${contact.google_resource_name}?personFields=photos`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    let finalAvatarUrl = contact.avatar_url;
    if (freshRes.ok) {
      const freshData = await freshRes.json();
      if (freshData.photos?.[0]?.url) finalAvatarUrl = freshData.photos[0].url;
    }

    // 7. Atualiza o banco local
    await supabase.from("google_contacts").update({ avatar_url: finalAvatarUrl, synced_at: new Date().toISOString() }).eq("id", contact_id).eq("tenant_id", tenantId);

    return NextResponse.json({ success: true, avatar_url: finalAvatarUrl });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
