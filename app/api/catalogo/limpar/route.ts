// app/api/catalogo/limpar/route.ts
//
// GET  → preview: quantos seriam deletados por servidor
// POST → executa limpeza: remove títulos que não apareceram no último sync
//
// Lógica D-1:
//   - Pega o MAX(sincronizado_em) de cada servidor
//   - Deleta tudo com sincronizado_em anterior à meia-noite do dia anterior ao último sync
//   - Remove órfãos do catalog_master

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SERVIDORES = ["ELITE", "NATV", "FAST"] as const;
type Servidor = typeof SERVIDORES[number];

function calcularD1(ultimoSync: string): Date {
  const d1 = new Date(ultimoSync);
  d1.setDate(d1.getDate() - 1);
  d1.setHours(0, 0, 0, 0);
  return d1;
}

export async function GET() {
  const preview: Record<string, number> = {};

  for (const srv of SERVIDORES) {
    const { data: maxRow } = await supabaseAdmin
      .from("catalog_availability")
      .select("sincronizado_em")
      .eq("servidor", srv)
      .order("sincronizado_em", { ascending: false })
      .limit(1)
      .single();

    if (!maxRow?.sincronizado_em) { preview[srv] = 0; continue; }

    const d1 = calcularD1(maxRow.sincronizado_em);

    const { count } = await supabaseAdmin
      .from("catalog_availability")
      .select("*", { count: "exact", head: true })
      .eq("servidor", srv)
      .lt("sincronizado_em", d1.toISOString());

    preview[srv] = count || 0;
  }

  return NextResponse.json({ ok: true, preview });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { servidor } = await req.json();
  if (!servidor) return NextResponse.json({ error: "servidor obrigatório" }, { status: 400 });

  const alvos: Servidor[] = servidor === "TODOS" ? [...SERVIDORES] : [servidor as Servidor];
  const resultado: Record<string, number> = {};

  for (const srv of alvos) {
    // 1. Pega o último sincronizado_em desse servidor
    const { data: maxRow } = await supabaseAdmin
      .from("catalog_availability")
      .select("sincronizado_em")
      .eq("servidor", srv)
      .order("sincronizado_em", { ascending: false })
      .limit(1)
      .single();

    if (!maxRow?.sincronizado_em) { resultado[srv] = 0; continue; }

    // 2. Calcula D-1 (meia-noite do dia anterior ao último sync)
    const d1 = calcularD1(maxRow.sincronizado_em);

    // 3. Deleta availability anteriores a D-1
    const { error } = await supabaseAdmin
      .from("catalog_availability")
      .delete()
      .eq("servidor", srv)
      .lt("sincronizado_em", d1.toISOString());

    if (error) {
      console.error(`[LIMPAR] Erro ao deletar ${srv}:`, error.message);
      resultado[srv] = 0;
    } else {
      resultado[srv] = 1; // deletou (count não disponível sem head:false)
    }
  }

  // 4. Remove órfãos do catalog_master em lotes
  let orfaosRemovidos = 0;
  const { data: todos } = await supabaseAdmin
    .from("catalog_master")
    .select("id")
    .limit(2000);

  for (const row of todos || []) {
    const { count } = await supabaseAdmin
      .from("catalog_availability")
      .select("*", { count: "exact", head: true })
      .eq("master_id", row.id);

    if (count === 0) {
      await supabaseAdmin.from("catalog_master").delete().eq("id", row.id);
      orfaosRemovidos++;
    }
  }

  return NextResponse.json({ ok: true, resultado, orfaos_removidos: orfaosRemovidos });
}