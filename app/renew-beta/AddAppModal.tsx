"use client";
// app/renew-beta/AddAppModal.tsx
//
// Modal de "+ Adicionar aplicativo" do Bloco 3 — pedido do Marcio
// (25/07/2026): a lista plana de todos os apps era ruim de usar. Agora é em
// 2 passos, mesmo estilo visual do ConfirmDialog: primeiro escolhe o tipo
// de equipamento (TV, celular, computador...), depois só os apps
// compatíveis com esse equipamento aparecem pra escolher.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { ALL_DEVICE_TYPES, DEVICE_TYPE_LABELS, DeviceType } from "@/lib/apps/device-types";

const DEVICE_ICONS: Record<DeviceType, string> = {
  SAMSUNG_LG: "📺",
  ANDROID_TVBOX: "📦",
  IOS: "📱",
  COMPUTADOR: "💻",
  FIRE_TV: "🔥",
  ROKU: "🟣",
};

type CatalogApp = {
  id: string;
  name: string;
  icon_url: string | null;
  device_types?: string[];
  cost_type?: "free" | "paid" | "partnership" | null;
  license_price?: number | null;
  license_period?: "annual" | "lifetime" | null;
  is_active?: boolean;
  discontinued_replacement_name?: string | null;
};

export default function AddAppModal({
  open,
  onClose,
  catalog,
  catalogLoading,
  onSelectApp,
  busyAppId,
}: {
  open: boolean;
  onClose: () => void;
  catalog: CatalogApp[];
  catalogLoading: boolean;
  onSelectApp: (appId: string) => void;
  busyAppId: string | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [deviceType, setDeviceType] = useState<DeviceType | null>(null);
  const [search, setSearch] = useState("");
  // ✅ "Pagos" vs "Parceiros" (pedido do Marcio, 26/07/2026) — sempre volta
  // pra "Pagos" (recomendado) ao trocar de aparelho, mesmo padrão do resto
  // do catálogo que prioriza os apps que geram receita de licença.
  const [costTab, setCostTab] = useState<"paid" | "partner">("paid");

  useEffect(() => setMounted(true), []);

  // ✅ reseta o passo toda vez que o modal reabre
  useEffect(() => {
    if (open) {
      setDeviceType(null);
      setSearch("");
      setCostTab("paid");
    }
  }, [open]);

  useEffect(() => {
    setCostTab("paid");
  }, [deviceType]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  // ✅ Voltado atrás em 26/07/2026 (pedido do Márcio): app sem device_types
  // cadastrado NÃO aparece em categoria nenhuma — cada categoria mostra só
  // os apps marcados pra ela, simples assim. Antes tinha um fallback pra
  // apps sem device_types aparecerem em toda categoria (pensado pra apps
  // "universais" tipo IPTV Smarters); o Márcio prefere manter estrito e
  // cadastrar device_types em todo app, sem exceção por trás das cortinas.
  const appsForDevice = catalog.filter((a) => !deviceType || a.device_types?.includes(deviceType));

  // ✅ Seletor "Aplicativos Pagos (Recomendado)" / "Aplicativos Parceiros
  // (Gratuito)" — pedido do Marcio (26/07/2026). "Parceiros" agrupa
  // cost_type "partnership" (custo já embutido no plano do servidor) e
  // "free" (sem custo nenhum), já que pro cliente os dois são igualmente
  // gratuitos. Só aparece "caso se aplique" — quando o aparelho tem os 2
  // tipos disponíveis; se só tiver um tipo, mostra a lista direto.
  const hasPaidApps = appsForDevice.some((a) => a.cost_type === "paid");
  const hasFreeApps = appsForDevice.some((a) => a.cost_type !== "paid");
  const showCostTabs = hasPaidApps && hasFreeApps;

  const filteredApps = appsForDevice
    .filter((a) => !showCostTabs || (costTab === "paid" ? a.cost_type === "paid" : a.cost_type !== "paid"))
    .filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()));

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-200 max-h-[85vh]"
      >
        <div className="flex items-center gap-3">
          {deviceType && (
            <button
              onClick={() => setDeviceType(null)}
              className="w-8 h-8 flex items-center justify-center bg-muted hover:bg-muted/70 rounded-lg text-foreground transition-colors shrink-0"
              title="Voltar"
            >
              ←
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-foreground truncate">
              {deviceType ? DEVICE_TYPE_LABELS[deviceType] : "Adicionar aplicativo"}
            </h3>
            <p className="text-xs text-foreground/70">
              {deviceType ? "Escolha o aplicativo" : "Em qual aparelho você vai usar?"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Fechar"
          >
            ✕
          </button>
        </div>

        {!deviceType ? (
          <div className="grid grid-cols-2 gap-2.5">
            {ALL_DEVICE_TYPES.map((dt) => (
              <button
                key={dt}
                onClick={() => setDeviceType(dt)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-muted/30 hover:bg-muted hover:border-sky-500/40 transition-colors"
              >
                <span className="text-3xl">{DEVICE_ICONS[dt]}</span>
                <span className="text-xs font-bold text-foreground text-center">{DEVICE_TYPE_LABELS[dt]}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3 min-h-0">
            {showCostTabs && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCostTab("paid")}
                  className={`flex flex-col items-center gap-0.5 py-2 rounded-lg border transition-colors ${
                    costTab === "paid"
                      ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-500"
                      : "bg-transparent border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span className="text-xs font-bold">Aplicativos Pagos</span>
                  <span className="text-[10px] opacity-80">(Recomendado)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCostTab("partner")}
                  className={`flex flex-col items-center gap-0.5 py-2 rounded-lg border transition-colors ${
                    costTab === "partner"
                      ? "bg-sky-500/10 border-sky-500/40 text-sky-500"
                      : "bg-transparent border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span className="text-xs font-bold">Aplicativos Parceiros</span>
                  <span className="text-[10px] opacity-80">(Gratuito)</span>
                </button>
              </div>
            )}
            <input
              type="text"
              autoFocus
              placeholder="Buscar aplicativo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 px-3 bg-muted border border-border rounded-lg text-sm text-foreground outline-none focus:border-sky-500"
            />
            <div className="space-y-1.5 overflow-y-auto max-h-[50vh]">
              {catalogLoading ? (
                <p className="text-xs text-muted-foreground text-center py-6">Carregando...</p>
              ) : filteredApps.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  Nenhum aplicativo disponível pra esse aparelho ainda.
                </p>
              ) : (
                filteredApps.map((a) => {
                  const busy = busyAppId === a.id;
                  return (
                    <button
                      key={a.id}
                      disabled={busy}
                      onClick={() => onSelectApp(a.id)}
                      className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-muted transition-colors text-left disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="w-8 h-8 p-1.5 animate-spin text-sky-500 shrink-0" />
                      ) : a.icon_url ? (
                        <img src={a.icon_url} alt={a.name} className="w-8 h-8 rounded-lg object-cover border border-border shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-sm shrink-0">📱</div>
                      )}
                      <span className="flex-1 min-w-0 flex items-center justify-between gap-2">
                        <span className="text-sm text-foreground font-medium truncate">{busy ? "Adicionando..." : a.name}</span>
                        {a.is_active === false ? (
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500 border border-rose-500/20 text-[10px] font-bold">
                            Descontinuado
                          </span>
                        ) : (
                          a.license_price != null && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-bold">
                              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(a.license_price)}
                              {a.license_period === "annual" ? "/ano" : a.license_period === "lifetime" ? " vitalícia" : ""}
                            </span>
                          )
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
