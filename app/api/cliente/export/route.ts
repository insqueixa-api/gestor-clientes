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
};


function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Excel BR costuma aceitar melhor ; com BOM, mas ainda precisamos escapar.
  if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: ExportRow[]): string {
  const headers = [
  "Saudação",
  "Nome Completo",
  "Telefone principal",
  "Whatsapp Username",
  "Aceita mensagem",
  "Servidor",
  "Usuário",
  "Senha",
  "Tecnologia",
  "Moeda", // BRL | USD | EUR
  "Plano",
  "Telas",
  "Vencimento dia",
  "Vencimento hora",
  "Aplicativos nome",
  "Obs",
];


  const lines: string[] = [];
  lines.push(headers.join(";"));

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
  ]
    .map(csvEscape)
    .join(";")
);

  }

  // BOM ajuda o Excel a reconhecer UTF-8
  return "\ufeff" + lines.join("\n");
}

function formatDiaHoraBR(iso: string | null | undefined) {
  if (!iso) return { dia: "", hora: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { dia: "", hora: "" };

  // usando TZ do usuário (BR) como padrão do Gestor
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

async function resolveTenantIdFromMember(supabase: any, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;
  return data?.tenant_id ?? null;
}

export async function GET(req: Request) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);

  // Você pode manter tenant_id por querystring, mas agora também resolvemos automaticamente via tenant_members
  const tenantFromQuery = url.searchParams.get("tenant_id");
  const tenantFromMember = await resolveTenantIdFromMember(supabase, user.id);
  const tenant_id = tenantFromQuery || tenantFromMember;

  if (!tenant_id) {
    return NextResponse.json(
      { error: "tenant_id_missing", hint: "Não encontrei tenant_id (nem querystring nem tenant_members)." },
      { status: 400 }
    );
  }

  // scope padrão: só clientes (não trial). ?scope=all exporta tudo.
  const scope = (url.searchParams.get("scope") || "clients") as "clients" | "all";

  // 1) Buscar clients (sem IDs no CSV, mas precisamos internamente pra joins)
  let q = supabase
  .from("clients")
  .select(
  [
    "id",
    "tenant_id",
    "name_prefix",
    "display_name",
    "first_name",
    "last_name",
    "allow_whatsapp",
    "whatsapp_username",
    "server_id",
    "server_username",
    "server_password",
    "technology",
    "plan_label",
    "screens",
    "price_currency",
    "vencimento",
    "notes",
    "is_trial",
  ].join(",")
)


  .eq("tenant_id", tenant_id)
  .order("created_at", { ascending: false });


  if (scope !== "all") q = q.eq("is_trial", false);

  const { data: clients, error: cErr } = await q;

  if (cErr) {
    return NextResponse.json({ error: "export_failed_clients", details: cErr.message }, { status: 500 });
  }

  const clientRows = (clients ?? []) as any[];
  const clientIds = clientRows.map((c) => c.id);

  // ✅ sem clientes: exporta CSV só com header
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


  // 2) Map de servidores (id -> name)
  // (Se sua tabela tiver outro nome, me avisa que eu ajusto rapidinho)
  const { data: servers, error: sErr } = await supabase
    .from("servers")
    .select("id,name")
    .eq("tenant_id", tenant_id);

  if (sErr) {
    // Não derruba export, mas informa de forma clara
    return NextResponse.json(
      { error: "export_failed_servers", details: sErr.message, hint: "Confirme se a tabela é 'servers' e tem colunas id,name,tenant_id." },
      { status: 500 }
    );
  }

  const serverNameById = new Map<string, string>();
  for (const s of (servers ?? []) as any[]) {
    serverNameById.set(s.id, s.name ?? "");
  }

  
  // 3) Apps por cliente: client_apps -> apps (name)
  // Vamos buscar tudo em lote, depois agrupar.
  const { data: clientApps, error: aErr } = await supabase
    .from("client_apps")
    .select("client_id, apps(name)")
    .in("client_id", clientIds);

  if (aErr) {
    return NextResponse.json(
      { error: "export_failed_apps", details: aErr.message, hint: "Confirme o relacionamento client_apps.app_id -> apps.id está cadastrado no Supabase." },
      { status: 500 }
    );
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

  // 4) Telefone principal por cliente (best-effort)
  // Ajuste caso seus nomes sejam diferentes.
  const phoneByClient = new Map<string, string>();
  try {
    const { data: phones } = await supabase
  .from("client_phones")
  .select("client_id, phone_e164, is_primary")

  .in("client_id", clientIds);

  for (const p of (phones ?? []) as any[]) {
    if (!p.client_id) continue;
    const ph = p.phone_e164 ? String(p.phone_e164) : "";

    const isPrimary = !!p.is_primary;
    if (!ph) continue;

    // prioridade pro primário; senão, primeiro encontrado
    if (isPrimary || !phoneByClient.has(p.client_id)) {
      phoneByClient.set(p.client_id, ph);
    }
  }

  } catch {
    // ignora (best-effort)
  }

  // 5) Montar CSV final (PT-BR)
  const rows: ExportRow[] = clientRows.map((c) => {
    const nomeCompleto =
      (c.display_name && String(c.display_name).trim()) ||
      [c.first_name, c.last_name].filter(Boolean).join(" ").trim();

    const { dia, hora } = formatDiaHoraBR(c.vencimento ?? null);

    const apps = appsByClient.get(c.id) ?? [];
    const appsUnique = Array.from(new Set(apps)).join(", ");

    const serverName = serverNameById.get(c.server_id) ?? "";

    return {
      saudacao: c.name_prefix ?? "",
      nome_completo: nomeCompleto ?? "",
      telefone_principal: phoneByClient.get(c.id) ?? "",
      whatsapp_username: c.whatsapp_username ?? "",
      aceita_mensagem: c.allow_whatsapp ? "Sim" : "Não",

      servidor: serverName,
      usuario: c.server_username ?? "",
      senha: c.server_password ?? "",
      tecnologia: c.technology ?? "",

      currency: c.price_currency ?? "BRL",



      plano: c.plan_label ?? "",
      telas: String(c.screens ?? ""),

      vencimento_dia: dia,
      vencimento_hora: hora,

      aplicativos_nome: appsUnique,
      obs: c.notes ?? "",
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
