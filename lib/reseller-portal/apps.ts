// lib/reseller-portal/apps.ts
// ✅ 07/10/2026: aplicativos dos clientes DA REVENDA (reseller_client_apps).
// Mesmo motor das automações dos clientes (handlers de lib/integrations via
// rotas internas /api/integrations/apps/*), mas o link M3U e o usuário vêm do
// cadastro que a revenda faz — não de clients. Regras:
//   - catálogo: apps com integração automática (useApi) + família GerenciaApp
//     (menos "GPC Computador"); apps só-extensão (SET IPTV/ClouDDy) ficam de
//     fora (dependem do Chrome do Márcio);
//   - preço: GerenciaApp grátis → R$ 5,00/ano pra revenda; demais → preço do
//     sistema (apps.license_price);
//   - GerenciaApp só configura com licença paga (cobrança antes — etapa B);
//   - nome da lista: <usuario do M3U>_<Servidor>; Configurar só apaga a lista
//     de mesmo nome exato (exact_only), nunca as outras.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getIntegrationHandler } from "@/lib/integrations";
import {
  CHECK_VALIDITY_HANDLERS,
  PIN_HANDLERS,
  extractFieldByType,
  findFieldByType,
  internalAppUrl,
  resolveIntegrationTypeByName,
} from "@/lib/apps/panel";
import type { AppFieldConfig, IntegrationHandler, PartnerApiResponse } from "@/lib/apps/types";

export const RESELLER_GERENCIAAPP_FREE_PRICE = 5;

export function isGerenciaAppFamily(app: { integration_type?: string | null; name?: string | null }) {
  const t = String(app.integration_type || "").trim().toUpperCase() || resolveIntegrationTypeByName(String(app.name || ""));
  return t === "GERENCIAAPP";
}

export function resolveHandlerFor(app: { integration_type?: string | null; name?: string | null }): IntegrationHandler | null {
  const t = String(app.integration_type || "").trim().toUpperCase();
  let h = t ? (getIntegrationHandler(t) as IntegrationHandler | null) : null;
  if (!h) {
    const fb = resolveIntegrationTypeByName(String(app.name || ""));
    h = fb ? (getIntegrationHandler(fb) as IntegrationHandler | null) : null;
  }
  return h;
}

/** Configurar/Verificar pelo servidor? (SET IPTV/ClouDDy dependem da extensão → não) */
export function canConfigureResellerApp(app: any) {
  const h = resolveHandlerFor(app);
  return !!h && !!h.useApi;
}

/** Entra no catálogo da revenda? Automação pelo servidor, família GerenciaApp
 * (menos "GPC Computador") OU licença pela AtivaApp (SET IPTV, ClouDDy,
 * SmartOne… — entram só pra licença; Configurar fica indisponível). */
export function isResellerCatalogApp(app: any) {
  if (app?.is_hidden) return false;
  if (isGerenciaAppFamily(app)) return !/computador/i.test(String(app.name || ""));
  return canConfigureResellerApp(app) || !!app?.appativa_app_id;
}

/** Preço anual da licença pra revenda (BRL) — null = sem cobrança. */
export function resellerLicensePrice(app: any): number | null {
  if (isGerenciaAppFamily(app) && app.cost_type === "free") return RESELLER_GERENCIAAPP_FREE_PRICE;
  const p = Number(app.license_price);
  return app.cost_type === "paid" && p > 0 ? p : null;
}

/** GerenciaApp: a revenda paga antes de configurar. */
export function requiresPaymentBeforeConfigure(app: any) {
  return isGerenciaAppFamily(app);
}

export function parseM3u(url: string) {
  try {
    const u = new URL(String(url || "").trim());
    return {
      host: u.hostname.toLowerCase(),
      username: (u.searchParams.get("username") || "").trim(),
      password: (u.searchParams.get("password") || "").trim(),
    };
  } catch {
    return null;
  }
}

/** Servidor do link: pelo DNS dos servidores vinculados à revenda; senão o 1º vínculo. */
export async function detectServerForM3u(admin: SupabaseClient, tenantId: string, resellerId: string, host: string) {
  const { data: links } = await admin
    .from("reseller_servers")
    .select("server_id, servers(id, name, dns)")
    .eq("tenant_id", tenantId)
    .eq("reseller_id", resellerId);
  const servers = (links || []).map((l: any) => l.servers).filter(Boolean) as { id: string; name: string; dns: string[] | null }[];
  const hostOf = (d: string) => {
    try {
      return new URL(/^https?:\/\//i.test(d) ? d : `http://${d}`).hostname.toLowerCase();
    } catch {
      return String(d || "").toLowerCase();
    }
  };
  const byDns = servers.find((s) => (Array.isArray(s.dns) ? s.dns : []).some((d) => hostOf(d) === host));
  return byDns || servers[0] || null;
}

type PartnerCtx = {
  app: { id: string; name: string; integration_type: string | null; fields_config: AppFieldConfig[] | null };
  fieldValues: Record<string, string>;
  m3uUrl: string;
  serverName: string;
  serverId: string | null;
};

async function partnerSetup(admin: SupabaseClient, ctx: PartnerCtx) {
  const handler = resolveHandlerFor(ctx.app);
  if (!handler || !handler.useApi) throw new Error("Esse aplicativo não tem integração automática.");
  const fields = Array.isArray(ctx.app.fields_config) ? ctx.app.fields_config : [];
  const macValue = extractFieldByType(fields, ctx.fieldValues, "mac");
  const deviceKey = extractFieldByType(fields, ctx.fieldValues, "device_key");
  const m3u = parseM3u(ctx.m3uUrl);
  const username = m3u?.username || "";
  const serverNameClean = String(ctx.serverName || "Servidor").replace(/\s+/g, "");
  const listName = `${username}_${serverNameClean}`;
  const integrationType = String(ctx.app.integration_type || "").trim().toUpperCase() || resolveIntegrationTypeByName(ctx.app.name);
  const { data: integ } = await admin.from("app_integrations").select("api_url, pin").eq("app_name", integrationType).maybeSingle();
  const password = PIN_HANDLERS.has(handler.actionPrefix) ? integ?.pin || "" : m3u?.password || "";
  return {
    handler,
    fields,
    macValue,
    deviceKey,
    username,
    serverNameClean,
    listName,
    integ,
    password,
    url: internalAppUrl(handler.apiEndpoint || ""),
    secret: String(process.env.INTERNAL_API_SECRET || ""),
  };
}

async function post(url: string, secret: string, body: Record<string, unknown>): Promise<PartnerApiResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify(body),
  });
  return (await res.json().catch(() => ({} as PartnerApiResponse))) as PartnerApiResponse;
}

/** Configura a lista no parceiro (apaga só a de mesmo nome exato antes). */
export async function configureResellerApp(admin: SupabaseClient, ctx: PartnerCtx) {
  const s = await partnerSetup(admin, ctx);
  if (!s.macValue) return { ok: false as const, error: "Preencha o ID/MAC antes de configurar." };
  if (!s.username) return { ok: false as const, error: "O link M3U precisa ter username=… e password=…" };

  if (s.handler.actionPrefix !== "DUPLEXTV") {
    try {
      const del = s.handler.buildDeletePayload({
        username: s.username,
        finalServerName: s.listName,
        serverName: s.serverNameClean,
        macValue: s.macValue,
        appName: ctx.app.name,
        password: s.password,
      });
      await post(s.url, s.secret, { ...del, base_url: s.integ?.api_url || "", deviceKey: s.deviceKey, exact_only: true });
    } catch {
      // best-effort
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = s.handler.buildCreatePayload({
      username: s.username,
      password: s.password,
      macValue: s.macValue,
      finalServerName: s.listName,
      serverName: s.serverNameClean,
      m3uUrl: ctx.m3uUrl,
      appName: ctx.app.name,
      serverId: ctx.serverId || undefined,
      appId: ctx.app.id,
    }) as Record<string, unknown>;
  } catch (e: any) {
    return { ok: false as const, error: e?.message || "Não foi possível montar a configuração para este app." };
  }
  const r = await post(s.url, s.secret, { ...payload, base_url: s.integ?.api_url || "", deviceKey: s.deviceKey });
  if (!r?.ok) return { ok: false as const, error: r?.error || "Falha ao configurar no painel do parceiro." };
  return { ok: true as const, listName: s.listName, expireDate: r.expireDate || null, isTrial: !!r.isTrial, message: r.message || "Configurado." };
}

/** Consulta o vencimento no parceiro (só leitura). */
export async function checkResellerApp(admin: SupabaseClient, ctx: PartnerCtx) {
  const s = await partnerSetup(admin, ctx);
  if (!CHECK_VALIDITY_HANDLERS.has(s.handler.actionPrefix)) return { ok: false as const, error: "Verificação de validade não disponível para este aplicativo." };
  if (!s.macValue) return { ok: false as const, error: "Preencha o ID/MAC antes de verificar." };
  const r = await post(s.url, s.secret, {
    action: "check",
    macValue: s.macValue,
    mac: s.macValue,
    mac_address: s.macValue,
    username: s.handler.actionPrefix === "GERENCIAAPP" ? s.listName : "",
    deviceKey: s.deviceKey,
    app_name: ctx.app.name,
    base_url: s.integ?.api_url || "",
  });
  if (!r?.ok) return { ok: false as const, error: r?.error || "Falha ao consultar o painel do parceiro." };
  return { ok: true as const, expireDate: r.expireDate || null, isTrial: !!r.isTrial };
}

/** Tira a lista deste cliente do parceiro (só nome exato). */
export async function removeResellerAppFromPartner(admin: SupabaseClient, ctx: PartnerCtx) {
  const s = await partnerSetup(admin, ctx);
  if (!s.macValue || !s.username) return { ok: true as const, skipped: true };
  if (s.handler.actionPrefix === "DUPLEXTV") {
    // o parceiro só sabe apagar TODAS as listas do MAC — não mexe
    return { ok: true as const, skipped: true };
  }
  const del = s.handler.buildDeletePayload({
    username: s.username,
    finalServerName: s.listName,
    serverName: s.serverNameClean,
    macValue: s.macValue,
    appName: ctx.app.name,
    password: s.password,
  });
  const r = await post(s.url, s.secret, { ...del, base_url: s.integ?.api_url || "", deviceKey: s.deviceKey, exact_only: true });
  return r?.ok ? { ok: true as const } : { ok: false as const, error: r?.error || "Falha ao remover do parceiro." };
}

export { findFieldByType };
