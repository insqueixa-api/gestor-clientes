import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/aplicativos/check
 * Diagnóstico: mostra configuração do app Duplex/Duplecast no banco.
 * Remova ou proteja após uso.
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ ok: false, error: "Token inválido." }, { status: 401 });

    // 1. App no catálogo
    const { data: apps, error: appsErr } = await supabaseAdmin
      .from("apps")
      .select("id, name, fields_config, info_url, is_active, tenant_id")
      .or("name.ilike.%duplex%,name.ilike.%duplecast%");

    if (appsErr) return NextResponse.json({ ok: false, error: appsErr.message }, { status: 500 });

    // 2. client_apps vinculados
    const appIds = (apps || []).map((a: any) => a.id);
    let clientApps: any[] = [];

    if (appIds.length > 0) {
      const { data: ca, error: caErr } = await supabaseAdmin
        .from("client_apps")
        .select("id, client_id, app_id, field_values, clients ( client_name, username )")
        .in("app_id", appIds)
        .limit(20);

      if (caErr) return NextResponse.json({ ok: false, error: caErr.message }, { status: 500 });
      clientApps = ca || [];
    }

    // 3. Resumo legível
    const summary = clientApps.map((ca: any) => {
      const fv = (ca.field_values || {}) as Record<string, string>;
      return {
        client_id:  ca.client_id,
        client_name:(ca.clients as any)?.client_name || "—",
        username:   (ca.clients as any)?.username    || "—",
        app_id:     ca.app_id,
        fields_raw: fv,
        mac:        fv["mac"]        || fv["device_id"]   || fv["mac_address"] || null,
        device_key: fv["device_key"] || fv["key"]         || null,
        obs:        fv["obs"]        || fv["note"]         || null,
        blesta_sid: fv["blesta_sid"] || fv["session"]      || fv["cookie"]     || null,
      };
    });

    return NextResponse.json({
      ok: true,
      apps_catalog: apps,
      client_apps_count: clientApps.length,
      client_apps: summary,
    });

  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
