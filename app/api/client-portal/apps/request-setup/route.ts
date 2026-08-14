// app/api/client-portal/apps/request-setup/route.ts
// Bloco 3 do portal — "Solicitar configuração" para apps SEM integração
// automática (integration_type null, ou handler com useApi:false como o
// IboSol hoje bloqueado por Cloudflare). Cria um pedido em
// client_app_requests + notifica o admin (sino); ele resolve manualmente
// (extensão/painel do parceiro) e marca "Concluído" na Auditoria — aba
// "Aplicativos".
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";
import { APP_FIELD_LABELS, AppFieldType } from "@/lib/apps/field-types";
import { fileAppSetupRequest } from "@/lib/apps/portal-app-requests";

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
    const client_app_id = normalizeStr(body?.client_app_id);

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    if (!client_app_id) return jsonError("client_app_id é obrigatório", 400);

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("client_apps")
      .select("id, field_values, apps(name, integration_type, fields_config, cost_type)")
      .eq("id", client_app_id)
      .eq("client_id", client_id)
      .single();
    if (rowErr || !row) return jsonError("Aplicativo não encontrado", 404);

    const appName = (row as any).apps?.name || "Aplicativo";
    const integrationType = String((row as any).apps?.integration_type || "").trim().toUpperCase();
    const handler = integrationType ? getIntegrationHandler(integrationType) : null;
    const hasWorkingIntegration = !!handler && (handler as any).useApi;

    if (hasWorkingIntegration) {
      return jsonError("Esse aplicativo já configura sozinho — use o botão Reconfigurar.", 400);
    }

    // ✅ Defesa em profundidade (31/07/2026, pedido do Márcio): pedido de
    // configuração ao suporte só existe pra app PAGO — parceria/gratuito sem
    // integração é 100% self-service, o cliente configura sozinho olhando os
    // dados/instruções na tela, nunca deveria virar pendência no log do
    // admin. O botão já não aparece pra esses no portal (RenewBetaClient),
    // isso aqui é só a trava do lado do servidor pra não confiar só na UI.
    if ((row as any).apps?.cost_type !== "paid") {
      return jsonError("Esse aplicativo é self-service — configure direto no app, sem precisar do suporte.", 400);
    }

    // ✅ Mesma trava que o portal já faz antes de chamar essa rota (evita
    // pedir ajuda do suporte com os campos ainda vazios) — replicada aqui
    // como defesa em profundidade, mesmo padrão do resto do projeto.
    const fieldsConfig = Array.isArray((row as any).apps?.fields_config) ? (row as any).apps.fields_config : [];
    const vals = row.field_values || {};
    const missingLabels = fieldsConfig
      .filter((f: any) => f && f.id && f.type !== "obs" && f.type !== "date")
      .filter((f: any) => !String(vals[f.id] ?? vals[f.label] ?? "").trim())
      .map((f: any) => APP_FIELD_LABELS[f.type as AppFieldType] || f.label || f.id);

    if (missingLabels.length > 0) {
      return jsonError(`Preencha antes de solicitar: ${missingLabels.join(", ")}.`, 400);
    }

    let result;
    try {
      result = await fileAppSetupRequest(supabaseAdmin, {
        tenantId: ctx.tenant_id,
        clientId: client_id,
        clientAppId: client_app_id,
        appName,
        fieldValues: row.field_values,
      });
    } catch {
      return jsonError("Erro interno", 500);
    }

    return NextResponse.json({ ok: true, data: result }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
