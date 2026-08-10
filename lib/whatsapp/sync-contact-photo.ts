// lib/whatsapp/sync-contact-photo.ts
// ─────────────────────────────────────────────────────────────────────────────
// ✅ Extraído de app/api/whatsapp/contact-photo/route.ts (08/08/2026) pra
// poder ser reaproveitado também pelo Monitor do Bot (events/route.ts), sem
// duplicar a lógica de "buscar no WhatsApp → subir pro Google → atualizar
// avatar_url". Só busca no WhatsApp quando o contato JÁ existe na Agenda
// (tem google_resource_name) — nunca cria contato novo nem busca foto de
// quem não está lá, pra não virar um scraper de números aleatórios (achado
// em auditoria de risco de banimento, 09/08/2026: coleta automatizada de
// fotos de perfil em massa é um dos motivos que a Meta cita pra banir conta).
// ─────────────────────────────────────────────────────────────────────────────

import { getWAContext } from "@/lib/whatsapp/wa-context";

export type SyncPhotoResult =
  | { ok: true; avatar_url: string }
  | { ok: false; error: string };

async function fetchPhotoFromSession(
  ctx: { baseUrl: string; headers: Record<string, string> },
  jid: string,
): Promise<{ url: string | null; status: number; body: string }> {
  const res = await fetch(`${ctx.baseUrl}/profile-picture?jid=${encodeURIComponent(jid)}`, { headers: ctx.headers });
  const text = await res.text();
  if (!res.ok) return { url: null, status: res.status, body: text };
  try {
    const data = JSON.parse(text);
    return { url: (data?.url ?? null) as string | null, status: res.status, body: text };
  } catch {
    return { url: null, status: res.status, body: text };
  }
}

/**
 * Busca a foto de perfil do WhatsApp de um contato pelo JID, sobe pro Google
 * Contact correspondente e atualiza `avatar_url` local. Exige que o contato
 * JÁ tenha `google_resource_name` (ou seja, já veio de uma importação da
 * Agenda) — não cria nada novo no Google.
 */
export async function syncContactPhotoFromWhatsApp(
  sb: any,
  tenantId: string,
  contactId: string,
  jid: string,
): Promise<SyncPhotoResult> {
  try {
    const { data: tenantConfig } = await sb.from("tenants").select("google_refresh_token").eq("id", tenantId).single();
    if (!tenantConfig?.google_refresh_token) return { ok: false, error: "Conta do Google não vinculada." };

    const waCtx1 = await getWAContext(1);
    if (!waCtx1) return { ok: false, error: "Sessão do WhatsApp não configurada." };

    let picResult = await fetchPhotoFromSession(waCtx1, jid);
    if (!picResult.url) {
      const waCtx2 = await getWAContext(2);
      if (waCtx2) picResult = await fetchPhotoFromSession(waCtx2, jid);
    }

    const photoUrl = picResult.url;
    if (!photoUrl) return { ok: false, error: "Foto não disponível ou protegida." };

    const imgRes = await fetch(photoUrl);
    if (!imgRes.ok) return { ok: false, error: "Falha ao baixar a imagem do WhatsApp." };
    const imgBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(imgBuffer).toString("base64");

    const { data: contact } = await sb
      .from("google_contacts")
      .select("google_resource_name, avatar_url")
      .eq("id", contactId)
      .eq("tenant_id", tenantId)
      .single();
    if (!contact?.google_resource_name) return { ok: false, error: "Contato não encontrado na Agenda." };

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
    if (!tokenRes.ok) return { ok: false, error: "Falha ao renovar credenciais Google." };
    const accessToken = tokenData.access_token;

    const uploadRes = await fetch(`https://people.googleapis.com/v1/${contact.google_resource_name}:updateContactPhoto`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ photoBytes: base64 }),
    });
    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      return { ok: false, error: `Google API: ${err?.error?.message ?? "Erro ao enviar foto."}` };
    }

    let finalAvatarUrl: string = contact.avatar_url || photoUrl;
    const freshRes = await fetch(`https://people.googleapis.com/v1/${contact.google_resource_name}?personFields=photos`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (freshRes.ok) {
      const freshData = await freshRes.json();
      if (freshData.photos?.[0]?.url) finalAvatarUrl = freshData.photos[0].url;
    }

    await sb.from("google_contacts").update({ avatar_url: finalAvatarUrl, synced_at: new Date().toISOString() }).eq("id", contactId).eq("tenant_id", tenantId);

    return { ok: true, avatar_url: finalAvatarUrl };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Erro desconhecido" };
  }
}
