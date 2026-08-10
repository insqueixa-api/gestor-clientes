// app/api/whatsapp/contact-photo/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminTenantContext } from "@/lib/api/auth-server";
import { syncContactPhotoFromWhatsApp } from "@/lib/whatsapp/sync-contact-photo";

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
  const ctx = await getAdminTenantContext();
  if (!ctx.ok) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const tenantId = ctx.tenantId;
  const supabase = await createClient();

  const { contact_id, jid } = await req.json();
  if (!contact_id || !jid) return NextResponse.json({ error: "contact_id e jid são obrigatórios." }, { status: 400 });

  const result = await syncContactPhotoFromWhatsApp(supabase, tenantId, contact_id, jid);
  if (result.ok === false) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ success: true, avatar_url: result.avatar_url });
}
