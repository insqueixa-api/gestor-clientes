"use client";
// app/admin/settings/api-server/appativa_catalog_modal.tsx
//
// "Aplicativos disponíveis" — catálogo completo da Appativa (achado
// 24/08/2026: o Márcio quer poder comparar/ajustar os nomes dos apps dele
// contra os nomes de lá, e decidir se amplia o catálogo).
//
// ✅ Achado 25/08/2026: abrir o modal NÃO sincroniza sozinho — só lê o
// cache já salvo (api_integrations.catalog_cache), instantâneo. Só o
// botão "Sincronizar" bate na API deles de verdade e atualiza o cache.
// "Exportar CSV" baixa o que está na tela.
//
// ⚠️ "valor" no retorno da API deles NÃO é preço em R$ — é consumo de
// crédito (ex: 0,6). O preço real é créditos_consumidos × credit_unit_price
// (editável em "Editar" no card do parceiro, achado 24/08/2026).
import { useEffect, useState } from "react";
import { Loader2, RefreshCcw, Download, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";

type AppativaCatalogItem = {
  id: string;
  uuid: string;
  nome: string;
  valor: number; // ✅ créditos consumidos, não R$
};

export default function AppativaCatalogModal({
  integrationId,
  creditUnitPrice,
  onCloseAction,
  onErrorAction,
}: {
  integrationId: string;
  creditUnitPrice: number | null;
  onCloseAction: () => void;
  onErrorAction: (msg: string) => void;
}) {
  const [items, setItems] = useState<AppativaCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  async function fetchCatalog(sync: boolean) {
    if (sync) setSyncing(true);
    else setLoading(true);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess?.session?.access_token;

      const res = await fetch("/api/integrations/appativa/list-apps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ integration_id: integrationId, sync }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao buscar catálogo.");
      }
      setItems(json.items || []);
      setLastSyncAt(json.last_sync_at ?? null);
    } catch (e: any) {
      onErrorAction(e?.message ?? "Falha ao buscar catálogo.");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  useEffect(() => {
    // ✅ Só lê o que já está salvo — não sincroniza sozinho ao abrir.
    fetchCatalog(false);
  }, []);

  const filtered = items.filter((it) =>
    it.nome.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function exportCsv() {
    const header = "nome;id;uuid;creditos_consumidos;valor_reais\n";
    const rows = items
      .map((it) => {
        const valorReais =
          creditUnitPrice != null ? it.valor * creditUnitPrice : null;
        return `${it.nome.replace(/;/g, ",")};${it.id};${it.uuid};${it.valor.toFixed(2).replace(".", ",")};${valorReais != null ? valorReais.toFixed(2).replace(".", ",") : ""}`;
      })
      .join("\n");
    const blob = new Blob(["﻿" + header + rows], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `appativa-catalogo-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal onClose={onCloseAction} maxWidth="max-w-2xl">
      <ModalHeader onClose={onCloseAction}>
        <h2 className="text-lg font-medium text-foreground tracking-tight">
          Aplicativos disponíveis — Appativa
        </h2>
        <p className="text-xs text-foreground/70 mt-0.5">
          {loading
            ? "Carregando..."
            : `${items.length} aplicativo(s) no catálogo do parceiro`}
          {!loading && lastSyncAt && (
            <> · sincronizado em {new Date(lastSyncAt).toLocaleString("pt-BR")}</>
          )}
          {!loading && !lastSyncAt && <> · nunca sincronizado</>}
        </p>
      </ModalHeader>

      <ModalBody className="p-6 space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome..."
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-transparent text-sm text-foreground outline-none focus:border-emerald-500/50"
            />
          </div>
          <button
            type="button"
            onClick={() => fetchCatalog(true)}
            disabled={loading || syncing}
            className="h-10 px-3 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5 text-sm disabled:opacity-50"
            title="Sincronizar com a Appativa agora"
          >
            {syncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCcw className="w-4 h-4" />
            )}
            Sincronizar
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={loading || items.length === 0}
            className="h-10 px-3 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5 text-sm disabled:opacity-50"
            title="Exportar CSV"
          >
            <Download className="w-4 h-4" />
            Exportar
          </button>
        </div>

        {creditUnitPrice == null && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-[11px] text-amber-600">
            ⚠️ Valor do crédito não configurado — os preços em R$ abaixo não
            podem ser calculados. Feche e clique em "Editar" no card do
            parceiro pra definir.
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border divide-y divide-border">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Carregando catálogo...
            </p>
          ) : filtered.length === 0 && items.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Nenhum catálogo salvo ainda — clique em "Sincronizar" pra
              buscar da Appativa.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Nenhum aplicativo encontrado.
            </p>
          ) : (
            filtered.map((it) => {
              const valorReais =
                creditUnitPrice != null ? it.valor * creditUnitPrice : null;
              return (
                <div
                  key={it.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{it.nome}</p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">
                      id: {it.id}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-bold text-emerald-500">
                      {valorReais != null
                        ? valorReais.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })
                        : "--"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {it.valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}{" "}
                      crédito(s)
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          onClick={onCloseAction}
          className="h-10 px-5 rounded-xl text-muted-foreground text-sm font-medium hover:bg-muted transition-colors"
          type="button"
        >
          Fechar
        </button>
      </ModalFooter>
    </Modal>
  );
}
