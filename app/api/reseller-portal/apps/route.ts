// app/api/reseller-portal/apps/route.ts
// ✅ 07/10/2026 (redesenho, pedido do Márcio): "Gerenciar clientes e
// aplicativos" do Portal da Revenda. Ações:
//   dashboard       → sincroniza o painel (clientes da revenda) e devolve o
//                     resumo, a lista de clientes (seletor) e os apps já
//                     configurados pelo portal, agrupados por cliente
//   catalog         → mode "add" (configuração automática) | "activate"
//                     (renovação automática paga) — formato do AppPickerModal
//   configure_new   → cliente DELA + app + campos → monta o M3U no servidor
//                     (lista principal), configura, salva e lê o vencimento
//   update          → edita campos/Ambiente e reconfigura
//   configure       → Reconfigurar (alterna principal ↔ secundária)
//   check           → vencimento no parceiro
//   remove          → tira a lista do aparelho (só nome exato) e apaga
//   renew_free      → GerenciaApp: renovação grátis dentro da janela
//   activate_check  → "Ativar aplicativo": a ativação está disponível?
// A senha do cliente e o link M3U NUNCA saem daqui (nem as DNS).
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateResellerSession } from "@/lib/reseller-portal/session";
import { syncResellerPanels } from "@/lib/reseller-portal/sync";
import { effectiveIcon, effectiveTier } from "@/lib/apps/appativa-catalog";
import { formatLicenca, renderAppDescription } from "@/lib/apps/license-text";
import { withoutLegacyDevices } from "@/lib/apps/device-types";
import { resolveDownloadHint, withDownloadLogo } from "@/lib/apps/download-info";
import { hasAutoRenewal } from "@/lib/apps/auto-renewal";
import { CHECK_VALIDITY_HANDLERS } from "@/lib/apps/panel";
import type { M3uList } from "@/lib/apps/m3u-lists";
import {
  DEFAULT_GERENCIAAPP_LIMIT,
  activationAvailableFrom,
  activationWindowDays,
  buildResellerM3u,
  canCheckByDevice,
  canConfigureResellerApp,
  checkResellerApp,
  configureResellerApp,
  isActivatableApp,
  isAddableApp,
  isGerenciaAppFamily,
  removeResellerAppFromPartner,
  renewGerenciaAppFree,
  resellerLicensePrice,
  editableFields,
  readFieldValues,
  resolveHandlerFor,
  type PartnerCtx,
} from "@/lib/reseller-portal/apps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_COLS =
  "id, name, icon_url, technology, device_types, integration_type, cost_type, license_price, license_period, is_active, is_hidden, appativa_app_id, appativa_meta, tier, portal_setup_instructions, fields_config, download_info";
const ROW_COLS =
  "id, end_client_id, app_id, device_type, field_values, obs, list_name, m3u_list, configured_at, expire_date, created_at, apps(" + APP_COLS + ")";
// password só é lida pra montar o M3U aqui dentro — shapeClient nunca a devolve
const CLIENT_COLS = "id, username, password, server_id, expires_at, status, blocked, missing_since, servers(name)";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}
const s = (v: unknown) => String(v ?? "").trim();
const ok = (data: Record<string, unknown>) => NextResponse.json({ ok: true, ...data }, { headers: NO_STORE });

function isoDate(d: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s(d));
  return m ? m[1] : null;
}

function renewInfo(app: any, expireDate: string | null) {
  if (!hasAutoRenewal(app)) return { kind: null, available_from: null };
  return { kind: isGerenciaAppFamily(app) ? "free" : "paid", available_from: activationAvailableFrom(app, expireDate) };
}

function shapeRow(r: any) {
  const a = r.apps || {};
  const fv = r.field_values || {};
  const expire = isoDate(r.expire_date);
  const h = resolveHandlerFor(a);
  return {
    id: r.id,
    end_client_id: r.end_client_id,
    app: { id: a.id, name: a.name, icon_url: effectiveIcon({ icon_url: a.icon_url, appativa_app_id: a.appativa_app_id, appativa_meta: a.appativa_meta }) },
    device_type: r.device_type,
    fields: editableFields(a).map((f) => ({ ...f, value: s(fv[f.id]) })),
    obs: r.obs || "",
    expire_date: expire,
    list_name: r.list_name,
    m3u_list: r.m3u_list,
    configured_at: r.configured_at,
    can_check: !!h && CHECK_VALIDITY_HANDLERS.has(h.actionPrefix),
    license_price: resellerLicensePrice(a),
    tier: effectiveTier({ tier: a.tier, appativa_app_id: a.appativa_app_id, appativa_meta: a.appativa_meta }).value,
    renew: renewInfo(a, expire),
  };
}

function shapeClient(c: any) {
  return {
    id: c.id,
    username: c.username,
    server_name: c.servers?.name || null,
    expires_at: c.expires_at,
    status: c.status,
    blocked: !!c.blocked,
  };
}

function catalogItem(a: any, logos: any, mode: "add" | "activate") {
  const price = resellerLicensePrice(a);
  const devices = withoutLegacyDevices(a.device_types);
  return {
    id: a.id,
    name: a.name,
    icon_url: effectiveIcon({ icon_url: a.icon_url, appativa_app_id: a.appativa_app_id, appativa_meta: a.appativa_meta }),
    device_types: devices,
    tier: effectiveTier({ tier: a.tier, appativa_app_id: a.appativa_app_id, appativa_meta: a.appativa_meta }).value,
    description: renderAppDescription(a.portal_setup_instructions, formatLicenca(price, "BRL", price ? "annual" : null)),
    downloads: Object.fromEntries(devices.map((dt: string) => [dt, withDownloadLogo(resolveDownloadHint(a, dt), logos)])),
    cost_type: price ? "paid" : a.cost_type || null,
    license_price: price,
    license_price_display: price,
    license_price_display_currency: price ? "BRL" : null,
    license_period: price ? "annual" : null,
    is_active: true,
    has_integration: canConfigureResellerApp(a),
    has_auto_renewal: hasAutoRenewal(a),
    is_gerenciaapp: isGerenciaAppFamily(a),
    // "Ativar": SET IPTV, SmartOne… (só AtivaApp) não têm consulta de vencimento
    ...(mode === "activate" ? { can_check_expiry: canCheckByDevice(a), window_days: activationWindowDays(a) } : {}),
    fields: editableFields(a),
  };
}

/** GerenciaApp: aparelhos configurados agora (Remover libera a vaga). */
async function gerenciaAppUsage(sb: SupabaseClient, tenantId: string, resellerId: string, exceptRowId?: string) {
  const [{ data: rows }, { data: rv }] = await Promise.all([
    sb
      .from("reseller_client_apps")
      .select("id, apps(name, integration_type)")
      .eq("tenant_id", tenantId)
      .eq("reseller_id", resellerId)
      .not("configured_at", "is", null),
    sb.from("resellers").select("gerenciaapp_limit").eq("id", resellerId).maybeSingle(),
  ]);
  const used = (rows || []).filter((r: any) => r.id !== exceptRowId && r.apps && isGerenciaAppFamily(r.apps)).length;
  const lim = Number(rv?.gerenciaapp_limit);
  return { used, limit: Number.isFinite(lim) ? lim : DEFAULT_GERENCIAAPP_LIMIT };
}

function partnerApp(app: any): PartnerCtx["app"] {
  return { id: app.id, name: app.name, integration_type: app.integration_type, fields_config: app.fields_config };
}

export async function POST(req: NextRequest) {
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const body = await req.json().catch(() => ({} as any));
    const ctx = await validateResellerSession(sb, s(body?.session_token));
    if (!ctx) return jsonError(401, "session_invalid");
    const action = s(body?.action);

    // cliente sempre DA revenda logada
    const loadClient = async (id: string) => {
      if (!UUID_RE.test(id)) return null;
      const { data } = await sb
        .from("reseller_end_clients")
        .select(CLIENT_COLS)
        .eq("id", id)
        .eq("tenant_id", ctx.tenant_id)
        .eq("reseller_id", ctx.reseller_id)
        .maybeSingle();
      return data as any;
    };
    const loadApp = async (id: string) => {
      if (!UUID_RE.test(id)) return null;
      const { data } = await sb.from("apps").select(APP_COLS).eq("id", id).eq("tenant_id", ctx.tenant_id).maybeSingle();
      return data as any;
    };

    // ---------------- dashboard ----------------
    if (action === "dashboard") {
      const { data: linksData } = await sb
        .from("reseller_servers")
        .select("id, server_id, server_username, panel_stats, panel_stats_at")
        .eq("tenant_id", ctx.tenant_id)
        .eq("reseller_id", ctx.reseller_id);
      const links = (linksData || []) as any[];
      if (body?.sync === true) await syncResellerPanels(sb, ctx.tenant_id, links);

      const [{ data: clients }, { data: rows }, ga] = await Promise.all([
        sb
          .from("reseller_end_clients")
          .select(CLIENT_COLS)
          .eq("tenant_id", ctx.tenant_id)
          .eq("reseller_id", ctx.reseller_id)
          .is("missing_since", null)
          .order("username", { ascending: true }),
        sb
          .from("reseller_client_apps")
          .select(ROW_COLS)
          .eq("tenant_id", ctx.tenant_id)
          .eq("reseller_id", ctx.reseller_id)
          .not("end_client_id", "is", null)
          .order("created_at", { ascending: true }),
        gerenciaAppUsage(sb, ctx.tenant_id, ctx.reseller_id),
      ]);

      const sum = (k: string) => links.reduce((acc, l) => acc + (Number(l.panel_stats?.[k]) || 0), 0);
      const expiring = links.reduce((acc, l) => acc + (Array.isArray(l.panel_stats?.expiring_2d) ? l.panel_stats.expiring_2d.length : 0), 0);
      const synced = links.map((l) => l.panel_stats_at).filter(Boolean).sort().pop() || null;

      const byClient = new Map<string, any[]>();
      for (const r of (rows || []) as any[]) {
        const list = byClient.get(r.end_client_id) || [];
        list.push(shapeRow(r));
        byClient.set(r.end_client_id, list);
      }
      // cliente com app mas que sumiu do painel continua aparecendo (marcado)
      const visible = (clients || []) as any[];
      const missingIds = [...byClient.keys()].filter((id) => !visible.some((c) => c.id === id));
      let missing: any[] = [];
      if (missingIds.length) {
        const { data } = await sb.from("reseller_end_clients").select(CLIENT_COLS).in("id", missingIds).eq("reseller_id", ctx.reseller_id);
        missing = (data || []) as any[];
      }
      const configured = [...visible, ...missing]
        .filter((c) => byClient.has(c.id))
        .map((c) => ({ ...shapeClient(c), missing: !!c.missing_since, apps: byClient.get(c.id) }));

      return ok({
        stats: {
          total: sum("total"),
          active: sum("active"),
          expired: sum("expired"),
          blocked: sum("blocked"),
          expiring_2d: expiring,
          apps_configured: (rows || []).length,
          clients_with_apps: configured.length,
          gerenciaapp_used: ga.used,
          gerenciaapp_limit: ga.limit,
          synced_at: synced,
        },
        clients: visible.map(shapeClient),
        configured,
      });
    }

    // ---------------- catálogo ----------------
    if (action === "catalog") {
      const mode = s(body?.mode) === "activate" ? "activate" : "add";
      const [{ data: apps }, { data: logos }, { data: deviceRows }] = await Promise.all([
        sb.from("apps").select(APP_COLS).eq("tenant_id", ctx.tenant_id).eq("is_active", true).order("name", { ascending: true }),
        sb.from("app_download_logos").select("pc_logo_url, downloader_logo_url, ios_logo_url").eq("tenant_id", ctx.tenant_id).maybeSingle(),
        sb.from("app_device_types").select("device_key, icon_url").eq("tenant_id", ctx.tenant_id),
      ]);
      const data = (apps || [])
        .filter((a: any) => (mode === "activate" ? isActivatableApp(a) : isAddableApp(a)))
        .map((a: any) => catalogItem(a, logos, mode));
      const device_icons: Record<string, string> = {};
      for (const r of deviceRows || []) if (r.icon_url) device_icons[r.device_key] = r.icon_url;
      return ok({ data, device_icons });
    }

    // ---------------- Ativar: disponibilidade ----------------
    if (action === "activate_check") {
      const app = await loadApp(s(body?.app_id));
      if (!app || !isActivatableApp(app)) return jsonError(400, "Esse aplicativo não tem ativação pelo portal.");
      const fv = readFieldValues(app, body?.field_values);
      if ("error" in fv) return jsonError(400, fv.error);
      const price = resellerLicensePrice(app);
      const window_days = activationWindowDays(app);
      if (!canCheckByDevice(app)) {
        // SET IPTV, SmartOne, ClouDDy, Bay TV: a AtivaApp não consulta vencimento
        return ok({ available: true, checked: false, expire_date: null, available_from: null, price, window_days });
      }
      const r = await checkResellerApp(sb, { app: partnerApp(app), fieldValues: fv.values, m3uUrl: "", serverName: "", serverId: null });
      if (!r.ok) return jsonError(400, r.error);
      const expire = isoDate(r.expireDate);
      const from = activationAvailableFrom(app, expire);
      return ok({ available: !from, checked: true, expire_date: expire, is_trial: r.isTrial, available_from: from, price, window_days });
    }

    // ---------------- Adicionar: cliente + app → configura e salva ----------------
    if (action === "configure_new") {
      const client = await loadClient(s(body?.end_client_id));
      if (!client || client.missing_since) return jsonError(400, "Escolha um cliente seu da lista.");
      const app = await loadApp(s(body?.app_id));
      if (!app || !isAddableApp(app)) return jsonError(400, "Esse aplicativo não tem configuração pelo portal.");
      const fv = readFieldValues(app, body?.field_values);
      if ("error" in fv) return jsonError(400, fv.error);

      // mesmo app + mesmo MAC já salvo → é o mesmo aparelho (atualiza)
      const macField = editableFields(app).find((f) => f.type === "mac");
      const macNorm = (v: unknown) => s(v).toUpperCase().replace(/[^0-9A-Z]/g, "");
      let existing: { id: string; end_client_id: string | null; field_values: any; m3u_list: string | null } | undefined;
      if (macField) {
        const { data: same } = await sb
          .from("reseller_client_apps")
          .select("id, end_client_id, field_values, m3u_list")
          .eq("tenant_id", ctx.tenant_id)
          .eq("reseller_id", ctx.reseller_id)
          .eq("app_id", app.id);
        existing = (same || []).find((r: any) => macNorm(r.field_values?.[macField.id]) === macNorm(fv.values[macField.id])) as any;
      }
      const existingId = existing?.id;

      if (isGerenciaAppFamily(app)) {
        const ga = await gerenciaAppUsage(sb, ctx.tenant_id, ctx.reseller_id, existingId);
        if (ga.used >= ga.limit) {
          return jsonError(
            403,
            `Você já usa ${ga.used} de ${ga.limit} aparelhos GerenciaApp. Remova um que não usa mais ou fale com o suporte pra aumentar o limite.`,
          );
        }
      }

      const m3u = await buildResellerM3u(sb, client, "principal");
      if (!m3u) return jsonError(400, "Não foi possível montar a lista desse cliente agora. Fale com o suporte.");
      // o aparelho estava com OUTRO cliente dela → tira a lista antiga (só a de nome exato)
      if (existing?.end_client_id && existing.end_client_id !== client.id) {
        const old = await loadClient(existing.end_client_id);
        const oldM3u = old ? await buildResellerM3u(sb, old, existing.m3u_list === "secundaria" ? "secundaria" : "principal") : null;
        if (oldM3u) {
          await removeResellerAppFromPartner(sb, {
            app: partnerApp(app),
            fieldValues: existing.field_values || {},
            m3uUrl: oldM3u.url,
            serverName: oldM3u.serverName,
            serverId: old.server_id,
          }).catch(() => null);
        }
      }
      const pctx: PartnerCtx = { app: partnerApp(app), fieldValues: fv.values, m3uUrl: m3u.url, serverName: m3u.serverName, serverId: client.server_id };
      const r = await configureResellerApp(sb, pctx);
      if (!r.ok) return jsonError(400, r.error);
      let expire = isoDate(r.expireDate);
      if (!expire) {
        const c = await checkResellerApp(sb, pctx).catch(() => null);
        if (c?.ok) expire = isoDate(c.expireDate);
      }
      const patch = {
        end_client_id: client.id,
        client_label: client.username,
        device_type: s(body?.device_type) || null,
        field_values: fv.values,
        obs: s(body?.obs).slice(0, 120) || null,
        server_id: client.server_id,
        m3u_url: null,
        m3u_username: client.username,
        m3u_list: "principal",
        list_name: r.listName,
        configured_at: new Date().toISOString(),
        expire_date: expire,
      };
      let rowId = existingId;
      if (rowId) {
        await sb.from("reseller_client_apps").update(patch).eq("id", rowId);
      } else {
        const { data: ins, error } = await sb
          .from("reseller_client_apps")
          .insert({ tenant_id: ctx.tenant_id, reseller_id: ctx.reseller_id, app_id: app.id, ...patch })
          .select("id")
          .single();
        if (error || !ins) return jsonError(500, "Configurou no aparelho, mas não foi possível salvar aqui. Tente de novo.");
        rowId = ins.id;
      }
      return ok({ id: rowId, list_name: r.listName, expire_date: expire, is_trial: r.isTrial });
    }

    // ---------------- ações sobre um app já salvo ----------------
    const rowId = s(body?.id);
    if (!UUID_RE.test(rowId)) return jsonError(400, "Aplicativo inválido.");
    const { data: rowData } = await sb
      .from("reseller_client_apps")
      .select(ROW_COLS)
      .eq("id", rowId)
      .eq("tenant_id", ctx.tenant_id)
      .eq("reseller_id", ctx.reseller_id)
      .maybeSingle();
    const row = rowData as any;
    if (!row?.apps) return jsonError(404, "Aplicativo não encontrado.");
    const app = row.apps;
    const client = await loadClient(s(row.end_client_id));
    if (!client) return jsonError(404, "Cliente não encontrado.");

    const ctxFor = async (list: M3uList, fieldValues: Record<string, string>): Promise<PartnerCtx | null> => {
      const m3u = await buildResellerM3u(sb, client, list);
      if (!m3u) return null;
      return { app: partnerApp(app), fieldValues, m3uUrl: m3u.url, serverName: m3u.serverName, serverId: client.server_id };
    };
    const noList = () => jsonError(400, "Não foi possível montar a lista desse cliente agora. Fale com o suporte.");
    const currentList: M3uList = row.m3u_list === "secundaria" ? "secundaria" : "principal";

    if (action === "update" || action === "configure") {
      if (client.missing_since) return jsonError(400, "Esse cliente não aparece mais no seu painel — não dá pra configurar.");
      let fieldValues: Record<string, string> = row.field_values || {};
      if (action === "update") {
        const fv = readFieldValues(app, body?.field_values);
        if ("error" in fv) return jsonError(400, fv.error);
        fieldValues = fv.values;
      }
      // Reconfigurar alterna principal ↔ secundária; Editar mantém a atual
      const list: M3uList = action === "configure" ? (currentList === "principal" ? "secundaria" : "principal") : currentList;
      const pctx = await ctxFor(list, fieldValues);
      if (!pctx) return noList();
      const r = await configureResellerApp(sb, pctx);
      if (!r.ok) return jsonError(400, r.error);
      let expire = isoDate(r.expireDate);
      if (!expire) {
        const c = await checkResellerApp(sb, pctx).catch(() => null);
        if (c?.ok) expire = isoDate(c.expireDate);
      }
      await sb
        .from("reseller_client_apps")
        .update({
          field_values: fieldValues,
          ...(action === "update" ? { obs: s(body?.obs).slice(0, 120) || null } : {}),
          m3u_list: list,
          list_name: r.listName,
          configured_at: new Date().toISOString(),
          ...(expire ? { expire_date: expire } : {}),
        })
        .eq("id", row.id);
      const finalExpire = expire || isoDate(row.expire_date);
      return ok({ list_name: r.listName, expire_date: finalExpire, m3u_list: list, renew: renewInfo(app, finalExpire) });
    }

    if (action === "check") {
      const pctx = await ctxFor(currentList, row.field_values || {});
      if (!pctx) return noList();
      const r = await checkResellerApp(sb, pctx);
      if (!r.ok) return jsonError(400, r.error);
      const expire = isoDate(r.expireDate);
      if (expire) await sb.from("reseller_client_apps").update({ expire_date: expire }).eq("id", row.id);
      const finalExpire = expire || isoDate(row.expire_date);
      return ok({ expire_date: finalExpire, is_trial: r.isTrial, renew: renewInfo(app, finalExpire) });
    }

    if (action === "renew_free") {
      const info = renewInfo(app, isoDate(row.expire_date));
      if (info.kind !== "free") return jsonError(400, "Esse aplicativo não tem renovação grátis.");
      if (info.available_from) return jsonError(400, `A renovação libera a partir de ${info.available_from.split("-").reverse().join("/")}.`);
      const r = await renewGerenciaAppFree(sb, app, row.field_values || {});
      if (!r.ok) return jsonError(400, r.error);
      const expire = isoDate(r.expireDate);
      if (expire) await sb.from("reseller_client_apps").update({ expire_date: expire }).eq("id", row.id);
      const finalExpire = expire || isoDate(row.expire_date);
      return ok({ expire_date: finalExpire, renew: renewInfo(app, finalExpire) });
    }

    if (action === "remove") {
      const pctx = await ctxFor(currentList, row.field_values || {});
      if (!pctx) return jsonError(400, "Não foi possível tirar a lista do aparelho agora. Fale com o suporte.");
      const r = await removeResellerAppFromPartner(sb, pctx);
      if (!r.ok) return jsonError(400, r.error);
      await sb.from("reseller_client_apps").delete().eq("id", row.id);
      return ok({});
    }

    return jsonError(400, "action inválida.");
  } catch (e: any) {
    console.error("[reseller_portal:apps]", { message: e?.message, kind: "reseller_portal_error" });
    return jsonError(500, "Erro interno.");
  }
}
