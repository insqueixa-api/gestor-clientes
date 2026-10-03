// app/api/client-portal/apps/renew-payment/route.ts
//
// Botão "Renovar aplicativo" da página de detalhe (/renew-beta/apps/[id]) —
// pedido do Marcio (25/07/2026): pagamento avulso da LICENÇA do app (ex:
// DupleCast R$30/ano), separado da assinatura IPTV do cliente. Reaproveita
// a mesma tabela client_portal_payments e o mesmo webhook do MP/Stripe já
// validados — só marca payment_type='app_renewal' pra eles NUNCA rodarem
// o fulfillment de assinatura (nunca mexe em clients.vencimento).
//
// Preço vem de apps.license_price (sempre cadastrado em BRL). Nunca confia
// em preço vindo do front — sempre lê de novo do catálogo aqui.
//
// ✅ Moeda da conta (achado 24/08/2026, pedido do Márcio): clientes fora do
// Brasil pagam na moeda deles (USD/EUR), não em BRL. license_price é
// convertido via convertAmount() (lib/fx.ts — já arredonda pra cima em
// qualquer conversão cruzada) e o gateway é escolhido pela moeda de destino
// (mesmo padrão de payment_gateways.currency+priority já usado em
// create-payment/route.ts) — pra BRL continua caindo no Mercado Pago
// exatamente como sempre foi; pra USD/EUR cai no Stripe. A criação do
// PaymentIntent do Stripe é implementação própria desta rota (não
// compartilhada com create-payment de propósito — mesmo estilo de
// "duplicado sob controle" que os webhooks já usam, pra não arriscar mexer
// na rota principal que já está em produção).
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { PORTAL_APPS_DISABLED, PORTAL_APPS_DISABLED_MESSAGE } from "@/lib/apps/portal-apps-flag";
import { sanitizeEmailLocalPart } from "@/lib/whatsapp/template-vars";
import { convertAmount } from "@/lib/fx";
import { createFastDepixTransaction, getFastDepixTransaction, fetchQrCodeAsBase64, isFastDepixGatewayType } from "@/lib/fastdepix";
import { findEligibleAppCoupon } from "@/lib/client-portal/coupons";
import { getAppRenewalCharges } from "@/lib/client-portal/app-renewal-charges";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeStr(v: unknown) {
  return String(v ?? "").trim();
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

function getAppOrigin() {
  const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").trim();
  return appUrl.replace(/\/+$/, "");
}

export async function POST(req: NextRequest) {
  // ⏸️ Meus Aplicativos desligado no portal durante o refactor (ver lib/apps/portal-apps-flag.ts)
  if (PORTAL_APPS_DISABLED) {
    return NextResponse.json({ ok: false, error: PORTAL_APPS_DISABLED_MESSAGE }, { status: 503 });
  }
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) return jsonError("Erro interno", 500);

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);
    const client_app_id = normalizeStr(body?.client_app_id);
    // ✅ 07/09/2026, mesmo pedido/motivo de create-payment/route.ts — botão
    // "Tentar outra forma de pagamento" no portal.
    const exclude_gateway_type = normalizeStr(body?.exclude_gateway_type);
    // ✅ 08/09/2026, pedido do Márcio: cupom pessoal restrito a ESTE app
    // (coupons.target_app_names) — popup "você tem desconto, aplicar?" no
    // portal, front só manda true/false, nunca o código (nunca revelado).
    // Sempre resolvido de novo aqui (nunca confia em valor vindo do front).
    const apply_coupon = Boolean(body?.apply_coupon);
    // ✅ 30/09/2026, pedido do Márcio ("carrinho" na tela de Aplicativos):
    // outros apps do mesmo cliente pagos no MESMO PIX. Só ids — preço,
    // posse e elegibilidade são revalidados aqui (getAppRenewalCharges).
    const extraClientAppIdsRaw: string[] = Array.isArray(body?.extra_client_app_ids)
      ? [...new Set<string>(body.extra_client_app_ids.map((v: unknown) => normalizeStr(v)).filter(Boolean))].slice(0, 10)
      : [];

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    if (!client_app_id) return jsonError("client_app_id é obrigatório", 400);

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("client_apps")
      .select("id, apps(name, cost_type, license_price, license_period, is_active)")
      .eq("id", client_app_id)
      .eq("client_id", client_id)
      .single();
    if (rowErr || !row) return jsonError("Aplicativo não encontrado", 404);

    const appName = (row as any).apps?.name || "Aplicativo";
    const costType = (row as any).apps?.cost_type;
    const licensePrice = Number((row as any).apps?.license_price || 0);

    if ((row as any).apps?.is_active === false) {
      return jsonError("Esse aplicativo foi descontinuado — exclua e configure um novo.", 400);
    }

    if (costType !== "paid" || !(licensePrice > 0)) {
      return jsonError("Esse aplicativo não tem cobrança de licença configurada.", 400);
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("display_name, secondary_display_name, whatsapp_username, secondary_whatsapp_username, server_username, price_currency")
      .eq("id", client_id)
      .single();
    const isSecondary = client?.secondary_whatsapp_username === ctx.whatsapp_username;
    const displayName = isSecondary ? (client?.secondary_display_name || "Cliente") : (client?.display_name || "Cliente");

    // ✅ 19/09/2026, pedido do Márcio: o Mercado Pago deixou de mostrar o nome
    // do pagador no extrato do Pix — sobrou só a "Descrição da venda"
    // (additional_info.items[].title). Inclui o Username do Servidor ali pra
    // dar pra saber de quem é olhando só o extrato. Vazio = texto igual ao de
    // antes.
    const serverUsernameTag = String((client as any)?.server_username || "").trim();
    const payerLabel = serverUsernameTag ? `${displayName} (${serverUsernameTag})` : displayName;
    const withUsername = (text: string) => (serverUsernameTag ? `${text} — ${serverUsernameTag}` : text);

    const currency = String(client?.price_currency || "BRL").trim() || "BRL";
    // ✅ Pra BRL é o mesmo número, sem conversão (mantém centavos exatos,
    // igual sempre foi). Pra USD/EUR, convertAmount já arredonda pra cima.
    const appPriceOnly =
      currency === "BRL"
        ? licensePrice
        : await convertAmount(supabaseAdmin, ctx.tenant_id, licensePrice, "BRL", currency);

    // ✅ Carrinho: revalida no servidor (posse, pago, ativo, sem pagamento
    // já aprovado aguardando conclusão) e converte pra moeda da conta —
    // mesma função do pagamento do plano com apps embutidos. Ids inválidos
    // são ignorados sem derrubar o pagamento do app principal. Calculado
    // ANTES do cupom (30/09/2026): o cupom pode cobrir qualquer instalação
    // da cobrança, não só a principal.
    const extraIds = extraClientAppIdsRaw.filter((id) => id !== client_app_id);
    const extras = extraIds.length
      ? await getAppRenewalCharges(supabaseAdmin, ctx.tenant_id, client_id, extraIds, currency)
      : { items: [], total: 0 };

    // ✅ 30/09/2026, pedido do Márcio (Vera, 2 DupleCast): cupom pessoal de
    // app desconta em CADA instalação coberta desta cobrança.
    let couponId: string | null = null;
    // ✅ 02/10/2026: o código também vai pro pagamento — sem ele o Log do
    // Portal (auditoria) mostrava "—" no Desconto (só olha coupon_code)
    let couponCode: string | null = null;
    let couponDiscountAmount = 0;
    let couponByClientAppId: Record<string, number> = {};
    if (apply_coupon) {
      const couponResult = await findEligibleAppCoupon({
        supabaseAdmin,
        tenantId: ctx.tenant_id,
        clientRow: client,
        items: [
          { client_app_id, app_name: appName, price_amount: appPriceOnly },
          ...extras.items,
        ],
      });
      if (couponResult) {
        couponId = couponResult.coupon.id;
        couponCode = couponResult.coupon.code || null;
        couponDiscountAmount = couponResult.discountAmount;
        couponByClientAppId = couponResult.byClientAppId;
      }
    }
    const chargeAmount = Number(
      (appPriceOnly - (couponByClientAppId[client_app_id] || 0)).toFixed(2),
    );
    // Cada filha guarda o que de fato foi pago por ela (já com desconto).
    const bundledAppRenewals = extras.items.map((i) => ({
      ...i,
      price_amount: Number((i.price_amount - (couponByClientAppId[i.client_app_id] || 0)).toFixed(2)),
    }));
    // A linha do app principal guarda só a parte DELE (price_amount); o
    // gateway cobra o total. As linhas filhas são criadas na aprovação
    // (markAppRenewalPaid → materializeBundledAppRenewals).
    const totalCharge = Number(
      (chargeAmount + bundledAppRenewals.reduce((sum, i) => sum + i.price_amount, 0)).toFixed(2),
    );
    // Valor cheio de tudo (sem cupom) — pro "de/por" no resumo do portal.
    const fullTotal = Number((appPriceOnly + extras.total).toFixed(2));
    const bundleKey = bundledAppRenewals.map((i) => i.client_app_id).sort().join(",");
    const bundleHash = bundleKey ? createHash("sha1").update(bundleKey).digest("hex").slice(0, 10) : "solo";
    // ✅ 30/09/2026 (caso Vera): mesmo cupom e mesma seleção não bastam —
    // um PIX gerado pela regra ANTIGA do cupom (desconto só no 1º app)
    // tinha outro valor e era devolvido de novo (R$ 45 em vez de R$ 30).
    // Só reaproveita se o total gravado (pai + filhos) for o de agora.
    const sameTotal = (r: any) => {
      const kids = (Array.isArray(r?.bundled_app_renewals) ? r.bundled_app_renewals : []).reduce(
        (sum: number, i: any) => sum + (Number(i?.price_amount) || 0),
        0,
      );
      return Math.abs(Number(r?.price_amount || 0) + kids - totalCharge) < 0.01;
    };
    const sameBundle = (r: any) =>
      (Array.isArray(r?.bundled_app_renewals) ? r.bundled_app_renewals : [])
        .map((i: any) => String(i?.client_app_id || ""))
        .sort()
        .join(",") === bundleKey;
    const bundledAppsForResponse = extras.items.map((i) => ({
      client_app_id: i.client_app_id,
      app_name: i.app_name,
      price_amount: i.price_amount,
    }));
    const descricaoCobranca = bundledAppRenewals.length
      ? `Renovação de licença — ${appName} + ${bundledAppRenewals.length} app(s)`
      : `Renovação de licença — ${appName}`;

    const { data: gateways, error: gwErr } = await supabaseAdmin
      .from("payment_gateways")
      .select("*")
      .eq("tenant_id", ctx.tenant_id)
      .eq("is_active", true)
      .eq("is_online", true)
      .contains("currency", [currency])
      .order("priority", { ascending: true });

    if (gwErr || !gateways?.length) {
      return jsonError("Nenhum método de pagamento disponível pra licença de app no momento.", 503);
    }

    // ✅ "Tentar outra forma" — pula o tipo já tentado, mantendo a ordem de
    // prioridade pro resto. has_alternate_gateway (nas respostas abaixo) usa
    // `gateways.length` original, não esse filtrado.
    const gateway = exclude_gateway_type
      ? gateways.find((g: any) => g.type !== exclude_gateway_type)
      : gateways[0];

    if (!gateway) {
      return jsonError("Não há outro método de pagamento disponível pra tentar.", 503);
    }

    // ✅ Defesa em profundidade (auditoria de fraude/duplicação, 24/08/2026):
    // nunca deixa cobrar de novo a licença de um app que JÁ foi pago e está
    // aguardando conclusão manual (status=approved, fulfillment_status=
    // manual_pending) — sem isso, um clique duplo (ou uma chamada direta à
    // API, pulando a UI) cobraria o cliente 2x pela mesma licença ainda não
    // entregue. O front já esconde essa opção (has_pending_manual_renewal
    // em apps/list/route.ts); isto aqui é a garantia do lado do servidor,
    // que vale pros dois gateways (Stripe e Mercado Pago) por rodar antes
    // de qualquer um dos dois branches abaixo.
    const { data: alreadyPending } = await supabaseAdmin
      .from("client_portal_payments")
      .select("id")
      .eq("tenant_id", ctx.tenant_id)
      .eq("client_id", client_id)
      .eq("client_app_id", client_app_id)
      .eq("payment_type", "app_renewal")
      .eq("status", "approved")
      .eq("fulfillment_status", "manual_pending")
      .limit(1)
      .maybeSingle();

    if (alreadyPending) {
      return jsonError("Você já pagou a renovação desse aplicativo — está aguardando conclusão. Fale com o suporte se precisar de ajuda.", 409);
    }

    // ======================
    // STRIPE (cliente USD/EUR)
    // ======================
    if (gateway.type === "stripe") {
      const secretKey = String(gateway?.config?.secret_key || "").trim();
      const publishableKey = String(gateway?.config?.publishable_key || "").trim();
      if (!secretKey || !publishableKey) return jsonError("Erro interno", 500);

      const stripeParams = new URLSearchParams();
      stripeParams.append("amount", String(Math.round(totalCharge * 100)));
      stripeParams.append("currency", currency.toLowerCase());
      stripeParams.append("payment_method_types[]", "card");
      stripeParams.append("description", withUsername(descricaoCobranca));
      stripeParams.append("metadata[client_id]", client_id);
      stripeParams.append("metadata[tenant_id]", String(ctx.tenant_id));
      stripeParams.append("metadata[client_app_id]", client_app_id);
      stripeParams.append("metadata[payment_type]", "app_renewal");
      stripeParams.append("metadata[gateway_id]", String(gateway.id));

      // ✅ Idempotência (achado em auditoria de fraude/duplicação,
      // 24/08/2026) — mesmo raciocínio do bloco Mercado Pago abaixo (janela
      // de 10min): sem isso, um retry de rede ou duplo-clique podia criar
      // um SEGUNDO PaymentIntent pra mesma licença.
      const stripeStableAmount = totalCharge.toFixed(2);
      const stripeBucket10m = Math.floor(Date.now() / (10 * 60 * 1000));
      const stripeIdempotencyKey = `apprenew-stripe-${ctx.tenant_id}-${client_app_id}-${bundleHash}-${stripeStableAmount}-${stripeBucket10m}`;

      const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": stripeIdempotencyKey,
        },
        body: stripeParams,
      });
      const stripeData = await stripeRes.json().catch(() => ({} as any));

      if (!stripeRes.ok || !stripeData?.id || !stripeData?.client_secret) {
        console.error("[apps/renew-payment] stripe error", stripeRes.status, stripeData?.error?.message);
        return jsonError("Falha ao criar pagamento no gateway", 502);
      }

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("client_portal_payments")
        .upsert(
          {
            tenant_id: ctx.tenant_id,
            client_id,
            gateway_type: gateway.type,
            payment_method: "online",
            mp_payment_id: String(stripeData.id),
            price_amount: chargeAmount,
            price_currency: currency,
            status: "pending",
            payment_type: "app_renewal",
            client_app_id,
            app_name_snapshot: appName,
            coupon_id: couponId,
            coupon_code: couponCode,
            coupon_discount_amount: couponDiscountAmount || null,
            bundled_app_renewals: bundledAppRenewals.length ? bundledAppRenewals : null,
            // ✅ 17/09/2026: quem de fato logou e pagou (titular ou secundário).
            payer_whatsapp_username: ctx.whatsapp_username,
          },
          { onConflict: "tenant_id,gateway_type,mp_payment_id" },
        )
        .select("id, mp_payment_id")
        .single();

      if (insErr || !inserted) {
        console.error("[apps/renew-payment] upsert error", insErr?.message);
        return jsonError("Erro interno", 500);
      }

      return NextResponse.json(
        {
          ok: true,
          payment_method: "stripe",
          gateway_name: gateway.name,
          gateway_type: gateway.type,
          has_alternate_gateway: gateways.length > 1,
          payment_id: String(stripeData.id),
          internal_payment_id: inserted.id,
          client_secret: stripeData.client_secret,
          publishable_key: publishableKey,
          price_amount: totalCharge,
          bundled_apps: bundledAppsForResponse,
          coupon_discount_amount: couponDiscountAmount || undefined,
          plan_price_only: fullTotal,
          currency,
          beneficiary_name: String(gateway?.config?.beneficiary_name || "").trim() || null,
          institution: String(gateway?.config?.institution || "").trim() || "Stripe",
        },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    // ======================
    // FASTDEPIX (FastPay / FastFlow) — DePix exige CPF/CNPJ do pagador, que
    // este fluxo ainda não coleta (ver docs/fiscal/nota-fiscal-reforma-
    // tributaria-2027.md), então nunca cai aqui pra esse tipo.
    // ======================
    if (isFastDepixGatewayType(gateway.type) && gateway.type !== "depix") {
      const apiKey = String(gateway?.config?.api_key || "").trim();
      if (!apiKey) return jsonError("Erro interno", 500);

      const appUrl = getAppOrigin();
      const notificationUrl = appUrl ? `${appUrl}/api/webhooks/fastdepix` : undefined;

      // ✅ Idempotência (mesmo raciocínio do bloco Mercado Pago abaixo, e do
      // create-payment/route.ts, 05/09/2026) — a API do FastDePix não tem
      // idempotency-key própria, então reaproveita um "pending" recente pra
      // essa mesma licença de app em vez de gerar uma segunda cobrança real.
      try {
        const { data: existingFdPending } = await supabaseAdmin
          .from("client_portal_payments")
          .select("id, mp_payment_id, coupon_id, bundled_app_renewals, price_amount")
          .eq("tenant_id", ctx.tenant_id)
          .eq("client_id", client_id)
          .eq("gateway_type", gateway.type)
          .eq("payment_type", "app_renewal")
          .eq("client_app_id", client_app_id)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // ✅ 08/09/2026: nunca reaproveita um pending criado ANTES de decidir
        // sobre o cupom (ex: recusou o popup, depois voltou e aceitou, ou
        // vice-versa) — senão devolveria o PIX antigo com o valor errado.
        // ✅ 30/09/2026: idem pra seleção do carrinho — outro conjunto de
        // apps = outro valor, nunca devolve o PIX antigo.
        if (
          existingFdPending &&
          ((existingFdPending as any).coupon_id !== couponId ||
            !sameBundle(existingFdPending) ||
            !sameTotal(existingFdPending))
        ) {
          // segue pro fluxo de criação normal, ignora este pending.
        } else if (existingFdPending?.mp_payment_id) {
          const existingTx = await getFastDepixTransaction(apiKey, existingFdPending.mp_payment_id);
          if (String(existingTx.status || "").toLowerCase() === "pending") {
            const qrBase64 = existingTx.qr_code ? await fetchQrCodeAsBase64(existingTx.qr_code) : null;
            return NextResponse.json(
              {
                ok: true,
                payment_method: "online",
                gateway_name: gateway.name,
          gateway_type: gateway.type,
          has_alternate_gateway: gateways.length > 1,
                payment_id: String(existingTx.id),
                internal_payment_id: existingFdPending.id,
                price_amount: totalCharge,
                bundled_apps: bundledAppsForResponse,
                coupon_discount_amount: couponDiscountAmount || undefined,
                plan_price_only: fullTotal,
                currency,
                pix_qr_code: existingTx.qr_code_text || undefined,
                pix_qr_code_base64: qrBase64 || undefined,
                expires_at: existingTx.qr_code_expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              },
              { status: 200, headers: NO_STORE_HEADERS },
            );
          }
        }
      } catch (e: any) {
        console.error("[apps/renew-payment] fastdepix idempotency check failed", e?.message);
      }

      try {
        const tx = await createFastDepixTransaction({
          apiKey,
          providerType: gateway.type,
          amount: Number(totalCharge),
          payerName: client?.server_username ? `${displayName} (${client.server_username})` : displayName,
          notificationUrl,
        });
        const qrBase64 = tx.qr_code ? await fetchQrCodeAsBase64(tx.qr_code) : null;

        const { data: inserted, error: insErr } = await supabaseAdmin
          .from("client_portal_payments")
          .upsert(
            {
              tenant_id: ctx.tenant_id,
              client_id,
              gateway_type: gateway.type,
              payment_method: "online",
              mp_payment_id: String(tx.id),
              price_amount: chargeAmount,
              price_currency: currency,
              status: "pending",
              payment_type: "app_renewal",
              client_app_id,
              app_name_snapshot: appName,
              coupon_id: couponId,
              coupon_code: couponCode,
              coupon_discount_amount: couponDiscountAmount || null,
              bundled_app_renewals: bundledAppRenewals.length ? bundledAppRenewals : null,
              // ✅ 17/09/2026: quem de fato logou e pagou.
              payer_whatsapp_username: ctx.whatsapp_username,
            },
            { onConflict: "tenant_id,gateway_type,mp_payment_id" },
          )
          .select("id, mp_payment_id")
          .single();

        if (insErr || !inserted) {
          console.error("[apps/renew-payment] upsert error", insErr?.message);
          return jsonError("Erro interno", 500);
        }

        return NextResponse.json(
          {
            ok: true,
            payment_method: "online",
            gateway_name: gateway.name,
          gateway_type: gateway.type,
          has_alternate_gateway: gateways.length > 1,
            payment_id: String(tx.id),
            internal_payment_id: inserted.id,
            price_amount: totalCharge,
            bundled_apps: bundledAppsForResponse,
            coupon_discount_amount: couponDiscountAmount || undefined,
            plan_price_only: fullTotal,
            currency,
            pix_qr_code: tx.qr_code_text || undefined,
            pix_qr_code_base64: qrBase64 || undefined,
            expires_at: tx.qr_code_expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          },
          { status: 200, headers: NO_STORE_HEADERS },
        );
      } catch (fdErr: any) {
        console.error(`[apps/renew-payment] ${gateway.type} error`, fdErr?.message);
        return jsonError("Falha ao criar pagamento no gateway", 502);
      }
    }

    if (gateway.type !== "mercadopago") {
      return jsonError("Nenhum método de pagamento disponível pra licença de app no momento.", 503);
    }

    const mpToken = String(gateway?.config?.access_token || "").trim();
    if (!mpToken) return jsonError("Erro interno", 500);

    // ✅ A chave de idempotência do MP (mais abaixo) só cobre uma janela de
    // 10min — clicar "Renovar" de novo depois disso (ex: esqueceu que já
    // tinha gerado um QR e pagou os dois) criava uma SEGUNDA cobrança PIX
    // independente pra mesma licença de app. Antes de criar um pagamento
    // novo, confere se já existe um "pending" recente pra este
    // client_app_id e consulta o status real no MP: se ainda está pending
    // lá, devolve o MESMO QR em vez de gerar outro; se já foi pago/está em
    // processamento, bloqueia (evita pagar 2x); só cria um novo se o
    // anterior realmente morreu (cancelado/expirado/rejeitado no MP).
    const { data: existingPending } = await supabaseAdmin
      .from("client_portal_payments")
      .select("id, mp_payment_id, price_amount, price_currency, created_at, coupon_id, bundled_app_renewals")
      .eq("tenant_id", ctx.tenant_id)
      .eq("client_id", client_id)
      .eq("client_app_id", client_app_id)
      .eq("payment_type", "app_renewal")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPending?.mp_payment_id) {
      try {
        const getRes = await fetch(
          `https://api.mercadopago.com/v1/payments/${existingPending.mp_payment_id}`,
          { headers: { Authorization: `Bearer ${mpToken}` } },
        );
        const getData = await getRes.json().catch(() => ({} as any));

        // ✅ 08/09/2026: só reaproveita o QR se a decisão de cupom bater com
        // a atual (senão devolveria o PIX antigo com o valor errado) — mas o
        // bloqueio de "já aprovado/processando" abaixo continua valendo
        // SEMPRE, cupom ou não (nunca deixa criar um 2º pagamento em cima de
        // um que já pode ter sido cobrado de verdade no MP).
        // ✅ 30/09/2026: e a mesma seleção do carrinho (outro conjunto de
        // apps = outro valor).
        if (
          getRes.ok &&
          getData?.status === "pending" &&
          (existingPending as any).coupon_id === couponId &&
          sameBundle(existingPending) &&
          sameTotal(existingPending) &&
          Math.abs(Number(getData.transaction_amount ?? totalCharge) - totalCharge) < 0.01
        ) {
          return NextResponse.json(
            {
              ok: true,
              payment_method: "online",
              gateway_name: gateway.name,
              gateway_type: gateway.type,
              has_alternate_gateway: gateways.length > 1,
              payment_id: String(existingPending.mp_payment_id),
              internal_payment_id: existingPending.id,
              // valor REAL cobrado no MP (pai + filhos), não só a parte do pai
              price_amount: Number(getData.transaction_amount ?? totalCharge),
              bundled_apps: bundledAppsForResponse,
              coupon_discount_amount: couponDiscountAmount || undefined,
              plan_price_only: fullTotal,
              currency: existingPending.price_currency,
              pix_qr_code: getData.point_of_interaction?.transaction_data?.qr_code,
              pix_qr_code_base64: getData.point_of_interaction?.transaction_data?.qr_code_base64,
              expires_at: getData.date_of_expiration,
            },
            { status: 200, headers: NO_STORE_HEADERS },
          );
        }

        if (getRes.ok && (getData?.status === "approved" || getData?.status === "in_process")) {
          return jsonError("Este pagamento já está sendo processado. Aguarde a confirmação.", 409);
        }

        // ✅ 30/09/2026: o PIX anterior ainda está pagável mas é de OUTRA
        // seleção (outro carrinho ou outra decisão de cupom) — cancela no
        // MP antes de gerar o novo, senão os dois ficavam pagáveis e o
        // cliente podia pagar a mesma licença 2x. Falhou? segue como era
        // (o antigo expira sozinho em 30min).
        if (getRes.ok && getData?.status === "pending") {
          try {
            const cancelRes = await fetch(
              `https://api.mercadopago.com/v1/payments/${existingPending.mp_payment_id}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpToken}` },
                body: JSON.stringify({ status: "cancelled" }),
              },
            );
            if (cancelRes.ok) {
              await supabaseAdmin
                .from("client_portal_payments")
                .update({ status: "cancelled" })
                .eq("id", existingPending.id)
                .eq("status", "pending");
            } else {
              console.error("[apps/renew-payment] cancel superseded MP payment failed", cancelRes.status);
            }
          } catch (e: any) {
            console.error("[apps/renew-payment] cancel superseded MP payment error", e?.message);
          }
        }
        // outros status (cancelled/rejected/expired) — pagamento anterior
        // realmente morreu, segue o fluxo normal e cria um novo abaixo.
      } catch (e) {
        // Falha ao consultar o MP não deve travar a renovação — segue o
        // fluxo normal (a idempotency key de 10min ainda cobre o caso mais
        // comum de duplo-clique).
        console.error("[apps/renew-payment] failed to check existing payment", (e as any)?.message);
      }
    }

    const appUrl = getAppOrigin();
    if (!appUrl) return jsonError("Erro interno", 500);
    const webhookUrl = `${appUrl}/api/webhooks/mercadopago`;

    const stableAmount = totalCharge.toFixed(2);
    const bucket10m = Math.floor(Date.now() / (10 * 60 * 1000));
    const idempotencyKey = `apprenew-${ctx.tenant_id}-${client_app_id}-${bundleHash}-${stableAmount}-${bucket10m}`;
    const internalPaymentId = randomUUID();

    const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: totalCharge,
        description: withUsername(descricaoCobranca),
        payment_method_id: "pix",
        statement_descriptor: "UNIGESTOR",
        binary_mode: true,
        payer: {
          email: `${sanitizeEmailLocalPart(ctx.whatsapp_username)}@unigestor.net.br`,
          first_name: String(displayName).split(" ")[0],
          last_name: String(displayName).split(" ").slice(1).join(" ") || "Cliente",
        },
        notification_url: webhookUrl,
        external_reference: internalPaymentId,
        additional_info: {
          items: [
            {
              id: client_app_id,
              title: withUsername(`Licença — ${appName}`),
              description: `Renovação de licença do aplicativo ${appName}, cliente ${payerLabel}`,
              quantity: 1,
              unit_price: chargeAmount,
            },
            ...bundledAppRenewals.map((i) => ({
              id: i.client_app_id,
              title: withUsername(`Licença — ${i.app_name}`),
              description: `Renovação de licença do aplicativo ${i.app_name}, cliente ${payerLabel}`,
              quantity: 1,
              unit_price: i.price_amount,
            })),
          ],
        },
        metadata: {
          client_id,
          tenant_id: ctx.tenant_id,
          client_app_id,
          payment_type: "app_renewal",
          gateway_id: gateway.id,
          // ✅ 19/09/2026: aparece no relatório/API do Mercado Pago (coluna
          // METADATA) — quem pagou e de qual conta, sem abrir o painel.
          server_username: serverUsernameTag || null,
          payer_name: displayName,
          app_name: appName,
        },
        date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
    });

    const mpData = await mpResponse.json().catch(() => ({} as any));

    if (!mpResponse.ok || !mpData?.id) {
      console.error("[apps/renew-payment] gateway error", { status: mpResponse.status });
      return jsonError("Falha ao criar pagamento no gateway", 502);
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("client_portal_payments")
      .upsert(
        {
          id: internalPaymentId,
          tenant_id: ctx.tenant_id,
          client_id,
          gateway_type: gateway.type,
          payment_method: "online",
          mp_payment_id: String(mpData.id),
          price_amount: chargeAmount,
          price_currency: currency,
          status: "pending",
          payment_type: "app_renewal",
          client_app_id,
          app_name_snapshot: appName,
          coupon_id: couponId,
          coupon_code: couponCode,
          coupon_discount_amount: couponDiscountAmount || null,
          bundled_app_renewals: bundledAppRenewals.length ? bundledAppRenewals : null,
          // ✅ 17/09/2026: quem de fato logou e pagou.
          payer_whatsapp_username: ctx.whatsapp_username,
        },
        { onConflict: "tenant_id,gateway_type,mp_payment_id" },
      )
      .select("id, mp_payment_id")
      .single();

    if (insErr || !inserted) {
      console.error("[apps/renew-payment] upsert error", insErr?.message);
      return jsonError("Erro interno", 500);
    }

    return NextResponse.json(
      {
        ok: true,
        // ✅ 09/09/2026, achado do Márcio: esse bloco (MP "puro", criação
        // nova) nunca tinha esses campos — só os blocos Stripe/FastDePix e
        // o de reaproveitar pending já tinham. Por isso "Tentar outra
        // forma" nunca aparecia pagando só o app quando caía bem aqui.
        payment_method: "online",
        gateway_name: gateway.name,
        gateway_type: gateway.type,
        has_alternate_gateway: gateways.length > 1,
        payment_id: String(mpData.id),
        internal_payment_id: inserted.id,
        price_amount: totalCharge,
        bundled_apps: bundledAppsForResponse,
        coupon_discount_amount: couponDiscountAmount || undefined,
        plan_price_only: fullTotal,
        currency,
        pix_qr_code: mpData.point_of_interaction?.transaction_data?.qr_code,
        pix_qr_code_base64: mpData.point_of_interaction?.transaction_data?.qr_code_base64,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err: any) {
    console.error("[apps/renew-payment] unexpected", err?.message);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
