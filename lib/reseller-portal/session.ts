// lib/reseller-portal/session.ts
// ✅ 06/10/2026: link mágico + sessão do Portal da Revenda
// (docs/sql/reseller_portal.sql, docs/revenda-portal/PLANO.md fase 2).
// Tabelas próprias (reseller_portal_tokens/sessions) — nada aqui toca o
// fluxo do cliente (client_portal_tokens/sessions).
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const SESSION_TTL_MS = 30 * 60 * 1000; // mesma janela deslizante do portal do cliente

export function newPortalSecret() {
  // 32 caracteres [A-Za-z0-9_-] — passa no isPlausibleToken do login
  return randomBytes(24).toString("base64url");
}

export function resellerPortalUrl(token: string) {
  const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://unigestor.net.br").replace(/\/+$/, "");
  return `${appUrl}/#t=${encodeURIComponent(token)}`;
}

async function loadReseller(sb: SupabaseClient, tenantId: string, resellerId: string) {
  const { data } = await sb
    .from("resellers")
    .select("id, tenant_id, display_name, is_archived, portal_disabled_at")
    .eq("id", resellerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data as { id: string; tenant_id: string; display_name: string | null; is_archived: boolean; portal_disabled_at: string | null } | null;
}

/** Link ativo da revenda (cria se não houver). null = revenda arquivada/desvinculada/inexistente. */
export async function getOrCreateResellerPortalToken(
  sb: SupabaseClient,
  params: { tenantId: string; resellerId: string; createdBy?: string | null; label?: string },
): Promise<string | null> {
  const r = await loadReseller(sb, params.tenantId, params.resellerId);
  if (!r || r.is_archived || r.portal_disabled_at) return null;

  const { data: existing } = await sb
    .from("reseller_portal_tokens")
    .select("token")
    .eq("reseller_id", r.id)
    .eq("is_active", true)
    .maybeSingle();
  if (existing?.token) return String(existing.token);

  const token = newPortalSecret();
  const { error } = await sb.from("reseller_portal_tokens").insert({
    tenant_id: r.tenant_id,
    reseller_id: r.id,
    token,
    label: params.label || null,
    created_by: params.createdBy || null,
  });
  if (error) {
    // corrida (outro envio criou ao mesmo tempo — índice de 1 ativo): usa o que ficou
    const { data: again } = await sb
      .from("reseller_portal_tokens")
      .select("token")
      .eq("reseller_id", r.id)
      .eq("is_active", true)
      .maybeSingle();
    return again?.token ? String(again.token) : null;
  }
  return token;
}

/** Desativa o link atual e derruba as sessões abertas. */
export async function revokeResellerPortalAccess(sb: SupabaseClient, tenantId: string, resellerId: string) {
  await sb.from("reseller_portal_tokens").update({ is_active: false }).eq("tenant_id", tenantId).eq("reseller_id", resellerId).eq("is_active", true);
  await sb.from("reseller_portal_sessions").delete().eq("tenant_id", tenantId).eq("reseller_id", resellerId);
}

async function createSession(sb: SupabaseClient, tenantId: string, resellerId: string) {
  // faxina das sessões vencidas dessa revenda
  await sb.from("reseller_portal_sessions").delete().eq("reseller_id", resellerId).lt("expires_at", new Date().toISOString());
  const session_token = newPortalSecret();
  const expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { error } = await sb.from("reseller_portal_sessions").insert({
    tenant_id: tenantId,
    reseller_id: resellerId,
    session_token,
    expires_at,
    last_seen_at: new Date().toISOString(),
  });
  if (error) return null;
  return { session_token, expires_at };
}

/** Login pelo link mágico. Só é chamado quando o token NÃO é de cliente. */
export async function startResellerSessionFromToken(sb: SupabaseClient, token: string) {
  const { data: t } = await sb
    .from("reseller_portal_tokens")
    .select("id, tenant_id, reseller_id")
    .eq("token", token)
    .eq("is_active", true)
    .maybeSingle();
  if (!t) return null;
  const r = await loadReseller(sb, t.tenant_id, t.reseller_id);
  if (!r || r.is_archived || r.portal_disabled_at) return null;
  const sess = await createSession(sb, t.tenant_id, t.reseller_id);
  if (!sess) return null;
  await sb.from("reseller_portal_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", t.id);
  return sess;
}

/** Admin "Acessar o Portal": sessão direta, sem link (mesma ideia do portal-preview do cliente). */
export async function startResellerSessionAsAdmin(sb: SupabaseClient, tenantId: string, resellerId: string) {
  const r = await loadReseller(sb, tenantId, resellerId);
  if (!r) return null;
  return createSession(sb, tenantId, resellerId);
}

export type ResellerPortalContext = { tenant_id: string; reseller_id: string };

/** Valida a sessão (e desliza a validade +30min). null = sessão inválida/vencida. */
export async function validateResellerSession(sb: SupabaseClient, sessionToken: string): Promise<ResellerPortalContext | null> {
  if (!sessionToken || sessionToken.length < 16 || sessionToken.length > 256) return null;
  if (!/^[A-Za-z0-9_\-]+$/.test(sessionToken)) return null;
  const { data: s } = await sb
    .from("reseller_portal_sessions")
    .select("id, tenant_id, reseller_id, expires_at")
    .eq("session_token", sessionToken)
    .maybeSingle();
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  const r = await loadReseller(sb, s.tenant_id, s.reseller_id);
  if (!r || r.is_archived) return null;
  await sb
    .from("reseller_portal_sessions")
    .update({ expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(), last_seen_at: new Date().toISOString() })
    .eq("id", s.id);
  return { tenant_id: s.tenant_id, reseller_id: s.reseller_id };
}

export async function endResellerSession(sb: SupabaseClient, sessionToken: string) {
  if (!sessionToken) return;
  await sb.from("reseller_portal_sessions").delete().eq("session_token", sessionToken);
}
