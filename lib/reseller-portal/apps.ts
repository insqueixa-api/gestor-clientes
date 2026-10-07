// lib/reseller-portal/apps.ts
// ✅ 07/10/2026 (redesenho, pedido do Márcio): "Gerenciar clientes e
// aplicativos" do Portal da Revenda. Mesmo motor das automações dos clientes
// (handlers de lib/integrations via rotas internas /api/integrations/apps/*).
// Regras:
//   - a revenda só configura app pra CLIENTE DELA num servidor seu
//     (reseller_end_clients, espelho do painel). O M3U é montado AQUI no
//     servidor com a regra principal/secundária (lib/apps/m3u-lists.ts) — a
//     revenda nunca vê o link, a senha nem as DNS;
//   - "Adicionar aplicativo": apps com configuração automática pelo servidor
//     (família GerenciaApp sem "GPC Computador"); GerenciaApp é GRÁTIS mas
//     limitado a resellers.gerenciaapp_limit aparelhos (padrão 10);
//   - "Ativar aplicativo": apps com renovação automática paga (AtivaApp,
//     DupleCast), preço do sistema; disponibilidade = mesma janela do portal
//     do cliente (vencido, sem data ou faltando até 7 dias AtivaApp / 30 demais);
//   - nome da lista: <usuario>_<Servidor>; Configurar só apaga a lista de
//     mesmo nome exato (exact_only), nunca as outras.
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
import { hasAutoRenewal } from "@/lib/apps/auto-renewal";
import { APP_FIELD_LABELS, HIDDEN_CLIENT_FIELD_TYPES, normalizeMacInput, type AppFieldType } from "@/lib/apps/field-types";
import { rotatePrincipalM3u, rotateSecondaryM3u, type M3uList } from "@/lib/apps/m3u-lists";
import type { AppFieldConfig, IntegrationHandler, PartnerApiResponse } from "@/lib/apps/types";

export const DEFAULT_GERENCIAAPP_LIMIT = 10;

const str = (v: unknown) => String(v ?? "").trim();

/** Campos que a revenda preenche (sem data e sem Ambiente — Ambiente é coluna própria, opcional). */
export function editableFields(app: any): { id: string; type: string; label: string }[] {
  return (Array.isArray(app?.fields_config) ? app.fields_config : [])
    .filter((f: any) => f && f.id && f.type !== "date" && f.type !== "obs" && !HIDDEN_CLIENT_FIELD_TYPES.includes(f.type as AppFieldType))
    .map((f: any) => ({
      id: String(f.id),
      type: String(f.type || ""),
      label: String(String(f.label || "").trim() || APP_FIELD_LABELS[f.type as AppFieldType] || f.id),
    }));
}

/** Só os campos do app, todos obrigatórios. */
export function readFieldValues(app: any, input: unknown): { values: Record<string, string> } | { error: string } {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const f of editableFields(app)) {
    const v = f.type === "mac" ? normalizeMacInput(str(src[f.id])) : str(src[f.id]).slice(0, 200);
    if (!v) return { error: `Preencha o ${f.label}.` };
    values[f.id] = v;
  }
  return { values };
}

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

/** Consigo ler o vencimento do aparelho só com os campos (sem lista)? */
export function canCheckByDevice(app: any) {
  const h = resolveHandlerFor(app);
  return !!h && CHECK_VALIDITY_HANDLERS.has(h.actionPrefix) && h.actionPrefix !== "GERENCIAAPP";
}

function baseCatalogOk(app: any) {
  return !!app && !app.is_hidden && app.is_active !== false && app.cost_type !== "partnership";
}

/** "Adicionar aplicativo": configuração automática pelo servidor. */
export function isAddableApp(app: any) {
  if (!baseCatalogOk(app) || !canConfigureResellerApp(app)) return false;
  if (isGerenciaAppFamily(app)) return !/computador/i.test(String(app.name || ""));
  return true;
}

/** Preço anual da licença (BRL, preço do sistema) — null = sem cobrança. */
export function resellerLicensePrice(app: any): number | null {
  const p = Number(app?.license_price);
  return app?.cost_type === "paid" && p > 0 ? p : null;
}

/** "Ativar aplicativo": renovação automática PAGA (GerenciaApp é grátis → fora). */
export function isActivatableApp(app: any) {
  return baseCatalogOk(app) && hasAutoRenewal(app) && !isGerenciaAppFamily(app) && resellerLicensePrice(app) != null;
}

/** Mesma janela do Renovar do portal do cliente (RenewClient). */
export function activationWindowDays(app: any) {
  return app?.appativa_app_id ? 7 : 30;
}

/** null = disponível agora; senão a data (ISO) em que a ativação libera. */
export function activationAvailableFrom(app: any, expireDate: string | null): string | null {
  if (!expireDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expireDate);
  if (!m) return null;
  if (m[1] === "9999") return "9999-12-31";
  const exp = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const from = exp - activationWindowDays(app) * 86400000;
  return Date.now() >= from ? null : new Date(from).toISOString().slice(0, 10);
}

/** Monta o M3U do cliente da revenda (só no servidor — nunca vai pro navegador). */
export async function buildResellerM3u(
  admin: SupabaseClient,
  endClient: { server_id: string; username: string; password: string | null },
  list: M3uList,
): Promise<{ url: string; serverName: string } | null> {
  if (!endClient.password) return null;
  const { data: server } = await admin.from("servers").select("name, dns").eq("id", endClient.server_id).maybeSingle();
  if (!server) return null;
  const dnsList = Array.isArray(server.dns) ? (server.dns as string[]) : [];
  const params = { dnsList, username: endClient.username, password: endClient.password, serverName: server.name };
  const url = list === "secundaria" ? rotateSecondaryM3u(params) : rotatePrincipalM3u(params);
  return url ? { url, serverName: String(server.name || "Servidor") } : null;
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

export type PartnerCtx = {
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
  if (!s.username) return { ok: false as const, error: "Informe o link M3U do cliente (Editar dados) pra configurar." };

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
  // GerenciaApp consulta pelo nome da lista (<usuario>_<Servidor>) — sem M3U não dá
  if (s.handler.actionPrefix === "GERENCIAAPP" && !s.username)
    return { ok: false as const, error: "Informe o link M3U do cliente (Editar dados) pra verificar esse aplicativo." };
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

/** GerenciaApp: renovação grátis da licença (mesma chamada do portal do cliente). */
export async function renewGerenciaAppFree(
  admin: SupabaseClient,
  app: { name: string; integration_type: string | null; fields_config: AppFieldConfig[] | null },
  fieldValues: Record<string, string>,
) {
  const handler = resolveHandlerFor(app);
  if (!handler || handler.actionPrefix !== "GERENCIAAPP") return { ok: false as const, error: "Renovação grátis só existe pra família GerenciaApp." };
  const macValue = extractFieldByType(Array.isArray(app.fields_config) ? app.fields_config : [], fieldValues, "mac");
  if (!macValue) return { ok: false as const, error: "Preencha o ID/MAC antes de renovar." };
  const { data: integ } = await admin.from("app_integrations").select("api_url").eq("app_name", "GERENCIAAPP").maybeSingle();
  const r = await post(internalAppUrl(handler.apiEndpoint || ""), String(process.env.INTERNAL_API_SECRET || ""), {
    action: "renew",
    base_url: integ?.api_url || "",
    macValue,
  });
  if (!r?.ok) return { ok: false as const, error: "Falha ao renovar a licença. Tente mais uma vez — se continuar, fale com o suporte." };
  return { ok: true as const, expireDate: r.expireDate || null };
}
