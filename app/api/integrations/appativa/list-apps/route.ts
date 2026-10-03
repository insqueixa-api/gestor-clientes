// app/api/integrations/appativa/list-apps/route.ts
//
// Catálogo completo de aplicativos disponíveis na Appativa. Usado pelo
// botão "Aplicativos disponíveis" na aba Parceiros, pra o Márcio
// comparar/ajustar os nomes do catálogo dele (apps.name) contra o nome de
// lá (achado 24/08/2026: "pra que possamos bater certinho e sem erro").
//
// ✅ Achado 25/08/2026 (pedido do Márcio): abrir o modal NÃO deve
// sincronizar sozinho — só lê o que já está em cache (api_integrations.
// catalog_cache). `sync: true` no body é que dispara a busca ao vivo (GET
// /api/listar-aplicativos, paginado — limite de 200/página do lado deles)
// e atualiza o cache. Sem isso, todo open do modal batia na API deles à
// toa.
//
// ⚠️ O "id" de cada item aqui é o valor que a Appativa espera no campo
// app_uuid de Solicitação/Reenvio de Ativação — NÃO o "uuid" do item (esse
// só serve como filtro deste endpoint). Ver comentário na doc deles.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { catalogItemFromApi, type AppativaCatalogItem } from "@/lib/apps/appativa-catalog";
import { copyRemoteImageToR2 } from "@/lib/r2-server";

export const dynamic = "force-dynamic";

const PAGE_LIMIT = 200; // ✅ máximo aceito pela API deles
// ✅ 03/10/2026: logos copiadas pro R2 por sync — o resto vai nos próximos
// (cada uma é download + upload; sem limite o sync podia estourar o tempo).
const LOGOS_PER_SYNC = 40;

// ✅ 02/10/2026: o cache passou a guardar logo, avaliação, descrição, plano,
// links por plataforma etc. (antes só id/uuid/nome/valor) — formato em
// lib/apps/appativa-catalog.ts. Cache antigo continua válido (campos extras
// opcionais), só fica completo no próximo Sync.
type CatalogItem = AppativaCatalogItem;

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id } = auth;

  const body = await req.json().catch(() => ({} as any));
  const integration_id = String(body?.integration_id || "").trim();
  const shouldSync = body?.sync === true;
  if (!integration_id) {
    return NextResponse.json({ ok: false, error: "integration_id é obrigatório" }, { status: 400 });
  }

  const { data: integration, error: fetchErr } = await supabase
    .from("api_integrations")
    .select("id, tenant_id, provider, api_key, catalog_cache, catalog_last_sync_at")
    .eq("id", integration_id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  if (fetchErr || !integration) {
    return NextResponse.json({ ok: false, error: "Parceiro não encontrado" }, { status: 404 });
  }

  if (integration.provider !== "APPATIVA") {
    return NextResponse.json({ ok: false, error: "Parceiro não suporta catálogo de aplicativos" }, { status: 400 });
  }

  // ✅ Sem sync: só devolve o que já está salvo — nenhuma chamada externa.
  if (!shouldSync) {
    const items = (integration.catalog_cache as CatalogItem[]) || [];
    return NextResponse.json({
      ok: true,
      items,
      total: items.length,
      last_sync_at: integration.catalog_last_sync_at,
      from_cache: true,
    });
  }

  const apiKey = String(integration.api_key || "").trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Chave de API não cadastrada para este parceiro" }, { status: 400 });
  }

  try {
    const items: CatalogItem[] = [];
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
        items.push(catalogItemFromApi(it));
      }

      hasMore = !!data.has_more;
      page += 1;
    }

    items.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));

    const lastSyncAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("api_integrations")
      .update({ catalog_cache: items, catalog_last_sync_at: lastSyncAt })
      .eq("id", integration.id)
      .eq("tenant_id", tenant_id);

    if (updErr) {
      // ✅ Não trava a resposta por causa disso — o Márcio já tem os dados
      // frescos na tela, só o cache pra próxima abertura que falhou.
      console.error("[appativa/list-apps] falha ao salvar cache do catálogo", updErr.message);
    }

    // ✅ 02/10/2026: atualiza também o snapshot (apps.appativa_meta) dos apps
    // já vinculados — é ele que o portal/Ver detalhes usam como padrão de
    // logo, estrelas e aparelhos quando não há override.
    // ✅ 03/10/2026, pedido do Márcio: app vinculado SEM logo no R2 ganha a
    // logo da AtivaApp copiada pro R2 (icon_url). Quem já tem logo no R2
    // (inclusive a trocada à mão) nunca é tocado. Até LOGOS_PER_SYNC por vez.
    let logosCopied = 0;
    let logosPending = 0;
    try {
      const { data: linked } = await supabase
        .from("apps")
        .select("id, name, appativa_app_id, icon_url")
        .eq("tenant_id", tenant_id)
        .not("appativa_app_id", "is", null);
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const app of linked || []) {
        const meta = byId.get(String(app.appativa_app_id));
        if (!meta) continue;
        const patch: Record<string, unknown> = { appativa_meta: { ...meta, synced_at: lastSyncAt } };
        if (!app.icon_url && meta.logo) {
          if (logosCopied < LOGOS_PER_SYNC) {
            const r2Url = await copyRemoteImageToR2(meta.logo, "apps", String(app.name || "app"));
            if (r2Url) {
              patch.icon_url = r2Url;
              logosCopied++;
            }
          } else {
            logosPending++;
          }
        }
        let q = supabase.from("apps").update(patch).eq("id", app.id).eq("tenant_id", tenant_id);
        // nunca sobrescreve uma logo gravada no meio do caminho
        if (patch.icon_url) q = q.is("icon_url", null);
        await q;
      }
    } catch (e: any) {
      console.error("[appativa/list-apps] falha ao atualizar appativa_meta", e?.message);
    }

    return NextResponse.json({
      ok: true,
      items,
      total: items.length,
      last_sync_at: lastSyncAt,
      from_cache: false,
      logos_copied: logosCopied,
      logos_pending: logosPending,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Falha ao conectar com a API da Appativa" }, { status: 502 });
  }
}
