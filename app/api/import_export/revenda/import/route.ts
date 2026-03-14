import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

// --- HELPERS ---
function normalizeHeader(h: string) {
  return (h || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function normText(v: any): string {
  return (v ?? "").toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizePhone(raw: string) {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

async function resolveTenantIdForUser(supabase: any, userId: string, tenantFromQuery: string | null) {
  const { data, error } = await supabase.from("tenant_members").select("tenant_id").eq("user_id", userId);
  if (error) return { tenant_id: null as string | null, status: 500, error: "tenant_lookup_failed", details: error.message };

  const tenantIds = Array.from(new Set((data ?? []).map((r: any) => String(r.tenant_id || "")).filter(Boolean))) as string[];
  if (tenantIds.length === 0) return { tenant_id: null, status: 400, error: "tenant_id_missing", hint: "Sem tenant." };
  if (tenantIds.length === 1) {
    if (tenantFromQuery && tenantFromQuery !== tenantIds[0]) return { tenant_id: null, status: 403, error: "forbidden_tenant", hint: "Inválido" };
    return { tenant_id: tenantIds[0], status: 200 };
  }
  if (!tenantFromQuery) return { tenant_id: null, status: 400, error: "tenant_required", hint: "Informe tenant_id." };
  if (!tenantIds.includes(tenantFromQuery)) return { tenant_id: null, status: 403, error: "forbidden_tenant", hint: "Inválido" };
  
  return { tenant_id: tenantFromQuery, status: 200 };
}

// Colunas fixas obrigatórias do Revendedor
const REQUIRED_HEADERS = ["nome", "whatsapp"];

export async function POST(req: Request) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const tenantFromQuery = url.searchParams.get("tenant_id");

  const resolved = await resolveTenantIdForUser(supabase, user.id, tenantFromQuery);
  if (!resolved.tenant_id) {
    return NextResponse.json({ error: resolved.error, hint: (resolved as any).hint }, { status: resolved.status || 400 });
  }
  const tenant_id = resolved.tenant_id;

  // --- Lê o arquivo ---
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_missing", hint: "Envie multipart/form-data com campo 'file'." }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
  
  const dataRows = allRows.filter((r: any[]) => {
    const first = String(r[0] ?? "").trim();
    if (!first) return false; 
    if (first.startsWith("⚠️") || first.startsWith("•")) return false; 
    return true;
  });

  if (dataRows.length < 2) return NextResponse.json({ error: "empty_file", hint: "Sem dados." }, { status: 400 });

  const headers = (dataRows[0] as any[]).map(String);
  const rows = dataRows.slice(1) as any[][];

  const colIndex = new Map<string, number>();
  headers.forEach((h, idx) => colIndex.set(normalizeHeader(h), idx));

  const missing = REQUIRED_HEADERS.filter((h) => !colIndex.has(h));
  if (missing.length) {
    return NextResponse.json({ error: "invalid_headers", missing, hint: "Faltam colunas obrigatórias." }, { status: 400 });
  }

  const getCell = (row: any[], key: string): string => {
    const idx = colIndex.get(normalizeHeader(key));
    if (idx === undefined) return "";
    return (row[idx] ?? "").toString().trim();
  };

  // --- Pré-carrega Servidores (nome -> id) ---
  const { data: serversData, error: srvErr } = await supabase
    .from("servers")
    .select("id, name")
    .eq("tenant_id", tenant_id);

  if (srvErr) return NextResponse.json({ error: "servers_lookup_failed", details: srvErr.message }, { status: 500 });

  const serverIdByName = new Map<string, string>();
  for (const s of (serversData ?? []) as any[]) {
    serverIdByName.set(normText(s.name), String(s.id));
  }

  let inserted = 0;
  const rowErrors: Array<{ row: number; error: string }> = [];
  const warnings: Array<{ row: number; warning: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    try {
      const nome = getCell(row, "Nome");
      const rawPhone = getCell(row, "WhatsApp");
      const email = getCell(row, "E-mail");
      const username = getCell(row, "Username WhatsApp");
      const notes = getCell(row, "Observacoes");

      if (!nome || !rawPhone) {
        throw new Error("Nome e WhatsApp são obrigatórios.");
      }

      const phoneE164 = normalizePhone(rawPhone);

      // --- Validação Severa de Servidores (TRAVA SE ERRAR) ---
      const serversToLink: any[] = [];
      let rowHasServerError = false;

      for (let s = 1; s <= 5; s++) {
        const srvName = getCell(row, `Servidor ${s} Nome`);
        const srvUser = getCell(row, `Servidor ${s} Usuario`);
        const srvPass = getCell(row, `Servidor ${s} Senha`);

        if (srvName) {
          const srvId = serverIdByName.get(normText(srvName));
          if (!srvId) {
            rowErrors.push({ row: rowNum, error: `Servidor "${srvName}" não encontrado. Revenda não importada.` });
            rowHasServerError = true;
            break;
          }
          if (!srvUser) {
            rowErrors.push({ row: rowNum, error: `Servidor "${srvName}" preenchido sem Usuário correspondente. Revenda não importada.` });
            rowHasServerError = true;
            break;
          }
          serversToLink.push({ id: srvId, username: srvUser, password: srvPass });
        }
      }

      // Se deu erro em qualquer servidor dessa linha, pula para a próxima linha do Excel
      if (rowHasServerError) continue; 

      // --- CRIAÇÃO DO REVENDEDOR (Usando a sua RPC) ---
      const { data: newReseller, error: createErr } = await supabase.rpc("create_reseller_and_setup", {
        p_tenant_id: tenant_id,
        p_display_name: nome,
        p_email: email || null,
        p_notes: notes || null,
        p_phone_primary_e164: phoneE164,
        p_whatsapp_opt_in: true, // ✅ Forçado conforme instrução
        p_whatsapp_username: username || null,
        p_whatsapp_snooze_until: null,
      });

      if (createErr) throw new Error(createErr.message);

      // A RPC pode retornar o ID diretamente ou um objeto
      const resellerId = String((newReseller as any)?.reseller_id ?? (newReseller as any)?.id ?? newReseller);

      // --- VINCULAÇÃO DOS SERVIDORES ---
      for (const srv of serversToLink) {
        const { error: linkErr } = await supabase.from("reseller_servers").insert({
          tenant_id: tenant_id,
          reseller_id: resellerId,
          server_id: srv.id,
          server_username: srv.username,
          server_password: srv.password || null,
        });
        
        // Ignora erro 23505 (já existe), mas loga outros
        if (linkErr && linkErr.code !== '23505') { 
          warnings.push({ row: rowNum, warning: `Revenda criada, mas falhou ao vincular servidor "${srv.username}": ${linkErr.message}` });
        }
      }

      inserted++;
    } catch (e: any) {
      rowErrors.push({ row: rowNum, error: e?.message || "Falha ao processar linha." });
    }
  }

  return NextResponse.json({
    ok: rowErrors.length === 0,
    total: rows.length,
    inserted,
    errors: rowErrors,
    warnings,
  });
}