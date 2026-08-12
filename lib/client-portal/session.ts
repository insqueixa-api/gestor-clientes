// lib/client-portal/session.ts
// Validação de sessão + ownership do client_id, repetida em toda rota
// client-portal desde app/api/client-portal/get-prices/route.ts. Centraliza
// pra não copiar de novo em cada rota nova do Bloco 3 (add/update-fields/
// configure/remove/m3u).
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

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

// Resolve quais client_id essa sessão pode acessar — via o texto
// (whatsapp_username/secondary, comportamento de sempre) OU via a âncora de
// telefone (phone_anchor), que continua batendo mesmo quando uma das contas
// do mesmo WhatsApp trocou de identidade pra um username (ver
// docs/sql/portal_phone_anchor_hybrid_identity.sql). RPC única — evita
// reimplementar essa lógica combinada em cada rota.
async function resolveAccessibleClientIds(
  supabaseAdmin: SupabaseClient,
  tenantId: string,
  whatsappUsername: string,
  phoneAnchor: string | null,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin.rpc("portal_client_ids_for_identity", {
    p_tenant_id: tenantId,
    p_whatsapp_username: whatsappUsername,
    p_phone_anchor: phoneAnchor,
  });
  if (error || !data) return [];
  return (data as { id: string }[]).map((r) => r.id);
}

// Sessão desliza: cada chamada válida empurra expires_at +30min de novo
// (mesma janela do login, portal_start_session). Sem isso, um cliente que
// demora a navegar/pagar (ex: PIX gerado aos 20min, pago aos 35min) perdia
// a sessão no meio do fluxo — o polling de payment-status levava 401 e
// parava silenciosamente, travando a tela em "aguardando pagamento" mesmo
// que o pagamento fosse aprovado depois. Falha aberta: se o update não
// rolar por qualquer motivo, não derruba a chamada que já validou a sessão.
const SESSION_TTL_MS = 30 * 60 * 1000;

export async function touchPortalSession(supabaseAdmin: SupabaseClient, sessionToken: string) {
  try {
    await supabaseAdmin
      .from("client_portal_sessions")
      .update({
        expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .eq("session_token", sessionToken);
  } catch {
    // não bloqueia a requisição por causa disso
  }
}

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
    .select("tenant_id, whatsapp_username, phone_anchor")
    .eq("session_token", session_token)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (sessErr || !sess) return null;

  const accessibleIds = await resolveAccessibleClientIds(
    supabaseAdmin,
    sess.tenant_id,
    sess.whatsapp_username,
    (sess as any).phone_anchor ?? null,
  );
  if (!accessibleIds.includes(client_id)) return null;

  // ✅ Não bloqueia a resposta por causa disso (pedido do Márcio, 26/07/2026
  // — lentidão sentida ao carregar/adicionar apps): touchPortalSession é só
  // bookkeeping (estende expiração + last_seen), não precisa que o cliente
  // espere esse round-trip a mais antes de receber a resposta de verdade.
  // `after()` roda depois de a resposta já ter saído, mas a Vercel mantém a
  // function viva até terminar — sem risco de a sessão nunca ser tocada.
  after(() => touchPortalSession(supabaseAdmin, session_token));

  return { tenant_id: sess.tenant_id, whatsapp_username: sess.whatsapp_username, client_id };
}
