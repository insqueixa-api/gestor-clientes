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

  useEffect(() => setMounted(true), []);

  // ✅ reseta o passo toda vez que o modal reabre
  useEffect(() => {
    if (open) {
      setDeviceType(null);
      setSearch("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  // ✅ App sem device_types cadastrado (achado em auditoria 25/07/2026: 15
  // dos 34 apps do catálogo do Marcio, incluindo DupleCast/IBO Player/IBO
  // Pro Player) nunca deve ficar invisível — antes desse modal, device_types
  // nunca travava a lista de apps (só era usado de forma informativa). Sem
  // esse fallback, esses 15 apps sumiriam de TODAS as categorias.
  const filteredApps = catalog
    .filter((a) => !deviceType || !a.device_types?.length || a.device_types.includes(deviceType))
    .filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()));

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-200 max-h-[85vh]"
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
