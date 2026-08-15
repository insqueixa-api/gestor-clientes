"use client";
// components/guia-tv/ModalUsageStats.tsx
// Extraído de GuiaTVView.tsx (14/08/2026) — modal admin-only ("Dados de
// Uso", atrás do botão "Sincronizar" que é `!modoCliente`-gated). Só
// carrega via next/dynamic quando showUsageStats vira true.
import { useEffect, useState } from "react";
import { RefreshCw, Database } from "lucide-react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";

type UsageStatsServidor = {
  servidor: string;
  total: number;
  mes: number;
  semana: number;
  hoje: number;
};

export default function ModalUsageStats({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [dados, setDados] = useState<UsageStatsServidor[]>([]);

  function carregar() {
    setLoading(true);
    setErro(null);
    fetch("/api/client-portal/guia-tv/access-stats", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setDados(d.data);
        else setErro(d.error || "Erro ao carregar estatísticas.");
      })
      .catch(() => setErro("Erro de conexão ao carregar estatísticas."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  const COR_FAIXA: Record<string, string> = {
    ELITE: "#6366f1",
    NATV: "#10b981",
    FAST: "#06b6d4",
    TODOS: "#94a3b8",
  };
  const LABEL_FAIXA: Record<string, string> = {
    ELITE: "EliteTV",
    NATV: "NaTV",
    FAST: "FastTV",
    TODOS: "Todos",
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <ModalHeader
        onClose={onClose}
        actions={
          <button
            onClick={carregar}
            disabled={loading}
            className="text-muted-foreground hover:text-violet-500 transition-colors p-1.5 rounded-full hover:bg-violet-500/10 disabled:opacity-50 disabled:cursor-wait"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
        }
      >
        <div className="text-lg font-bold text-foreground flex items-center gap-2.5">
          <Database size={18} className="text-violet-500" /> Dados de Uso
        </div>
        <div className="text-xs text-muted-foreground/90 mt-1.5 leading-relaxed">
          Acessos de clientes ao Guia TV, por servidor.
        </div>
      </ModalHeader>

        <ModalBody className="p-5 space-y-3 bg-muted/20">
          {loading && (
            <div className="text-center py-16 text-muted-foreground animate-pulse flex flex-col items-center gap-3">
              <RefreshCw
                size={22}
                className="animate-spin text-muted-foreground/60"
              />
              Carregando estatísticas...
            </div>
          )}
          {!loading && erro && (
            <div className="text-center py-16 text-rose-500 text-sm font-medium">
              {erro}
            </div>
          )}
          {!loading && !erro && dados.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm italic">
              Nenhum acesso registrado ainda.
            </div>
          )}
          {!loading &&
            !erro &&
            dados.map((d) => {
              const cor = COR_FAIXA[d.servidor] || "#94a3b8";
              const label = LABEL_FAIXA[d.servidor] || d.servidor;
              return (
                <div
                  key={d.servidor}
                  className="p-4 rounded-xl border border-border bg-card"
                >
                  <div className="flex items-center gap-2.5 mb-3">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: cor }}
                    />
                    <span className="text-sm font-bold text-foreground tracking-tight">
                      {label}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "Total", valor: d.total },
                      { label: "Mês", valor: d.mes },
                      { label: "Semana", valor: d.semana },
                      { label: "Hoje", valor: d.hoje },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="text-center p-2 rounded-lg bg-muted/40 border border-border/60"
                      >
                        <div className="text-base font-bold text-foreground tabular-nums">
                          {item.valor.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">
                          {item.label}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </ModalBody>

        <ModalFooter className="block">
          <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-2 leading-relaxed">
            <RefreshCw size={10} className="text-muted-foreground/60" /> Seu
            próprio acesso como admin não é contabilizado.
          </div>
        </ModalFooter>
    </Modal>
  );
}
