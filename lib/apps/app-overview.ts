// lib/apps/app-overview.ts
// ✅ 12/10/2026 — dados da página do aplicativo (ver
// app/api/admin/apps/[id]/overview/route.ts, que só checa o login e chama
// isto). Separado da rota pra poder ser testado direto.
import type { SupabaseClient } from "@supabase/supabase-js";

const PAID = new Set(["approved", "manual_approved", "paid"]);

function extractExpiration(vals: Record<string, any>, config: any[]): string | null {
  let exp = vals["Vencimento"] || vals["vencimento"] || vals["VENCIMENTO"] || null;
  if (!exp) {
    const dateField = config.find((f: any) => f.type === "date" || /vencimento/i.test(f.label || ""));
    if (dateField) exp = vals[dateField.id] || vals[dateField.label] || null;
  }
  if (!exp) exp = Object.values(vals).find((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) || null;
  return exp ? String(exp).slice(0, 10) : null;
}

export async function buildAppOverview(sb: SupabaseClient, tenantId: string, id: string): Promise<{ status: number; body: any }> {
  const { data: app } = await sb.from("apps").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!app) return { status: 404, body: { error: "Aplicativo não encontrado" } };

  const config: any[] = Array.isArray(app.fields_config) ? app.fields_config : [];
  const macField = config.find((f) => f.type === "mac");
  const keyField = config.find((f) => f.type === "device_key");
  const ambField = config.find((f) => f.type === "obs");

  const [{ data: rows }, { data: integ }, { data: partners }, { data: server }] = await Promise.all([
    sb
      .from("client_apps")
      .select("id, client_id, created_at, field_values, license_paid_until, device_type, m3u_list, clients(id, display_name, server_username, is_trial, is_archived, deep_archived_at, servers(name))")
      .eq("tenant_id", tenantId)
      .eq("app_id", id),
    app.integration_type
      ? sb.from("app_integrations").select("label, is_active, api_url").eq("tenant_id", tenantId).eq("app_name", app.integration_type).maybeSingle()
      : Promise.resolve({ data: null }),
    sb.from("api_integrations").select("provider, credit_unit_price").eq("tenant_id", tenantId),
    app.partner_server_id
      ? sb.from("servers").select("name").eq("id", app.partner_server_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const users = (rows || []).map((r: any) => {
    const vals = r.field_values || {};
    const c = r.clients || {};
    const expiration = extractExpiration(vals, config) || (r.license_paid_until ? String(r.license_paid_until).slice(0, 10) : null);
    const status = c.deep_archived_at ? "arquivado" : c.is_archived ? "lixeira" : c.is_trial ? "teste" : "ativo";
    return {
      client_app_id: r.id,
      client_id: r.client_id,
      client_name: c.display_name || "—",
      server_username: c.server_username || "—",
      server_name: c.servers?.name || "—",
      client_status: status,
      mac: macField ? String(vals[macField.id] || "") : "",
      device_key: keyField ? String(vals[keyField.id] || "") : "",
      ambiente: ambField ? String(vals[ambField.id] || "") : "",
      device_type: r.device_type,
      expiration,
      trial_hint: vals._trial_hint === "1",
      configured: !!r.m3u_list,
      added_at: r.created_at,
    };
  });
  const clientAppIds = users.map((u) => u.client_app_id);
  const activeUsers = users.filter((u) => u.client_status === "ativo");

  // ── custo por ativação ──
  const price = (p: string) => Number((partners || []).find((x: any) => x.provider === p)?.credit_unit_price || 0) || null;
  const integration = String(app.integration_type || "").toUpperCase();
  const credits = Number(app.appativa_meta?.valor || 0) || null;
  let cost: { value: number | null; source: string } = { value: null, source: "Sem custo cadastrado (ativação manual)" };
  if (integration === "DUPLECAST" && app.renewal_source !== "appativa" && price("DUPLECAST")) {
    cost = { value: price("DUPLECAST"), source: "DupleCast · 1 código" };
  } else if (app.appativa_app_id && credits && price("APPATIVA")) {
    cost = { value: credits * (price("APPATIVA") as number), source: `Appativa · ${String(credits).replace(".", ",")} crédito(s)` };
  } else if (integration === "GERENCIAAPP") {
    cost = { value: 0, source: "GerenciaApp · assinatura fixa, sem custo por ativação" };
  }
  const salePrice = app.license_price != null ? Number(app.license_price) : null;

  // ── pagamentos ──
  let payQuery = sb
    .from("client_portal_payments")
    .select("id, created_at, paid_at, status, fulfillment_status, price_amount, price_currency, coupon_code, coupon_discount_amount, payment_method, gateway_type, client_id, client_app_id, app_name_snapshot, parent_payment_id, server_name")
    .eq("tenant_id", tenantId)
    .eq("payment_type", "app_renewal")
    .order("created_at", { ascending: false })
    .limit(500);
  // Aspas no valor dentro do or(): nome com espaço ("IBO Player") quebraria
  // o filtro. Fora do or() (ilike/eq normais) vai o nome puro.
  const nameEsc = `"${String(app.name).replace(/[",()\\]/g, " ")}"`;
  payQuery = clientAppIds.length
    ? payQuery.or(`client_app_id.in.(${clientAppIds.join(",")}),app_name_snapshot.ilike.${nameEsc}`)
    : payQuery.ilike("app_name_snapshot", String(app.name));
  const { data: pays } = await payQuery;

  // ── ativações em confiança e histórico ──
  const [{ data: alerts }, { data: activity }] = await Promise.all([
    clientAppIds.length
      ? sb
          .from("client_alerts")
          .select("id, created_at, closed_at, status, amount, currency, client_id, activation_date, meta")
          .eq("tenant_id", tenantId)
          .eq("kind", "app_activation")
          .in("client_app_id", clientAppIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    (clientAppIds.length
      ? sb
          .from("client_app_activity_log")
          .select("id, created_at, event, detail, client_id, client_app_id")
          .eq("tenant_id", tenantId)
          .or(`client_app_id.in.(${clientAppIds.join(",")}),app_name.eq.${nameEsc}`)
      : sb.from("client_app_activity_log").select("id, created_at, event, detail, client_id, client_app_id").eq("tenant_id", tenantId).eq("app_name", app.name)
    )
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  // nomes dos clientes citados em pagamentos/sinos/histórico que não estão em `users`
  const knownNames = new Map(users.map((u) => [u.client_id, u.client_name]));
  const missing = [
    ...new Set([...(pays || []), ...(alerts || []), ...(activity || [])].map((x: any) => x.client_id).filter((cid: string) => cid && !knownNames.has(cid))),
  ];
  if (missing.length) {
    const { data: extra } = await sb.from("clients").select("id, display_name").in("id", missing);
    for (const c of extra || []) knownNames.set(c.id, c.display_name);
  }

  const payments = (pays || []).map((p: any) => {
    const paid = PAID.has(p.status) && p.fulfillment_status !== "manual_cancelled";
    const amount = Number(p.price_amount || 0);
    return {
      id: p.id,
      created_at: p.created_at,
      paid_at: p.paid_at,
      status: p.status,
      fulfillment_status: p.fulfillment_status,
      counted: paid,
      amount,
      currency: p.price_currency || "BRL",
      coupon_code: p.coupon_code,
      discount: Number(p.coupon_discount_amount || 0),
      method: p.payment_method,
      gateway: p.gateway_type,
      client_id: p.client_id,
      client_name: knownNames.get(p.client_id) || "Cliente excluído",
      bundled: !!p.parent_payment_id,
      server_name: p.server_name,
      margin: paid && cost.value != null ? amount - cost.value : null,
    };
  });

  const paidRows = payments.filter((p) => p.counted);
  const revenueByCurrency: Record<string, number> = {};
  for (const p of paidRows) revenueByCurrency[p.currency] = (revenueByCurrency[p.currency] || 0) + p.amount;
  const revenueBRL = revenueByCurrency.BRL || 0;
  const paidBRL = paidRows.filter((p) => p.currency === "BRL").length;

  return { status: 200, body: {
    ok: true,
    app: {
      id: app.id,
      name: app.name,
      icon_url: app.icon_url,
      tier: app.tier,
      is_active: app.is_active,
      is_hidden: app.is_hidden,
      cost_type: app.cost_type,
      license_price: salePrice,
      license_period: app.license_period,
      device_types: app.device_types || [],
      technology: app.technology,
      integration_type: app.integration_type,
      integration_label: integ?.label || null,
      integration_active: integ?.is_active ?? null,
      renewal_source: app.renewal_source,
      appativa_app_id: app.appativa_app_id,
      appativa_app_name: app.appativa_app_name,
      appativa_meta: app.appativa_meta,
      partner_server: server?.name || null,
      fields: config.map((f) => ({ id: f.id, type: f.type, label: f.label })),
      info_url: app.info_url,
      download_info: app.download_info,
      has_portal_instructions: !!String(app.portal_setup_instructions || "").trim(),
      discontinued_replacement_name: app.discontinued_replacement_name,
      created_at: app.created_at,
    },
    stats: {
      active_users: activeUsers.length,
      trial_users: users.filter((u) => u.client_status === "teste").length,
      total_rows: users.length,
      expiring_30d: activeUsers.filter((u) => u.expiration && u.expiration >= today && u.expiration <= in30).length,
      expired: activeUsers.filter((u) => u.expiration && u.expiration < today).length,
      payments_count: paidRows.length,
      revenue_by_currency: revenueByCurrency,
      cost_per_activation: cost.value,
      cost_source: cost.source,
      sale_price: salePrice,
      margin_per_activation: salePrice != null && cost.value != null ? salePrice - cost.value : null,
      estimated_profit_brl: cost.value != null ? revenueBRL - paidBRL * cost.value : null,
    },
    users,
    payments,
    trust_activations: (alerts || []).map((a: any) => ({
      ...a,
      client_name: knownNames.get(a.client_id) || "—",
    })),
    activity: (activity || []).map((a: any) => ({ ...a, client_name: knownNames.get(a.client_id) || "—" })),
  } };
}
