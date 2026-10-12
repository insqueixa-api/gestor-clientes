// lib/apps/app-overview.ts
// ✅ 12/10/2026 — dados da página do aplicativo (ver
// app/api/admin/apps/[id]/overview/route.ts, que só checa o login e chama
// isto). Separado da rota pra poder ser testado direto.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getIntegrationHandler } from "@/lib/integrations";
import { CHECK_VALIDITY_HANDLERS, resolveIntegrationTypeByName } from "@/lib/apps/panel";

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
  // ✅ 12/10/2026: UMA ida ao banco (docs/sql/app_overview_payload.sql) —
  // antes eram até 4 em sequência (app → clientes → pagamentos → nomes).
  const { data: payload, error } = await sb.rpc("app_overview_payload", { p_tenant_id: tenantId, p_app_id: id });
  if (error) return { status: 500, body: { error: error.message } };
  if (!payload?.app) return { status: 404, body: { error: "Aplicativo não encontrado" } };
  const app: any = payload.app;
  const rows: any[] = payload.rows || [];
  const integ: any = payload.integration || null;
  const partners: any[] = payload.partners || [];
  const server = payload.partner_server ? { name: payload.partner_server } : null;
  const pays: any[] = payload.payments || [];
  const alerts: any[] = payload.alerts || [];
  const activity: any[] = payload.activity || [];
  // cliente EUR/USD paga o app na moeda dele (gravado nela, não em R$) —
  // margem/lucro convertem pela cotação ATUAL (aproximação, não a do dia)
  const fx: any = payload.fx || null;
  const toBRL = (v: number, cur: string): number | null =>
    cur === "BRL" ? v
    : cur === "USD" && fx?.usd_to_brl ? v * Number(fx.usd_to_brl)
    : cur === "EUR" && fx?.eur_to_brl ? v * Number(fx.eur_to_brl)
    : null;

  const config: any[] = Array.isArray(app.fields_config) ? app.fields_config : [];
  const macField = config.find((f) => f.type === "mac");
  const keyField = config.find((f) => f.type === "device_key");
  const ambField = config.find((f) => f.type === "obs");

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
      // todos os campos preenchidos (menos a data) — botões de copiar
      fields: config
        .filter((f) => f.type !== "date")
        .map((f) => ({ label: String(f.label || f.type), type: f.type, value: String(vals[f.id] ?? vals[f.label] ?? "").trim() }))
        .filter((f) => f.value),
      trial_hint: vals._trial_hint === "1",
      // ✅ 12/10/2026: licença vencida confirmada pelo parceiro, sem data (DupleCast "expired")
      expired_hint: vals._expired_hint === "1" && vals._trial_hint !== "1",
      configured: !!r.m3u_list,
      added_at: r.created_at,
    };
  });
  // ✅ botão "Renovar" só na janela aberta — mesma regra do portal
  // (isAppRenewableNow em app/renew/RenewClient.tsx): avaliação, sem data,
  // vencido ou vencendo em 30 dias (Appativa: 7). GerenciaApp grátis
  // também renova pelo admin ("Renovar licença" grátis no modal).
  // "Verificar vencimento" — mesmo critério do botão do modal do cliente
  // (handleCheckApp): handler com API + na lista de checagem; DUPLEXTV não
  // informa vencimento; extensão (SET IPTV/ClouDDy) fica só no modal.
  const handler =
    getIntegrationHandler(String(app.integration_type || "")) ||
    getIntegrationHandler(resolveIntegrationTypeByName(String(app.name || "")));
  const canCheckValidity =
    !!handler?.useApi && CHECK_VALIDITY_HANDLERS.has(handler.actionPrefix) && handler.actionPrefix !== "DUPLEXTV";
  const hasRenewPath =(Number(app.license_price) > 0 && app.cost_type !== "free") || String(app.integration_type || "").toUpperCase() === "GERENCIAAPP";
  const windowDays = app.appativa_app_id ? 7 : 30;
  const todaySP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const daysUntil = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todaySP}T00:00:00Z`)) / 86_400_000);
  for (const u of users as any[]) {
    const d = u.expiration ? daysUntil(u.expiration) : NaN;
    u.days_left = Number.isFinite(d) ? d : null; // data inválida = sem data
    u.renewable =
      hasRenewPath &&
      u.client_status === "ativo" &&
      (u.trial_hint || u.days_left == null || u.days_left <= windowDays);
  }
  const activeUsers = users.filter((u) => u.client_status === "ativo");
  const userByLink = new Map(users.map((u) => [u.client_app_id, u]));

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

  // nomes de quem aparece em pagamentos/sinos/histórico já vêm na função
  const knownNames = new Map<string, string>(users.map((u) => [u.client_id, u.client_name]));
  for (const x of [...pays, ...alerts, ...activity]) if (x.client_id && x.client_name && !knownNames.has(x.client_id)) knownNames.set(x.client_id, x.client_name);

  const payments = (pays || []).map((p: any) => {
    const paid = PAID.has(p.status) && p.fulfillment_status !== "manual_cancelled";
    const amount = Number(p.price_amount || 0);
    const currency = p.price_currency || "BRL";
    const amountBRL = toBRL(amount, currency);
    return {
      id: p.id,
      created_at: p.created_at,
      paid_at: p.paid_at,
      status: p.status,
      fulfillment_status: p.fulfillment_status,
      counted: paid,
      amount,
      currency,
      amount_brl: amountBRL,
      coupon_code: p.coupon_code,
      discount: Number(p.coupon_discount_amount || 0),
      method: p.payment_method,
      gateway: p.gateway_type,
      client_id: p.client_id,
      client_name: knownNames.get(p.client_id) || "Cliente excluído",
      bundled: !!p.parent_payment_id,
      server_name: p.server_name,
      // custo e margem sempre em R$ (EUR/USD convertido pela cotação atual)
      margin: paid && cost.value != null && amountBRL != null ? amountBRL - cost.value : null,
    };
  });

  const paidRows = payments.filter((p) => p.counted);
  const revenueByCurrency: Record<string, number> = {};
  for (const p of paidRows) revenueByCurrency[p.currency] = (revenueByCurrency[p.currency] || 0) + p.amount;
  const convertible = paidRows.filter((p) => p.amount_brl != null);
  const revenueBRL = convertible.reduce((sum, p) => sum + (p.amount_brl as number), 0);

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
      renew_window_days: hasRenewPath ? windowDays : null,
      can_check_validity: canCheckValidity,
      download_info: app.download_info,
      has_portal_instructions: !!String(app.portal_setup_instructions || "").trim(),
      discontinued_replacement_name: app.discontinued_replacement_name,
      created_at: app.created_at,
    },
    stats: {
      // clientes DISTINTOS (um cliente pode ter o app em vários aparelhos) —
      // mesma conta do modal de apps (app_user_counts)
      active_users: new Set(activeUsers.map((u) => u.client_id)).size,
      active_devices: activeUsers.length,
      trial_users: new Set(users.filter((u) => u.client_status === "teste").map((u) => u.client_id)).size,
      total_rows: users.length,
      // mesma conta dos filtros da página (dias no fuso de SP)
      expiring_30d: activeUsers.filter((u: any) => u.days_left != null && u.days_left >= 0 && u.days_left <= 30).length,
      expired: activeUsers.filter((u: any) => u.days_left != null && u.days_left < 0).length,
      payments_count: paidRows.length,
      revenue_by_currency: revenueByCurrency,
      cost_per_activation: cost.value,
      cost_source: cost.source,
      sale_price: salePrice,
      margin_per_activation: salePrice != null && cost.value != null ? salePrice - cost.value : null,
      estimated_profit_brl: cost.value != null ? revenueBRL - convertible.length * cost.value : null,
      has_foreign_currency: paidRows.some((p) => p.currency !== "BRL"),
      fx_as_of: fx?.as_of_date || null,
    },
    users,
    payments,
    trust_activations: (alerts || []).map((a: any) => ({
      ...a,
      client_name: knownNames.get(a.client_id) || "—",
    })),
    // MAC/Key/vencimento do app instalado (se ainda existir)
    // Ordem: o que o próprio registro guardou (MAC/Key desde 12/10/2026,
    // vencimento do momento em detail.expireDate) → app ainda vinculado →
    // se o cliente tem só 1 aparelho desse app, é ele (o Salvar do admin
    // regrava client_apps e o vínculo antigo vira null).
    activity: (activity || [])
      .map((a: any) => {
      const d = a.detail || {};
      const atTime = d.expireDate ? String(d.expireDate).slice(0, 10) : null;
      let u: any = a.client_app_id ? userByLink.get(a.client_app_id) : null;
      if (!u && a.client_id) {
        const same = users.filter((x) => x.client_id === a.client_id);
        // vários aparelhos: o único cujo vencimento bate com o registrado
        const byDate = atTime ? same.filter((x) => x.expiration === atTime) : [];
        if (same.length === 1) u = same[0];
        else if (byDate.length === 1) u = byDate[0];
      }
      // dados do aparelho: o que o registro guardou na hora (detail.device,
      // já com os nomes do cadastro do app) ou os campos do app instalado.
      // Cada app tem os seus campos (ClouDDy = e-mail, sem MAC).
      const snap: { label: string; type: string; value: string }[] = Array.isArray(d.device)
        ? d.device.filter((f: any) => f?.value)
        : [];
      return {
        ...a,
        client_name: knownNames.get(a.client_id) || "—",
        fields: snap.length ? snap : u?.fields || [],
        installed: !!u,
        expiration: atTime || u?.expiration || null,
        expiration_at_time: !!atTime,
        trial_hint: atTime ? false : d.isTrial === true || !!u?.trial_hint,
        device_guess: !snap.length && !a.client_app_id && !!u,
      };
    })
      // ✅ pedido do Márcio: registro sem dado nenhum do aparelho E cujo app
      // não está mais no cliente não serve pra nada — some da página.
      // Mostra os 50 mais recentes (a tabela guarda 50 por app, ver
      // docs/sql/app_activity_log_retention.sql).
      .filter((a: any) => a.fields.length > 0 || a.installed)
      .slice(0, 50),
  } };
}
