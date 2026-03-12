import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

// Labels fixos — espelha FIELD_LABELS do front
const FIELD_LABELS: Record<string, string> = {
  date:       "Vencimento",
  mac:        "Device ID (MAC)",
  device_key: "Device Key",
  email:      "E-mail",
  password:   "Senha",
  url:        "URL",
  obs:        "Obs",
};

// Colunas fixas que aparecem sempre no início
const FIXED_HEADERS = ["Cliente", "Usuario", "Servidor", "App"];

// Ordem das colunas de campos no export
const FIELD_TYPE_ORDER = ["date", "mac", "device_key", "email", "password", "url", "obs"];

async function resolveTenantIdForUser(
  supabase: any,
  userId: string,
  tenantFromQuery: string | null
) {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId);

  if (error) {
    return { tenant_id: null as string | null, status: 500, error: "tenant_lookup_failed", details: error.message };
  }

  const tenantIds = Array.from(
    new Set((data ?? []).map((r: any) => String(r.tenant_id || "")).filter(Boolean))
  ) as string[];

  if (tenantIds.length === 0) {
    return { tenant_id: null, status: 400, error: "tenant_id_missing", hint: "Seu usuário não está vinculado a um tenant." };
  }

  if (tenantIds.length === 1) {
    const only = tenantIds[0];
    if (tenantFromQuery && tenantFromQuery !== only) {
      return { tenant_id: null, status: 403, error: "forbidden_tenant", hint: "tenant_id não pertence ao seu usuário." };
    }
    return { tenant_id: only, status: 200 };
  }

  if (!tenantFromQuery) {
    return {
      tenant_id: null,
      status: 400,
      error: "tenant_required",
      hint: "Você participa de múltiplos tenants. Informe tenant_id na querystring.",
    };
  }

  if (!tenantIds.includes(tenantFromQuery)) {
    return { tenant_id: null, status: 403, error: "forbidden_tenant", hint: "tenant_id não pertence ao seu usuário." };
  }

  return { tenant_id: tenantFromQuery, status: 200 };
}

function buildXlsxResponse(rows: any[][], headers: string[], filename: string) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Aplicativos");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const tenantFromQuery = url.searchParams.get("tenant_id");

  const resolved = await resolveTenantIdForUser(supabase, user.id, tenantFromQuery);
  if (!resolved.tenant_id) {
    return NextResponse.json(
      { error: resolved.error, hint: (resolved as any).hint, details: (resolved as any).details },
      { status: resolved.status || 400 }
    );
  }
  const tenant_id = resolved.tenant_id;

  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const filename = `aplicativos_${y}-${mo}-${d}.xlsx`;

  const allHeaders = [...FIXED_HEADERS, ...FIELD_TYPE_ORDER.map((t) => FIELD_LABELS[t])];

  // 1. Busca apps do tenant com fields_config
  const { data: appsData, error: appsErr } = await supabase
    .from("apps")
    .select("id, name, fields_config")
    .eq("tenant_id", tenant_id);

  if (appsErr) {
    return NextResponse.json({ error: "export_failed_apps", details: appsErr.message }, { status: 500 });
  }

  const apps = (appsData ?? []) as { id: string; name: string; fields_config: { id: string; type: string }[] }[];

  if (apps.length === 0) {
    return buildXlsxResponse([], allHeaders, filename);
  }

  // Mapa appId -> { name, fieldsByType: Map<type, fieldId> }
  const appMap = new Map<string, { name: string; fieldsByType: Map<string, string> }>();
  for (const app of apps) {
    const fieldsByType = new Map<string, string>();
    for (const f of (app.fields_config ?? [])) {
      if (f.type && f.id) fieldsByType.set(f.type, f.id);
    }
    appMap.set(app.id, { name: app.name, fieldsByType });
  }

  // 2. Busca client_apps com field_values
  const appIds = apps.map((a) => a.id);

  const { data: clientAppsData, error: caErr } = await supabase
    .from("client_apps")
    .select("id, client_id, app_id, field_values")
    .eq("tenant_id", tenant_id)
    .in("app_id", appIds);

  if (caErr) {
    return NextResponse.json({ error: "export_failed_client_apps", details: caErr.message }, { status: 500 });
  }

  const clientApps = (clientAppsData ?? []) as {
    id: string;
    client_id: string;
    app_id: string;
    field_values: Record<string, string> | null;
  }[];

  if (clientApps.length === 0) {
    return buildXlsxResponse([], allHeaders, filename);
  }

  // 3. Busca clientes (display_name, server_username, server_id)
  const clientIds = Array.from(new Set(clientApps.map((ca) => ca.client_id)));

  const { data: clientsData, error: cliErr } = await supabase
    .from("clients")
    .select("id, display_name, first_name, last_name, server_username, server_id")
    .eq("tenant_id", tenant_id)
    .in("id", clientIds);

  if (cliErr) {
    return NextResponse.json({ error: "export_failed_clients", details: cliErr.message }, { status: 500 });
  }

  const clientMap = new Map<string, { nome: string; usuario: string; server_id: string }>();
  for (const c of (clientsData ?? []) as any[]) {
    const nome =
      (c.display_name && String(c.display_name).trim()) ||
      [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
    clientMap.set(String(c.id), {
      nome,
      usuario: c.server_username ?? "",
      server_id: c.server_id ?? "",
    });
  }

  // 4. Busca servidores (id -> name)
  const { data: serversData, error: srvErr } = await supabase
    .from("servers")
    .select("id, name")
    .eq("tenant_id", tenant_id);

  if (srvErr) {
    return NextResponse.json({ error: "export_failed_servers", details: srvErr.message }, { status: 500 });
  }

  const serverNameById = new Map<string, string>();
  for (const s of (serversData ?? []) as any[]) {
    serverNameById.set(String(s.id), String(s.name ?? ""));
  }

  // 5. Monta linhas — uma por client_app
  const dataRows: string[][] = [];

  for (const ca of clientApps) {
    const client = clientMap.get(ca.client_id);
    const app = appMap.get(ca.app_id);
    if (!client || !app) continue;

    const serverName = serverNameById.get(client.server_id) ?? "";
    const fv = ca.field_values ?? {};

    // Para cada tipo fixo, resolve o valor via fieldId
    const fieldCols = FIELD_TYPE_ORDER.map((type) => {
      const fieldId = app.fieldsByType.get(type);
      if (!fieldId) return ""; // app não tem esse campo
      const raw = fv[fieldId] ?? "";
      // Formata data para DD/MM/AAAA se tipo date
      if (type === "date" && raw) {
        const dt = new Date(raw);
        if (!Number.isNaN(dt.getTime())) {
          return new Intl.DateTimeFormat("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).format(dt);
        }
      }
      return String(raw);
    });

    dataRows.push([client.nome, client.usuario, serverName, app.name, ...fieldCols]);
  }

  // Ordena por nome do cliente, depois app
  dataRows.sort((a, b) => {
    const nameComp = a[0].localeCompare(b[0], "pt-BR", { sensitivity: "base" });
    if (nameComp !== 0) return nameComp;
    return a[3].localeCompare(b[3], "pt-BR", { sensitivity: "base" });
  });

  return buildXlsxResponse(dataRows, allHeaders, filename);
}