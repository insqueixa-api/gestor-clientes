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
import { notify, formatClientLabel } from "@/lib/notifications/notify";
import { APP_FIELD_LABELS, AppFieldType } from "@/lib/apps/field-types";

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
      .select("id, field_values, apps(name, integration_type, fields_config)")
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

    // Idempotente: se já existe um pedido pendente pra esse app, não duplica.
    const { data: existing } = await supabaseAdmin
      .from("client_app_requests")
      .select("id")
      .eq("client_app_id", client_app_id)
      .eq("action", "setup")
      .eq("status", "pending")
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, data: { id: existing.id, already_pending: true } }, { status: 200, headers: NO_STORE_HEADERS });
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("client_app_requests")
      .insert({
        tenant_id: ctx.tenant_id,
        client_id,
        client_app_id,
        app_name: appName,
        fields_snapshot: row.field_values || {},
        action: "setup",
        status: "pending",
      })
      .select("id")
      .single();

    if (insErr || !inserted) return jsonError("Erro interno", 500);

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("display_name, server_username, servers(name)")
      .eq("id", client_id)
      .maybeSingle();

    await notify({
      tenantId: ctx.tenant_id,
      type: "app_setup_pending",
      title: "📱 Configuração de app solicitada",
      message: `${formatClientLabel(client?.display_name, client?.server_username, (client?.servers as any)?.name)} pediu ajuda pra configurar "${appName}" pelo portal.`,
      link: "/admin/auditoria?view=aplicativos",
      sourceId: inserted.id,
    });

    return NextResponse.json({ ok: true, data: { id: inserted.id, already_pending: false } }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
