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

function calcularCorte(ultimoSync: string): Date {
  // Corte = 1 hora antes do último sync (títulos que não apareceram nesse sync)
  const corte = new Date(ultimoSync);
  corte.setHours(corte.getHours() - 1);
  return corte;
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

const corte = calcularCorte(maxRow.sincronizado_em);

    const { count } = await supabaseAdmin
      .from("catalog_availability")
      .select("*", { count: "exact", head: true })
      .eq("servidor", srv)
      .lt("sincronizado_em", corte.toISOString());

    preview[srv] = count || 0;
  }

  return NextResponse.json({ ok: true, preview });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const isCron = authHeader === `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}))
  const { servidor } = body
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
    const corte = calcularCorte(maxRow.sincronizado_em);

    // 3. Conta antes de deletar
    const { count: countAntes } = await supabaseAdmin
      .from("catalog_availability")
      .select("*", { count: "exact", head: true })
      .eq("servidor", srv)
      .lt("sincronizado_em", corte.toISOString());

    // 4. Deleta
    const { error } = await supabaseAdmin
      .from("catalog_availability")
      .delete()
      .eq("servidor", srv)
      .lt("sincronizado_em", corte.toISOString());

    if (error) {
      console.error(`[LIMPAR] Erro ao deletar ${srv}:`, error.message);
      resultado[srv] = 0;
    } else {
      resultado[srv] = countAntes || 0;
    }
  }

  // 4. Remove órfãos via RPC — uma query só
  const { data: orfaosData } = await supabaseAdmin.rpc("remover_master_orfaos");
  const orfaosRemovidos = orfaosData || 0;

  return NextResponse.json({ ok: true, resultado, orfaos_removidos: orfaosRemovidos });
}