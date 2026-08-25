"use client";
// app/admin/settings/api-server/appativa_catalog_modal.tsx
//
// "Aplicativos disponíveis" — catálogo completo da Appativa (achado
// 24/08/2026: o Márcio quer poder comparar/ajustar os nomes dos apps dele
// contra os nomes de lá, e decidir se amplia o catálogo). Busca ao abrir,
// "Sincronizar" refaz a busca, "Exportar CSV" baixa o que está na tela —
// tudo ao vivo, sem cache no banco (o botão de sync já É o refresh).
import { useEffect, useState } from "react";
import { Loader2, RefreshCcw, Download, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";

type AppativaCatalogItem = {
  id: string;
  uuid: string;
  nome: string;
  valor: number;
};

export default function AppativaCatalogModal({
  integrationId,
  onCloseAction,
  onErrorAction,
}: {
  integrationId: string;
  onCloseAction: () => void;
  onErrorAction: (msg: string) => void;
}) {
  const [items, setItems] = useState<AppativaCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function fetchCatalog() {
    setLoading(true);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess?.session?.access_token;

      const res = await fetch("/api/integrations/appativa/list-apps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ integration_id: integrationId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao buscar catálogo.");
      }
      setItems(json.items || []);
    } catch (e: any) {
      onErrorAction(e?.message ?? "Falha ao buscar catálogo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCatalog();
  }, []);

  const filtered = items.filter((it) =>
    it.nome.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function exportCsv() {
    const header = "nome;id;uuid;valor\n";
    const rows = items
      .map(
        (it) =>
          `${it.nome.replace(/;/g, ",")};${it.id};${it.uuid};${it.valor.toFixed(2).replace(".", ",")}`,
      )
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
          {loading ? "Carregando..." : `${items.length} aplicativo(s) no catálogo do parceiro`}
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
            onClick={fetchCatalog}
            disabled={loading}
            className="h-10 px-3 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5 text-sm disabled:opacity-50"
            title="Sincronizar"
          >
            {loading ? (
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

        <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border divide-y divide-border">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Carregando catálogo...
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Nenhum aplicativo encontrado.
            </p>
          ) : (
            filtered.map((it) => (
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
                <span className="shrink-0 text-xs font-bold text-emerald-500">
                  {it.valor.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </span>
              </div>
            ))
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
