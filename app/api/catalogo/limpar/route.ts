// app/api/catalogo/limpar/route.ts
//
// POST → limpa títulos que não apareceram no último sync de cada servidor
//   body: { servidor: "ELITE" | "NATV" | "FAST" | "TODOS" }
//
// Lógica:
//   1. Para cada servidor, pega o MAX(sincronizado_em)
//   2. Deleta catalog_availability onde sincronizado_em < max
//   3. Deleta catalog_master sem nenhuma availability (órfãos)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SERVIDORES = ["ELITE", "NATV", "FAST"] as const;
type Servidor = typeof SERVIDORES[number];

export async function GET() {
  // Retorna preview: quantos seriam deletados por servidor
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

    const { count } = await supabaseAdmin
      .from("catalog_availability")
      .select("*", { count: "exact", head: true })
      .eq("servidor", srv)
      .lt("sincronizado_em", maxRow.sincronizado_em);

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

    // 2. Deleta availability desatualizados
    const { count } = await supabaseAdmin
      .from("catalog_availability")
      .delete()
      .eq("servidor", srv)
      .lt("sincronizado_em", maxRow.sincronizado_em);

    resultado[srv] = count || 0;
  }

  // 3. Deleta órfãos do catalog_master
  const { data: orfaos } = await supabaseAdmin
    .from("catalog_master")
    .select("id")
    .limit(1000);

  let orfaosRemovidos = 0;
  for (const row of orfaos || []) {
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