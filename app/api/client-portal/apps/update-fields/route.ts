// app/api/client-portal/apps/update-fields/route.ts
// Salva os campos editáveis de um client_apps já instalado — só isso, sem
// chamar painel de parceiro nenhum (isso é o /configure). Update de 1
// linha por id, nunca o padrão delete-all-then-reinsert do admin.
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { HIDDEN_CLIENT_FIELD_TYPES, AppFieldType, normalizeMacInput } from "@/lib/apps/field-types";

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
      .select("id, field_values, apps(fields_config)")
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
    for (const [key, value] of Object.entries(fields)) {
      if (!editableIds.has(key)) continue; // ignora silenciosamente campos ocultos/inexistentes
      const type = typeById.get(key);
      nextVals[key] = type === "mac" ? normalizeMacInput(String(value ?? "")) : String(value ?? "").trim();
    }

    const { error: updErr } = await supabaseAdmin
      .from("client_apps")
      .update({ field_values: nextVals })
      .eq("id", client_app_id);

    if (updErr) return jsonError("Erro interno", 500);

    return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
