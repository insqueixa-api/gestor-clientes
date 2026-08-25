// app/api/integrations/appativa/list-apps/route.ts
//
// Busca o catálogo completo de aplicativos disponíveis na Appativa (GET
// /api/listar-aplicativos, paginado — limite de 200/página do lado deles).
// Usado pelo botão "Aplicativos disponíveis" na aba Parceiros, pra o Márcio
// comparar/ajustar os nomes do catálogo dele (apps.name) contra o nome de
// lá (achado 24/08/2026: "pra que possamos bater certinho e sem erro").
//
// ⚠️ O "id" de cada item aqui é o valor que a Appativa espera no campo
// app_uuid de Solicitação/Reenvio de Ativação — NÃO o "uuid" do item (esse
// só serve como filtro deste endpoint). Ver comentário na doc deles.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

const PAGE_LIMIT = 200; // ✅ máximo aceito pela API deles

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id } = auth;

  const body = await req.json().catch(() => ({} as any));
  const integration_id = String(body?.integration_id || "").trim();
  if (!integration_id) {
    return NextResponse.json({ ok: false, error: "integration_id é obrigatório" }, { status: 400 });
  }

  const { data: integration, error: fetchErr } = await supabase
    .from("api_integrations")
    .select("id, tenant_id, provider, api_key")
    .eq("id", integration_id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  if (fetchErr || !integration) {
    return NextResponse.json({ ok: false, error: "Parceiro não encontrado" }, { status: 404 });
  }

  if (integration.provider !== "APPATIVA") {
    return NextResponse.json({ ok: false, error: "Parceiro não suporta catálogo de aplicativos" }, { status: 400 });
  }

  const apiKey = String(integration.api_key || "").trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Chave de API não cadastrada para este parceiro" }, { status: 400 });
  }

  try {
    const items: { id: string; uuid: string; nome: string; valor: number }[] = [];
    let page = 1;
    let hasMore = true;

    // ✅ Segurança contra loop infinito se has_more nunca virar false por
    // algum motivo do lado deles — 50 páginas * 200 = 10.000 apps, bem
    // acima de qualquer catálogo real.
    while (hasMore && page <= 50) {
      const res = await fetch(
        `https://api.ativeapp.com/api/listar-aplicativos?page=${page}&limit=${PAGE_LIMIT}`,
        { headers: { "X-API-Key": apiKey }, cache: "no-store" },
      );
      const data = await res.json().catch(() => ({} as any));

      if (!res.ok || data?.sucesso !== true) {
        return NextResponse.json(
          { ok: false, error: data?.erro || data?.message || "Falha ao consultar catálogo" },
          { status: 502 },
        );
      }

      for (const it of data.items || []) {
        items.push({
          id: String(it.id ?? ""),
          uuid: String(it.uuid ?? ""),
          nome: String(it.aplicativos ?? ""),
          valor: Number(it.valor ?? 0),
        });
      }

      hasMore = !!data.has_more;
      page += 1;
    }

    items.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));

    return NextResponse.json({ ok: true, items, total: items.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Falha ao conectar com a API da Appativa" }, { status: 502 });
  }
}
