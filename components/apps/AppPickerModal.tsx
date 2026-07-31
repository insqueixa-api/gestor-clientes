"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { ALL_DEVICE_TYPES, DEVICE_TYPE_LABELS, DeviceType } from "@/lib/apps/device-types";

export type AppPickerCatalogItem = {
  id: string;
  name: string;
  icon_url?: string | null;
  device_types?: string[];
  cost_type?: "free" | "paid" | "partnership" | null;
  partner_server_id?: string | null;
  license_price?: number | null;
  license_period?: "annual" | "lifetime" | null;
  is_active?: boolean;
  discontinued_replacement_name?: string | null;
  has_integration?: boolean;
};

const DEVICE_ICONS: Record<DeviceType, string> = {
  SAMSUNG_LG: "📺",
  ANDROID_TVBOX: "📦",
  IOS: "📱",
  COMPUTADOR: "💻",
  FIRE_TV: "🔥",
  ROKU: "🟣",
};

export default function AppPickerModal({
  open,
  onClose,
  catalog,
  catalogLoading,
  onSelectApp,
  busyAppId,
  title = "Adicionar aplicativo",
  subtitle = "Em qual aparelho você vai usar?",
  variant = "admin",
  helperText,
  clientServerId,
}: {
  open: boolean;
  onClose: () => void;
  catalog: AppPickerCatalogItem[];
  catalogLoading: boolean;
  onSelectApp: (appId: string) => void;
  busyAppId: string | null;
  title?: string;
  subtitle?: string;
  variant?: "admin" | "portal";
  helperText?: string;
  /** Servidor do cliente sendo editado (admin) — só usado pra travar apps de
   * parceria a servidor errado DEPOIS que um aparelho é escolhido. A busca
   * livre (sem aparelho selecionado) nunca é travada por isso — pesquisa o
   * catálogo inteiro, pra achar qualquer app rápido. */
  clientServerId?: string | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [deviceType, setDeviceType] = useState<DeviceType | null>(null);
  const [search, setSearch] = useState("");
  const [costTab, setCostTab] = useState<"paid" | "partner">("paid");

  useEffect(() => setMounted(true), []);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const appsForDevice = useMemo(() => {
    return catalog.filter((app) => {
      if (!deviceType) return true;
      // ✅ Trava de parceria (só app do servidor certo do cliente) — entra
      // em vigor só depois que um aparelho é escolhido. Busca livre (sem
      // aparelho) nunca aplica essa trava, pra sempre achar qualquer app.
      if (app.cost_type === "partnership" && clientServerId !== undefined) {
        if (!clientServerId || app.partner_server_id !== clientServerId) return false;
      }
      // ✅ Sem device_types cadastrado não é "compatível com tudo" — é dado
      // faltando no catálogo (ex: Meta Player). Precisa ficar de fora do
      // filtro por aparelho até alguém cadastrar os dispositivos certos em
      // /admin/gerenciador/aplicativo, senão aparece em todo aparelho sem
      // ter sido testado lá de verdade.
      return Boolean(app.device_types?.includes(deviceType));
    });
  }, [catalog, deviceType, clientServerId]);

  const hasPaidApps = appsForDevice.some((app) => app.cost_type === "paid");
  const hasFreeApps = appsForDevice.some((app) => app.cost_type !== "paid");
  const showCostTabs = hasPaidApps && hasFreeApps;

  const filteredApps = useMemo(() => {
    return appsForDevice
      .filter((app) => !showCostTabs || (costTab === "paid" ? app.cost_type === "paid" : app.cost_type !== "paid"))
      .filter((app) => app.name.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => Number(!!b.has_integration) - Number(!!a.has_integration));
  }, [appsForDevice, costTab, search, showCostTabs]);

  if (!mounted || !open) return null;

  const isPortal = variant === "portal";
  const accentClass = isPortal
    ? "text-sky-600 bg-sky-500/10 border-sky-500/20"
    : "text-emerald-600 bg-emerald-500/10 border-emerald-500/20";
  const activeButtonClass = isPortal
    ? "bg-sky-500/10 border-sky-500/40 text-sky-500"
    : "bg-emerald-500/10 border-emerald-500/40 text-emerald-500";
  const inputFocusClass = isPortal ? "focus:border-sky-500" : "focus:border-emerald-500";
  // ✅ No admin, a busca fica sempre visível no cabeçalho (pedido do
  // Márcio) — dá pra achar o app pelo nome sem escolher aparelho antes. No
  // portal mantém o fluxo original (busca só depois de escolher aparelho).
  const showTiles = !deviceType && (isPortal || !search.trim());

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4 max-h-[85vh]"
      >
        <div className="flex items-start gap-3">
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
              {deviceType ? DEVICE_TYPE_LABELS[deviceType] : title}
            </h3>
            <p className="text-xs text-foreground/70">
              {deviceType ? "Escolha o aplicativo" : subtitle}
            </p>
            {helperText && (
              <p className={`mt-1 text-[11px] ${accentClass} rounded-md border px-2 py-1 inline-flex w-fit`}>
                {helperText}
              </p>
            )}
          </div>
          {!isPortal && (
            <input
              type="text"
              placeholder="Buscar aplicativo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`hidden sm:block w-48 shrink-0 h-9 px-3 bg-muted border border-border rounded-lg text-sm text-foreground outline-none ${inputFocusClass}`}
            />
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Fechar"
          >
            ✕
          </button>
        </div>

        {!isPortal && (
          <input
            type="text"
            placeholder="Buscar aplicativo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`sm:hidden w-full h-10 px-3 bg-muted border border-border rounded-lg text-sm text-foreground outline-none ${inputFocusClass}`}
          />
        )}

        {showTiles ? (
          <div className="grid grid-cols-2 gap-2.5">
            {ALL_DEVICE_TYPES.map((dt) => (
              <button
                key={dt}
                onClick={() => setDeviceType(dt)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-muted/30 hover:bg-muted transition-colors ${
                  isPortal ? "hover:border-sky-500/40" : "hover:border-emerald-500/40"
                }`}
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
                      ? activeButtonClass
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
                      ? activeButtonClass
                      : "bg-transparent border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span className="text-xs font-bold">Aplicativos Parceiros</span>
                  <span className="text-[10px] opacity-80">(Gratuito)</span>
                </button>
              </div>
            )}
            {isPortal && (
              <input
                type="text"
                autoFocus
                placeholder="Buscar aplicativo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`w-full h-10 px-3 bg-muted border border-border rounded-lg text-sm text-foreground outline-none ${inputFocusClass}`}
              />
            )}
            <div className="space-y-1.5 overflow-y-auto max-h-[50vh]">
              {catalogLoading ? (
                <p className="text-xs text-muted-foreground text-center py-6">Carregando...</p>
              ) : filteredApps.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  {deviceType
                    ? "Nenhum aplicativo disponível pra esse aparelho ainda."
                    : "Nenhum aplicativo encontrado pra essa busca."}
                </p>
              ) : (
                filteredApps.map((app) => {
                  const busy = busyAppId === app.id;
                  return (
                    <button
                      key={app.id}
                      disabled={busy}
                      onClick={() => onSelectApp(app.id)}
                      className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-muted transition-colors text-left disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="w-8 h-8 p-1.5 animate-spin text-sky-500 shrink-0" />
                      ) : app.icon_url ? (
                        <img src={app.icon_url} alt={app.name} className="w-8 h-8 rounded-lg object-cover border border-border shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-sm shrink-0">📱</div>
                      )}
                      <span className="flex-1 min-w-0 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1 min-w-0">
                          {app.has_integration && (
                            <span className="shrink-0 text-amber-500" title="Ativação automática">
                              ⚡
                            </span>
                          )}
                          <span className="text-sm text-foreground font-medium truncate">{busy ? "Adicionando..." : app.name}</span>
                        </span>
                        {app.is_active === false ? (
                          <span
                            title={
                              app.discontinued_replacement_name
                                ? `Descontinuado — recomendado migrar para ${app.discontinued_replacement_name}`
                                : "Descontinuado"
                            }
                            className="shrink-0 px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500 border border-rose-500/20 text-[10px] font-bold"
                          >
                            Descontinuado
                          </span>
                        ) : (
                          app.license_price != null && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-bold">
                              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(app.license_price)}
                              {app.license_period === "annual" ? "/ano" : app.license_period === "lifetime" ? " vitalícia" : ""}
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
