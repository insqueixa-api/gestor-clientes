"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pencil, Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import {
  ALL_DEVICE_TYPES,
  DeviceType,
  deviceLabel,
  isCustomDevice,
} from "@/lib/apps/device-types";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { uploadToR2, releaseR2Files } from "@/lib/r2-upload";
import { useTenantId } from "@/lib/tenant-context";

export type AppPickerCatalogItem = {
  id: string;
  name: string;
  icon_url?: string | null;
  device_types?: string[];
  cost_type?: "free" | "paid" | "partnership" | null;
  partner_server_id?: string | null;
  license_price?: number | null;
  // ✅ Preço já convertido pra moeda da conta (portal do cliente, achado
  // 24/08/2026) — mesmo valor exibido em RenewClient.tsx pros apps já
  // instalados. Admin nunca preenche isso (segue mostrando license_price
  // em BRL, referência de custo interno).
  license_price_display?: number | null;
  license_price_display_currency?: string | null;
  license_period?: "annual" | "lifetime" | null;
  is_active?: boolean;
  discontinued_replacement_name?: string | null;
  has_integration?: boolean;
};

// Ícone padrão de cada aparelho enquanto não há logo própria
// (public.app_device_types.icon_url — trocada pelo lápis no admin).
const DEFAULT_DEVICE_ICONS: Record<DeviceType, string> = {
  SAMSUNG: "📺",
  LG: "📺",
  ROKU: "🟣",
  ANDROID_TV: "📦",
  IOS: "📱",
  ANDROID_PHONE: "📱",
  COMPUTADOR: "💻",
  FIRE_TV: "🔥",
  XBOX: "🎮",
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
  presetDeviceTypes,
  deviceIcons: deviceIconsProp,
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
   * livre nunca é travada por isso — pesquisa o catálogo inteiro. */
  clientServerId?: string | null;
  /** Quando informado, pula a etapa de escolher aparelho e filtra direto
   * pelos tipos definidos aqui (ex.: P2P -> Android TV Box + Fire TV). */
  presetDeviceTypes?: DeviceType[];
  /** Logo de cada aparelho (portal: vem da rota do catálogo). No admin,
   * se não vier, o próprio modal carrega e deixa editar (lápis). */
  deviceIcons?: Record<string, string>;
}) {
  const isPortal = variant === "portal";
  const tenantId = useTenantId();
  const canEditIcons = !isPortal && !!tenantId;

  const [deviceType, setDeviceType] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [costTab, setCostTab] = useState<"paid" | "partner">("paid");
  const [loadedIcons, setLoadedIcons] = useState<Record<string, string>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  // aparelho com o painel "colar / arrastar / selecionar" aberto (lápis)
  const [editingIconKey, setEditingIconKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingKeyRef = useRef<string | null>(null);

  const deviceIcons = deviceIconsProp ?? loadedIcons;

  useEffect(() => {
    if (open) {
      setDeviceType(null);
      setSearch("");
      setCostTab("paid");
      setEditingIconKey(null);
    }
  }, [open]);

  useEffect(() => {
    setCostTab("paid");
  }, [deviceType]);

  // ✅ 02/10/2026: admin carrega as logos dos aparelhos direto (RLS por conta)
  useEffect(() => {
    if (!open || deviceIconsProp || !canEditIcons) return;
    let cancelled = false;
    supabaseBrowser
      .from("app_device_types")
      .select("device_key, icon_url")
      .eq("tenant_id", tenantId)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map: Record<string, string> = {};
        for (const r of data) if (r.icon_url) map[r.device_key] = r.icon_url;
        setLoadedIcons(map);
      });
    return () => {
      cancelled = true;
    };
  }, [open, deviceIconsProp, canEditIcons, tenantId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingIconKey) {
          setEditingIconKey(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, editingIconKey]);

  // ✅ 02/10/2026: aparelhos = os 9 fixos + os cadastrados à mão em algum
  // app do catálogo (ex: "PS5").
  const deviceList = useMemo(() => {
    const custom = new Set<string>();
    for (const app of catalog) for (const d of app.device_types || []) if (isCustomDevice(d)) custom.add(d);
    return [
      ...ALL_DEVICE_TYPES,
      ...[...custom].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })),
    ] as string[];
  }, [catalog]);

  const q = search.trim().toLowerCase();
  const hasPresetDeviceTypes = (presetDeviceTypes?.length || 0) > 0;

  const appsForDevice = useMemo(() => {
    return catalog.filter((app) => {
      // ✅ 02/10/2026 (pedido do Márcio): com busca digitada, procura em
      // TODOS os aplicativos, independente do aparelho escolhido.
      if (q) return true;
      if (!deviceType && !hasPresetDeviceTypes) return true;
      // ✅ Trava de parceria (só app do servidor certo do cliente) — entra
      // em vigor só depois que um aparelho é escolhido.
      if (app.cost_type === "partnership" && clientServerId !== undefined) {
        if (!clientServerId || app.partner_server_id !== clientServerId) return false;
      }
      if (!deviceType && hasPresetDeviceTypes) {
        return Boolean(app.device_types?.some((dt) => presetDeviceTypes?.includes(dt as DeviceType)));
      }
      // ✅ Sem device_types cadastrado não é "compatível com tudo" — é dado
      // faltando no catálogo; só aparece pela busca.
      return Boolean(deviceType && app.device_types?.includes(deviceType));
    });
  }, [catalog, deviceType, clientServerId, presetDeviceTypes, hasPresetDeviceTypes, q]);

  const hasPaidApps = appsForDevice.some((app) => app.cost_type === "paid");
  const hasFreeApps = appsForDevice.some((app) => app.cost_type !== "paid");
  const showCostTabs = !q && hasPaidApps && hasFreeApps;

  const filteredApps = useMemo(() => {
    return appsForDevice
      .filter((app) => !showCostTabs || (costTab === "paid" ? app.cost_type === "paid" : app.cost_type !== "paid"))
      .filter((app) => app.name.toLowerCase().includes(q))
      .sort((a, b) => Number(!!b.has_integration) - Number(!!a.has_integration));
  }, [appsForDevice, costTab, q, showCostTabs]);

  async function handleIconFile(file: File, keyArg?: string) {
    const key = keyArg ?? pendingKeyRef.current;
    pendingKeyRef.current = null;
    setEditingIconKey(null);
    if (!key || !tenantId) return;
    if (!file.type.startsWith("image/")) return;
    setUploadingKey(key);
    try {
      const url = await uploadToR2(file, file.name, file.type, "device_icons");
      const previous = deviceIcons[key];
      const { error } = await supabaseBrowser
        .from("app_device_types")
        .upsert({ tenant_id: tenantId, device_key: key, icon_url: url, updated_at: new Date().toISOString() });
      if (error) {
        releaseR2Files([url]);
        return;
      }
      setLoadedIcons((prev) => ({ ...prev, [key]: url }));
      if (previous && previous !== url) releaseR2Files([previous]);
    } finally {
      setUploadingKey(null);
    }
  }

  // ✅ 02/10/2026 (pedido do Márcio): colar a logo (Ctrl+V), igual à tela
  // de aplicativos — nem sempre a imagem está salva no computador.
  useEffect(() => {
    if (!editingIconKey) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files || []).find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        void handleIconFile(file, editingIconKey);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [editingIconKey]);

  if (!open) return null;

  const accentClass = isPortal
    ? "text-sky-600 bg-sky-500/10 border-sky-500/20"
    : "text-emerald-600 bg-emerald-500/10 border-emerald-500/20";
  const activeButtonClass = isPortal
    ? "bg-sky-500/10 border-sky-500/40 text-sky-500"
    : "bg-emerald-500/10 border-emerald-500/40 text-emerald-500";
  const inputFocusClass = isPortal ? "focus:border-sky-500" : "focus:border-emerald-500";
  const showTiles = !hasPresetDeviceTypes && !deviceType && !q;

  const searchInput = (extra: string) => (
    <div className={`relative ${extra}`}>
      <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="text"
        placeholder="Buscar aplicativo..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={`w-full h-9 pl-8 pr-3 bg-muted border border-border rounded-lg text-sm text-foreground outline-none ${inputFocusClass}`}
      />
    </div>
  );

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl" zIndex="z-[100000]">
      <div className="p-6 flex flex-col gap-4 overflow-y-auto min-h-0 custom-scrollbar">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleIconFile(f);
            e.target.value = "";
          }}
        />
        <div className="flex items-start gap-3">
          {deviceType && !q && (
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
              {q ? "Buscar aplicativo" : deviceType ? deviceLabel(deviceType) : title}
            </h3>
            <p className="text-xs text-foreground/70">
              {q ? "Todos os aplicativos" : deviceType ? "Escolha o aplicativo" : subtitle}
            </p>
            {helperText && (
              <p className={`mt-1 text-[11px] ${accentClass} rounded-md border px-2 py-1 inline-flex w-fit`}>
                {helperText}
              </p>
            )}
          </div>
          {searchInput("hidden sm:block w-56 shrink-0")}
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Fechar"
          >
            ✕
          </button>
        </div>

        {searchInput("sm:hidden w-full")}

        {showTiles ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {deviceList.map((dt) => {
              const icon = deviceIcons[dt];
              const fallback = (DEFAULT_DEVICE_ICONS as Record<string, string>)[dt] ?? "📟";
              return (
                <div
                  key={dt}
                  className="relative group"
                  onDragOver={canEditIcons ? (e) => e.preventDefault() : undefined}
                  onDrop={
                    canEditIcons
                      ? (e) => {
                          const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
                          if (!file) return;
                          e.preventDefault();
                          void handleIconFile(file, dt);
                        }
                      : undefined
                  }
                >
                  <button
                    onClick={() => setDeviceType(dt)}
                    className={`w-full h-full flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-border bg-muted/30 hover:bg-muted transition-colors ${
                      isPortal ? "hover:border-sky-500/40" : "hover:border-emerald-500/40"
                    }`}
                  >
                    {uploadingKey === dt ? (
                      <Loader2 className="w-10 h-10 p-2 animate-spin text-muted-foreground" />
                    ) : icon ? (
                      <img src={icon} alt="" className="h-10 max-w-[7rem] object-contain" />
                    ) : (
                      <span className="text-3xl leading-10">{fallback}</span>
                    )}
                    <span className="text-xs font-bold text-foreground text-center">{deviceLabel(dt)}</span>
                  </button>
                  {canEditIcons && editingIconKey === dt && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 p-2 rounded-xl border-2 border-dashed border-emerald-500/60 bg-card/95 text-center">
                      <p className="text-[11px] font-semibold text-foreground leading-tight">
                        Cole a imagem (Ctrl+V)
                        <span className="block font-normal text-muted-foreground">ou arraste aqui</span>
                      </p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            pendingKeyRef.current = dt;
                            fileInputRef.current?.click();
                          }}
                          className="h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold"
                        >
                          Selecionar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingIconKey(null)}
                          className="h-7 px-2.5 rounded-md border border-border bg-muted text-[11px] font-bold text-foreground"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                  {canEditIcons && editingIconKey !== dt && (
                    <button
                      type="button"
                      onClick={() => setEditingIconKey(dt)}
                      className="absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center rounded-md bg-card border border-border text-muted-foreground hover:text-emerald-500 shadow-sm opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      title="Trocar logo — colar, arrastar ou selecionar (aparece também no portal)"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
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
            <div className="space-y-1.5 overflow-y-auto max-h-[50vh]">
              {catalogLoading ? (
                <p className="text-xs text-muted-foreground text-center py-6">Carregando...</p>
              ) : filteredApps.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  {q
                    ? "Nenhum aplicativo encontrado pra essa busca."
                    : "Nenhum aplicativo disponível pra esse aparelho ainda."}
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
                        <span className="flex flex-col min-w-0">
                          <span className="text-sm text-foreground font-medium truncate">{busy ? "Adicionando..." : app.name}</span>
                          {app.has_integration && (
                            <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-bold w-fit">
                              ⚡ Configuração automática
                            </span>
                          )}
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
                              {new Intl.NumberFormat("pt-BR", {
                                style: "currency",
                                currency: app.license_price_display_currency || "BRL",
                              }).format(app.license_price_display ?? app.license_price)}
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
    </Modal>
  );
}
