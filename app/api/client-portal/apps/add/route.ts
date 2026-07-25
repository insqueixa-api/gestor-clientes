// app/api/client-portal/apps/add/route.ts
// Bloco 3 do portal ("Meus aplicativos") — adiciona um app do catálogo do
// tenant à conta do cliente. Cria a linha client_apps vazia; o cliente
// preenche os campos e chama /configure separadamente (mesmo fluxo em 2
// passos do admin: adicionar → preencher → Configurar).
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";
import { logAppActivity } from "@/lib/apps/panel";

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

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);
    const app_id = normalizeStr(body?.app_id);

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    if (!app_id) return jsonError("app_id é obrigatório", 400);

    // ✅ Mesmo app pode ser adicionado mais de uma vez de propósito (pedido
    // do Marcio, 24/07/2026) — cliente pode ter 2 TVs da mesma marca ou 2
    // celulares Android, cada instalação com seu próprio MAC/Device Key.
    // Mesmo comportamento que o modal de cliente do admin já permite hoje.

    // ✅ Limite de 5 aplicativos por conta via self-service (pedido do
    // Marcio, 24/07/2026) — clientes que já tinham mais de 5 antes desse
    // limite continuam com os que já têm, só não conseguem adicionar mais
    // pelo portal. Precisar de mais é caso pra falar direto com o suporte.
    const MAX_APPS_PER_CLIENT = 5;
    const { count: installedCount } = await supabaseAdmin
      .from("client_apps")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client_id);
    if ((installedCount || 0) >= MAX_APPS_PER_CLIENT) {
      return jsonError(
        `Limite de ${MAX_APPS_PER_CLIENT} aplicativos por conta atingido. Fale com o suporte se precisar de mais.`,
        400,
      );
    }

    // Confirma que o app pertence ao catálogo do tenant e é compatível com
    // a tecnologia da conta (mesma trava de apps.technology/device_types)
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("technology")
      .eq("id", client_id)
      .single();

    const { data: app, error: appErr } = await supabaseAdmin
      .from("apps")
      .select("id, name, technology, integration_type, cost_type, partner_server_id")
      .eq("id", app_id)
      .eq("tenant_id", ctx.tenant_id)
      .maybeSingle();

    if (appErr || !app) return jsonError("Aplicativo não encontrado", 404);
    if (client?.technology && app.technology && client.technology !== app.technology) {
      return jsonError("Esse aplicativo não é compatível com a tecnologia dessa conta.", 400);
    }

    // ✅ Mesma trava do catalog/route.ts (defesa em profundidade — o catálogo
    // já esconde esses apps do seletor, mas essa rota não pode confiar só no
    // front): não deixa adicionar um app cuja integração está cadastrada mas
    // com useApi:false (ex: IBOSOL hoje, bloqueio Cloudflare).
    if (app.integration_type) {
      const handler = getIntegrationHandler(app.integration_type);
      if (!handler || !(handler as any).useApi) {
        return jsonError("Esse aplicativo não está disponível pra adicionar no momento.", 400);
      }
    }

    // ✅ Snapshot do custo no momento do add (igual o admin já faz em
    // novo_cliente.tsx) — sem isso, list/detail/check-validity nunca sabiam
    // se esse app era "parceria"/pago (field_values._config_cost sempre
    // vinha vazio pra apps adicionados pelo próprio cliente).
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("client_apps")
      .insert({
        client_id,
        tenant_id: ctx.tenant_id,
        app_id,
        field_values: {
          _config_cost: app.cost_type || "paid",
          _config_partner: app.partner_server_id || "",
        },
      })
      .select("id")
      .single();

    if (insertErr || !inserted) return jsonError("Erro interno", 500);

    await logAppActivity(supabaseAdmin, {
      tenantId: ctx.tenant_id,
      clientId: client_id,
      clientAppId: inserted.id,
      appName: app.name || "Aplicativo",
      event: "added",
    });

    return NextResponse.json({ ok: true, data: { id: inserted.id } }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
