// app/api/whatsapp/billing-enqueue-now/route.ts
// ✅ 29/08/2026: botão "Rodar agora" da Automação de Cobranças — dispara o
// mesmo billing_enqueue_scheduled() que os pg_cron (6h/7h/12h) chamam, mas
// na hora, pra emergência (ex: o Márcio percebe que a fila está vazia e não
// quer esperar o próximo horário fixo). Sem SQL_SECRET/cron aqui — é
// autenticado como qualquer rota admin normal (requireAdminTenant).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminTenant } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sb = createClient(supabaseUrl, serviceKey);

  // Data de hoje em São Paulo (mesma convenção usada em billing_enqueue_scheduled).
  const fireDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const { data, error } = await sb.rpc("billing_enqueue_scheduled", {
    p_tenant_id: auth.tenant_id,
    p_fire_date: fireDate,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, created: data ?? 0 });
}
