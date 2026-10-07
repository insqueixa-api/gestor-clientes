// app/api/reseller-portal/apps/route.ts
// ✅ 07/10/2026: "Meus Aplicativos" do Portal da Revenda (etapa A — sem
// pagamento ainda). Ações:
//   catalog   → apps que a revenda pode adicionar (mesmo formato do catálogo
//               do portal do cliente → mesmo AppPickerModal)
//   list      → aparelhos cadastrados pela revenda (a tela não usa mais)
//   add       → cadastra/reaproveita (app, aparelho, campos, link M3U) e
//               devolve a linha pronta pro modal de ativar/configurar
//   configure → envia a lista pro parceiro (GerenciaApp só com licença paga)
//   check     → consulta o vencimento no parceiro
//   remove    → tira a lista do parceiro (só nome exato); o cadastro fica
// Sessão própria da revenda; cada linha precisa ser DELA.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateResellerSession } from "@/lib/reseller-portal/session";
import { APP_FIELD_LABELS, HIDDEN_CLIENT_FIELD_TYPES, type AppFieldType } from "@/lib/apps/field-types";
import { effectiveIcon, effectiveTier } from "@/lib/apps/appativa-catalog";
import { formatLicenca, renderAppDescription } from "@/lib/apps/license-text";
import { withoutLegacyDevices } from "@/lib/apps/device-types";
import { resolveDownloadHint, withDownloadLogo } from "@/lib/apps/download-info";
import { hasAutoRenewal } from "@/lib/apps/auto-renewal";
import {
  canConfigureResellerApp,
  checkResellerApp,
  configureResellerApp,
  detectServerForM3u,
  findFieldByType,
  isResellerCatalogApp,
  parseM3u,
  removeResellerAppFromPartner,
  requiresPaymentBeforeConfigure,
  resellerLicensePrice,
} from "@/lib/reseller-portal/apps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_COLS =
  "id, name, icon_url, technology, device_types, integration_type, cost_type, license_price, license_period, is_active, is_hidden, appativa_app_id, appativa_meta, tier, portal_setup_instructions, fields_config, download_info";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}
const s = (v: unknown) => String(v ?? "").trim();
const ROW_COLS =
  "id, client_label, app_id, device_type, field_values, m3u_url, m3u_username, list_name, configured_at, license_paid_until, created_at, servers(name), apps(" + APP_COLS + ")";

function shapeRow(r: any) {
  const a = r.apps || {};
  const fields = Array.isArray(a.fields_config) ? a.fields_config : [];
  const dateField = findFieldByType(fields, "date");
  const price = resellerLicensePrice(a);
  const paid = !!r.license_paid_until && new Date(`${r.license_paid_until}T23:59:59`).getTime() > Date.now();
  return {
    id: r.id,
    client_label: r.client_label,
    app: { id: a.id, name: a.name, icon_url: effectiveIcon({ icon_url: a.icon_url, appativa_app_id: a.appativa_app_id, appativa_meta: a.appativa_meta }) },
    device_type: r.device_type,
    fields: fields
      .filter((f: any) => f && f.id && f.type !== "date" && !HIDDEN_CLIENT_FIELD_TYPES.includes(f.type as AppFieldType))
      .map((f: any) => ({ id: String(f.id), type: String(f.type), label: String(f.label || APP_FIELD_LABELS[f.type as AppFieldType] || f.id), value: s(r.field_values?.[f.id]) })),
    expire_date: dateField ? s(r.field_values?.[String(dateField.id || dateField.label)]) || null : null,
    m3u_username: r.m3u_username,
    server_name: r.servers?.name || null,
    list_name: r.list_name,
    configured_at: r.configured_at,
    license_price: price,
    license_paid_until: r.license_paid_until,
    // GerenciaApp: configurar só com licença paga
    configure_blocked: requiresPaymentBeforeConfigure(a) && !paid,
    can_check: canConfigureResellerApp(a),
    // SET IPTV/ClouDDy/SmartOne…: só licença (AtivaApp) — lista não é pelo portal
    can_configure: canConfigureResellerApp(a),
  };
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

    // ---------------- catálogo ----------------
    if (action === "catalog") {
      const [{ data: apps }, { data: logos }, { data: deviceRows }] = await Promise.all([
        sb.from("apps").select(APP_COLS).eq("tenant_id", ctx.tenant_id).eq("is_active", true).order("name", { ascending: true }),
        sb.from("app_download_logos").select("pc_logo_url, downloader_logo_url, ios_logo_url").eq("tenant_id", ctx.tenant_id).maybeSingle(),
        sb.from("app_device_types").select("device_key, icon_url").eq("tenant_id", ctx.tenant_id),
      ]);
      const data = (apps || [])
        .filter((a: any) => isResellerCatalogApp(a))
        .map((a: any) => {
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
            fields: (Array.isArray(a.fields_config) ? a.fields_config : [])
              .filter((f: any) => f && f.id && f.type !== "date" && !HIDDEN_CLIENT_FIELD_TYPES.includes(f.type as AppFieldType))
              .map((f: any) => ({
                id: String(f.id),
                type: String(f.type || ""),
                label: String(String(f.label || "").trim() || APP_FIELD_LABELS[f.type as AppFieldType] || f.id),
              })),
          };
        });
      const device_icons: Record<string, string> = {};
      for (const r of deviceRows || []) if (r.icon_url) device_icons[r.device_key] = r.icon_url;
      return NextResponse.json({ ok: true, data, device_icons }, { headers: NO_STORE });
    }

    // ---------------- lista ----------------
    if (action === "list") {
      const { data: rows } = await sb
        .from("reseller_client_apps")
        .select(ROW_COLS)
        .eq("tenant_id", ctx.tenant_id)
        .eq("reseller_id", ctx.reseller_id)
        .order("created_at", { ascending: false });
      const data = (rows || []).map(shapeRow);
      return NextResponse.json({ ok: true, data }, { headers: NO_STORE });
    }

    // ---------------- adicionar ----------------
    if (action === "add") {
      const loadRow = async (id: string) => {
        const { data } = await sb.from("reseller_client_apps").select(ROW_COLS).eq("id", id).maybeSingle();
        return data ? shapeRow(data) : null;
      };
      const appId = s(body?.app_id);
      const clientLabel = s(body?.client_label).slice(0, 80);
      const m3uUrl = s(body?.m3u_url);
      if (!UUID_RE.test(appId)) return jsonError(400, "Escolha o aplicativo.");
      // ✅ 07/10/2026 (pedido do Márcio): M3U é OPCIONAL — só o Configurar
      // precisa dele; pra pagar/ativar a licença não. Se vier, tem que ser válido.
      const m3u = m3uUrl ? parseM3u(m3uUrl) : null;
      if (m3uUrl && (!m3u || !m3u.username || !m3u.password)) return jsonError(400, "Link M3U inválido — precisa ter username=… e password=….");
      const { data: app } = await sb.from("apps").select(APP_COLS).eq("id", appId).eq("tenant_id", ctx.tenant_id).maybeSingle();
      if (!app || !isResellerCatalogApp(app)) return jsonError(400, "Esse aplicativo não está disponível.");
      const fields = Array.isArray((app as any).fields_config) ? (app as any).fields_config : [];
      const input = (body?.field_values || {}) as Record<string, unknown>;
      const fieldValues: Record<string, string> = {};
      // "Ambiente" (obs) é do Márcio/cliente final — na revenda vira o nome do cliente (client_label)
      for (const f of fields) if (f?.id && f.type !== "date" && f.type !== "obs" && input[f.id] != null) fieldValues[String(f.id)] = s(input[f.id]).slice(0, 200);
      const macField = fields.find((f: any) => String(f?.type || "").toLowerCase() === "mac");
      // ✅ 07/10/2026: na revenda o nome do cliente e TODOS os campos do app são obrigatórios
      if (!clientLabel) return jsonError(400, "Informe o nome do cliente.");
      const missing = fields.find(
        (f: any) => f?.id && f.type !== "date" && f.type !== "obs" && !HIDDEN_CLIENT_FIELD_TYPES.includes(f.type as AppFieldType) && !fieldValues[String(f.id)],
      );
      if (missing) return jsonError(400, `Preencha o ${missing.label || APP_FIELD_LABELS[missing.type as AppFieldType] || "campo"}.`);
      const server = m3u ? await detectServerForM3u(sb, ctx.tenant_id, ctx.reseller_id, m3u.host) : null;
      // ✅ 07/10/2026: a revenda não tem lista de apps (só "ativar ou
      // configurar" na hora) — o registro fica só por dentro, UM por aparelho:
      // mesmo app + mesmo MAC → reaproveita a linha (a licença é do aparelho;
      // paga uma vez, não se perde ao reabrir o seletor ou trocar o M3U).
      // App sem campo MAC → chave é o usuário do M3U.
      const macNorm = (v: unknown) => s(v).toUpperCase().replace(/[^0-9A-Z]/g, "");
      const macKey = macField ? macNorm(fieldValues[String(macField.id)]) : "";
      let same: any = null;
      if (macField || m3u) {
        let q = sb.from("reseller_client_apps").select("id, field_values").eq("tenant_id", ctx.tenant_id).eq("reseller_id", ctx.reseller_id).eq("app_id", appId);
        if (!macField) q = q.eq("m3u_username", m3u!.username);
        const { data: sameRows } = await q.order("created_at", { ascending: false });
        same = (sameRows || []).find((r: any) => !macField || macNorm(r.field_values?.[String(macField.id)]) === macKey) || null;
      }
      if (same) {
        await sb
          .from("reseller_client_apps")
          .update({
            client_label: clientLabel,
            device_type: s(body?.device_type) || null,
            field_values: { ...(same.field_values || {}), ...fieldValues },
            // sem M3U agora (só pagar) → mantém o que já estava salvo
            ...(m3u ? { m3u_url: m3uUrl, m3u_username: m3u.username, server_id: server?.id || null } : {}),
          })
          .eq("id", same.id);
        return NextResponse.json({ ok: true, id: same.id, row: await loadRow(same.id) }, { headers: NO_STORE });
      }
      const { data: ins, error } = await sb
        .from("reseller_client_apps")
        .insert({
          tenant_id: ctx.tenant_id,
          reseller_id: ctx.reseller_id,
          client_label: clientLabel,
          app_id: appId,
          device_type: s(body?.device_type) || null,
          field_values: fieldValues,
          m3u_url: m3u ? m3uUrl : "", // coluna NOT NULL: "" = não informado
          m3u_username: m3u?.username || null,
          server_id: server?.id || null,
        })
        .select("id")
        .single();
      if (error || !ins) return jsonError(500, "Não foi possível salvar.");
      return NextResponse.json({ ok: true, id: ins.id, row: await loadRow(ins.id) }, { headers: NO_STORE });
    }

    // ---------------- ações sobre uma linha ----------------
    const rowId = s(body?.id);
    if (!UUID_RE.test(rowId)) return jsonError(400, "Aplicativo inválido.");
    const { data: rowData } = await sb
      .from("reseller_client_apps")
      .select("id, app_id, field_values, m3u_url, server_id, license_paid_until, servers(name), apps(" + APP_COLS + ")")
      .eq("id", rowId)
      .eq("tenant_id", ctx.tenant_id)
      .eq("reseller_id", ctx.reseller_id)
      .maybeSingle();
    const row = rowData as any;
    if (!row) return jsonError(404, "Aplicativo não encontrado.");
    const app = (row as any).apps;
    const partnerCtx = {
      app: { id: app.id, name: app.name, integration_type: app.integration_type, fields_config: app.fields_config },
      fieldValues: (row as any).field_values || {},
      m3uUrl: (row as any).m3u_url,
      serverName: (row as any).servers?.name || "Servidor",
      serverId: (row as any).server_id,
    };

    // SET IPTV/ClouDDy/SmartOne…: só licença (AtivaApp) — a lista não é pelo portal
    const canConfigure = canConfigureResellerApp(app);
    if ((action === "configure" || action === "check") && !canConfigure) {
      return jsonError(400, "A configuração da lista desse aplicativo não é feita pelo portal — fale com o suporte.");
    }

    if (action === "configure") {
      const paid = !!row.license_paid_until && new Date(`${row.license_paid_until}T23:59:59`).getTime() > Date.now();
      if (requiresPaymentBeforeConfigure(app) && !paid) {
        return jsonError(402, "Esse aplicativo precisa da licença paga antes de configurar.");
      }
      const r = await configureResellerApp(sb, partnerCtx);
      if (!r.ok) return jsonError(400, r.error);
      const patch: Record<string, unknown> = { list_name: r.listName, configured_at: new Date().toISOString() };
      const dateField = findFieldByType(app.fields_config || [], "date");
      if (dateField && r.expireDate) patch.field_values = { ...(row as any).field_values, [String(dateField.id || dateField.label)]: r.expireDate };
      await sb.from("reseller_client_apps").update(patch).eq("id", row.id);
      return NextResponse.json({ ok: true, list_name: r.listName, expire_date: r.expireDate, is_trial: r.isTrial, message: r.message }, { headers: NO_STORE });
    }

    if (action === "check") {
      const r = await checkResellerApp(sb, partnerCtx);
      if (!r.ok) return jsonError(400, r.error);
      const dateField = findFieldByType(app.fields_config || [], "date");
      if (dateField && r.expireDate) {
        await sb
          .from("reseller_client_apps")
          .update({ field_values: { ...(row as any).field_values, [String(dateField.id || dateField.label)]: r.expireDate } })
          .eq("id", row.id);
      }
      return NextResponse.json({ ok: true, expire_date: r.expireDate, is_trial: r.isTrial }, { headers: NO_STORE });
    }

    if (action === "remove") {
      // só os com automação mexem no parceiro; os demais só apagam o cadastro
      if (canConfigure) {
        const r = await removeResellerAppFromPartner(sb, partnerCtx);
        if (!r.ok) return jsonError(400, r.error);
      }
      // não apaga a linha: a licença paga (license_paid_until) continua valendo
      await sb.from("reseller_client_apps").update({ list_name: null, configured_at: null }).eq("id", row.id);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    return jsonError(400, "action inválida.");
  } catch (e: any) {
    console.error("[reseller_portal:apps]", { message: e?.message, kind: "reseller_portal_error" });
    return jsonError(500, "Erro interno.");
  }
}
