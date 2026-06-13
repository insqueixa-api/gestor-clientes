// app/api/catalogo/titulo/route.ts
//
// DELETE → remove título de um servidor específico
//   body: { id: string, servidor: string }
//   Se ficar sem servidor → remove do catalog_master também

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, servidor } = await req.json();
  if (!id || !servidor) return NextResponse.json({ error: "id e servidor obrigatórios" }, { status: 400 });

  // 1. Remove do catalog_availability para esse servidor
  const { error: errAvail } = await supabaseAdmin
    .from("catalog_availability")
    .delete()
    .eq("master_id", id)
    .eq("servidor", servidor);

  if (errAvail) return NextResponse.json({ error: errAvail.message }, { status: 500 });

  // 2. Remove episódios desse servidor
  await supabaseAdmin
    .from("catalog_episodes")
    .delete()
    .eq("master_id", id)
    .eq("servidor", servidor);

  // 3. Se não tem mais nenhum servidor → remove do catalog_master
  const { count } = await supabaseAdmin
    .from("catalog_availability")
    .select("*", { count: "exact", head: true })
    .eq("master_id", id);

  if (count === 0) {
    await supabaseAdmin
      .from("catalog_master")
      .delete()
      .eq("id", id);
    return NextResponse.json({ ok: true, removido_master: true });
  }

  return NextResponse.json({ ok: true, removido_master: false });
}