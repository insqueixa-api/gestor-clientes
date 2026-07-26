// app/api/client-portal/apps/update-fields/route.ts
// Salva os campos editáveis de um client_apps já instalado — só isso, sem
// chamar painel de parceiro nenhum (isso é o /configure). Update de 1
// linha por id, nunca o padrão delete-all-then-reinsert do admin.
import { NextRequest, NextResponse, after } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { APP_FIELD_LABELS, HIDDEN_CLIENT_FIELD_TYPES, AppFieldType, normalizeMacInput } from "@/lib/apps/field-types";
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
    const client_app_id = normalizeStr(body?.client_app_id);
    const fields = body?.fields && typeof body.fields === "object" ? body.fields : {};

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    if (!client_app_id) return jsonError("client_app_id é obrigatório", 400);

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("client_apps")
      .select("id, field_values, apps(name, fields_config)")
      .eq("id", client_app_id)
      .eq("client_id", client_id)
      .single();

    if (rowErr || !row) return jsonError("Aplicativo não encontrado", 404);

    const config: any[] = Array.isArray((row as any).apps?.fields_config) ? (row as any).apps.fields_config : [];
    const editableIds = new Set(
      config
        .filter((f: any) => f?.id && f.type !== "date" && !HIDDEN_CLIENT_FIELD_TYPES.includes(f.type as AppFieldType))
        .map((f: any) => String(f.id)),
    );
    const typeById = new Map(config.map((f: any) => [String(f.id), String(f.type || "")]));

    const nextVals = { ...(row.field_values || {}) };
    const changedKeys: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (!editableIds.has(key)) continue; // ignora silenciosamente campos ocultos/inexistentes
      const type = typeById.get(key);
      const normalized = type === "mac" ? normalizeMacInput(String(value ?? "")) : String(value ?? "").trim();
      if (normalized !== (nextVals[key] ?? "")) changedKeys.push(key);
      nextVals[key] = normalized;
    }

    const { error: updErr } = await supabaseAdmin
      .from("client_apps")
      .update({ field_values: nextVals })
      .eq("id", client_app_id);

    if (updErr) return jsonError("Erro interno", 500);

    if (changedKeys.length > 0) {
      // ✅ Grava o LABEL do campo (ex: "Device ID (MAC)"), não o id cru
      // (ex: "f_9mpc3") — pedido do Márcio (26/07/2026): a auditoria
      // mostrava só o id, ilegível sem abrir o catálogo do app.
      const labelById = new Map(
        config.map((f: any) => [String(f.id), (APP_FIELD_LABELS as any)[f.type] || f.label || String(f.id)]),
      );
      const changedLabels = changedKeys.map((k) => labelById.get(k) || k);
      after(() =>
        logAppActivity(supabaseAdmin, {
          tenantId: ctx.tenant_id,
          clientId: client_id,
          clientAppId: client_app_id,
          appName: (row as any).apps?.name || "Aplicativo",
          event: "fields_updated",
          detail: { fields: changedLabels },
        }),
      );
    }

    return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
