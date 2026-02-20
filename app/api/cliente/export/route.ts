import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type ExportRow = {
  saudacao: string;
  nome_completo: string;
  telefone_principal: string;
  whatsapp_username: string;
  aceita_mensagem: string;

  servidor: string;
  usuario: string;
  senha: string;
  tecnologia: string;

  currency: string; // BRL | USD | EUR
  plano: string;
  telas: string;

  vencimento_dia: string;
  vencimento_hora: string;

  aplicativos_nome: string;
  obs: string;

  // ✅ novos
  valor_plano: string;       // price_amount
  tabela_preco: string;      // plan_tables.name (label)
  m3u_url: string;
  cadastro_dia: string;      // created_at (dia)
  cadastro_hora: string;     // created_at (hora)
};

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: ExportRow[]): string {
  const headers = [
    "Saudacao",
    "Nome Completo",
    "Telefone principal",
    "Whatsapp Username",
    "Aceita mensagem",
    "Servidor",
    "Usuario",
    "Senha",
    "Tecnologia",
    "Currency",
    "Plano",
    "Telas",
    "Vencimento dia",
    "Vencimento hora",
    "Aplicativos nome",
    "Obs",

    // ✅ novos (no final)
    "Valor Plano",
    "Tabela Preco",
    "M3U URL",
    "Data do cadastro",
    "Cadastro hora",
  ];

  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(";"));

  for (const r of rows) {
    lines.push(
      [
        r.saudacao,
        r.nome_completo,
        r.telefone_principal,
        r.whatsapp_username,
        r.aceita_mensagem,
        r.servidor,
        r.usuario,
        r.senha,
        r.tecnologia,
        r.currency,
        r.plano,
        r.telas,
        r.vencimento_dia,
        r.vencimento_hora,
        r.aplicativos_nome,
        r.obs,

        r.valor_plano,
        r.tabela_preco,
        r.m3u_url,
        r.cadastro_dia,
        r.cadastro_hora,
      ]
        .map(csvEscape)
        .join(";")
    );
  }

  return "\ufeff" + lines.join("\n");
}

function formatDiaHoraBR(iso: string | null | undefined) {
  if (!iso) return { dia: "", hora: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { dia: "", hora: "" };

  const dia = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);

  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

  return { dia, hora };
}

async function resolveTenantIdForUser(supabase: any, userId: string, tenantFromQuery: string | null) {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId);

  if (error) {
    return { tenant_id: null as string | null, status: 500, error: "tenant_lookup_failed", details: error.message };
  }

  const tenantIds = Array.from(
    new Set((data ?? []).map((r: any) => String(r.tenant_id || "")).filter(Boolean))
  );

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
      hint: "Você participa de múltiplos tenants. Informe tenant_id na querystring para exportar o tenant desejado.",
    };
  }

  if (!tenantIds.includes(tenantFromQuery)) {
    return { tenant_id: null, status: 403, error: "forbidden_tenant", hint: "tenant_id não pertence ao seu usuário." };
  }

  return { tenant_id: tenantFromQuery, status: 200 };
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

  const scope = (url.searchParams.get("scope") || "clients") as "clients" | "all";

  // clients
  let q = supabase
    .from("clients")
    .select([
      "id",
      "name_prefix",
      "display_name",
      "first_name",
      "last_name",
      "whatsapp_opt_in",
      "whatsapp_username",
      "server_id",
      "server_username",
      "server_password",
      "technology",
      "plan_label",
      "screens",
      "price_currency",
      "price_amount",
      "plan_table_id",
      "m3u_url",
      "vencimento",
      "notes",
      "is_trial",
      "created_at",
    ].join(","))
    .eq("tenant_id", tenant_id)
    .order("created_at", { ascending: false });

  if (scope !== "all") q = q.eq("is_trial", false);

  const { data: clients, error: cErr } = await q;
  if (cErr) return NextResponse.json({ error: "export_failed_clients", details: cErr.message }, { status: 500 });

  const clientRows = (clients ?? []) as any[];
  const clientIds = clientRows.map((c) => c.id);

  // sem clientes
  if (clientIds.length === 0) {
    const csv = toCsv([]);
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const filename = `clientes_${y}-${m}-${d}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // servers (id -> name)
  const { data: servers, error: sErr } = await supabase
    .from("servers")
    .select("id,name")
    .eq("tenant_id", tenant_id);

  if (sErr) {
    return NextResponse.json(
      { error: "export_failed_servers", details: sErr.message },
      { status: 500 }
    );
  }

  const serverNameById = new Map<string, string>();
  for (const s of (servers ?? []) as any[]) serverNameById.set(String(s.id), String(s.name ?? ""));

  // plan_tables (id -> name) + default por currency (pra preencher quando client.plan_table_id estiver null)
  const { data: planTables, error: ptErr } = await supabase
    .from("plan_tables")
    .select("id,name,currency,is_system_default")
    .eq("tenant_id", tenant_id);

  if (ptErr) {
    return NextResponse.json(
      { error: "export_failed_plan_tables", details: ptErr.message },
      { status: 500 }
    );
  }

  const planTableNameById = new Map<string, string>();
  const defaultPlanTableNameByCurrency = new Map<string, string>();

  for (const pt of (planTables ?? []) as any[]) {
    const id = String(pt.id);
    const name = String(pt.name ?? "");
    planTableNameById.set(id, name);

    if (pt.is_system_default) {
      const cur = String(pt.currency ?? "").toUpperCase();
      if (cur) defaultPlanTableNameByCurrency.set(cur, name);
    }
  }

  // apps por cliente
  const { data: clientApps, error: aErr } = await supabase
    .from("client_apps")
    .select("client_id, apps(name)")
    .in("client_id", clientIds);

  if (aErr) {
    return NextResponse.json({ error: "export_failed_apps", details: aErr.message }, { status: 500 });
  }

  const appsByClient = new Map<string, string[]>();
  for (const row of (clientApps ?? []) as any[]) {
    const cid = row.client_id;
    const appName = row.apps?.name;
    if (!cid || !appName) continue;
    const arr = appsByClient.get(cid) ?? [];
    arr.push(String(appName));
    appsByClient.set(cid, arr);
  }

  // telefone principal (best effort)
  const phoneByClient = new Map<string, string>();
  try {
    const { data: phones } = await supabase
      .from("client_phones")
      .select("client_id, phone_e164, is_primary")
      .in("client_id", clientIds);

    for (const p of (phones ?? []) as any[]) {
      if (!p.client_id) continue;
      const ph = p.phone_e164 ? String(p.phone_e164) : "";
      if (!ph) continue;

      if (p.is_primary || !phoneByClient.has(p.client_id)) {
        phoneByClient.set(p.client_id, ph);
      }
    }
  } catch {}

  const rows: ExportRow[] = clientRows.map((c) => {
    const nomeCompleto =
      (c.display_name && String(c.display_name).trim()) ||
      [c.first_name, c.last_name].filter(Boolean).join(" ").trim();

    const { dia: vencDia, hora: vencHora } = formatDiaHoraBR(c.vencimento ?? null);
    const { dia: cadDia, hora: cadHora } = formatDiaHoraBR(c.created_at ?? null);

    const apps = appsByClient.get(c.id) ?? [];
    const appsUnique = Array.from(new Set(apps)).join(", ");

    const serverName = serverNameById.get(c.server_id) ?? "";

    const cur = String(c.price_currency ?? "BRL").toUpperCase();
    const planTableLabel =
      (c.plan_table_id ? planTableNameById.get(String(c.plan_table_id)) : null) ||
      defaultPlanTableNameByCurrency.get(cur) ||
      "";

    return {
      saudacao: c.name_prefix ?? "",
      nome_completo: nomeCompleto ?? "",
      telefone_principal: phoneByClient.get(c.id) ?? "",
      whatsapp_username: c.whatsapp_username ?? "",
      aceita_mensagem: c.whatsapp_opt_in ? "Sim" : "Não",

      servidor: serverName,
      usuario: c.server_username ?? "",
      senha: c.server_password ?? "",
      tecnologia: c.technology ?? "",

      currency: cur,
      plano: c.plan_label ?? "",
      telas: String(c.screens ?? ""),

      vencimento_dia: vencDia,
      vencimento_hora: vencHora,

      aplicativos_nome: appsUnique,
      obs: c.notes ?? "",

      valor_plano: c.price_amount === null || c.price_amount === undefined ? "" : String(c.price_amount),
      tabela_preco: planTableLabel,
      m3u_url: c.m3u_url ?? "",
      cadastro_dia: cadDia,
      cadastro_hora: cadHora,
    };
  });

  const csv = toCsv(rows);

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const filename = `clientes_${y}-${m}-${d}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}