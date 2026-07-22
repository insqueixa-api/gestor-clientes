// lib/client-portal/session.ts
// Validação de sessão + ownership do client_id, repetida em toda rota
// client-portal desde app/api/client-portal/get-prices/route.ts. Centraliza
// pra não copiar de novo em cada rota nova do Bloco 3 (add/update-fields/
// configure/remove/m3u).
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function makeSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export function isPlausibleSessionToken(t: string) {
  if (t.length < 16 || t.length > 256) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

export function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export type PortalClientContext = {
  tenant_id: string;
  whatsapp_username: string;
  client_id: string;
};

// Valida session_token contra client_portal_sessions e confirma que
// client_id pertence a esse whatsapp (dono ou secundário). Retorna null em
// qualquer falha — o chamador decide a mensagem/status de erro.
export async function validatePortalClient(
  supabaseAdmin: SupabaseClient,
  session_token: string,
  client_id: string,
): Promise<PortalClientContext | null> {
  if (!session_token || !client_id) return null;
  if (!isPlausibleSessionToken(session_token)) return null;
  if (!isUuid(client_id)) return null;

  const { data: sess, error: sessErr } = await supabaseAdmin
    .from("client_portal_sessions")
    .select("tenant_id, whatsapp_username")
    .eq("session_token", session_token)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (sessErr || !sess) return null;

  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("id", client_id)
    .eq("tenant_id", sess.tenant_id)
    .or(`whatsapp_username.eq.${sess.whatsapp_username},secondary_whatsapp_username.eq.${sess.whatsapp_username}`)
    .single();

  if (clientErr || !client) return null;

  return { tenant_id: sess.tenant_id, whatsapp_username: sess.whatsapp_username, client_id };
}
