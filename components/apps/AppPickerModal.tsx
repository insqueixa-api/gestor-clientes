"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Zap } from "lucide-react";
import FloatingPanel from "@/components/ui/FloatingPanel";
import TierStars from "@/components/apps/TierStars";
import DeviceBadges from "@/components/apps/DeviceBadges";
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
  /** estrelas (apps.tier, ou a nota da AtivaApp) — null = sem classificação */
  tier?: number | null;
  /** instruções do app com {licenca} preenchida — mostrada no "Detalhes" */
  description?: string | null;
};

// ✅ 02/10/2026 (pedido do Márcio): filtro rápido ao lado da busca (seta)
const QUICK_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todos os aplicativos" },
  { value: "5", label: "★★★★★ 5 estrelas" },
  { value: "4", label: "★★★★ 4 estrelas" },
  { value: "3", label: "★★★ 3 estrelas" },
  { value: "2", label: "★★ 2 estrelas" },
  { value: "1", label: "★ 1 estrela" },
  { value: "free", label: "Gratuitos" },
  { value: "partner", label: "Parceiros" },
  { value: "discontinued", label: "Descontinuados" },
];

function matchesQuickFilter(app: AppPickerCatalogItem, f: string): boolean {
  if (!f) return true;
  if (f === "discontinued") return app.is_active === false;
  if (f === "partner") return app.cost_type === "partnership";
  if (f === "free") return app.cost_type !== "partnership" && (app.cost_type === "free" || app.license_price == null);
  return app.cost_type !== "partnership" && Number(app.tier) === Number(f);
}

// **negrito** + quebras de linha (mesmo formato das instruções no portal)
function renderRichText(text: string) {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={i++}>{text.slice(last, m.index)}</span>);
    out.push(<strong key={i++} className="text-foreground font-bold">{m[1]}</strong>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(<span key={i++}>{text.slice(last)}</span>);
  return out;
}

// Linha em carrossel (rolagem lateral; setas no computador)
function Carousel({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * (ref.current.clientWidth * 0.8), behavior: "smooth" });
  return (
    <div className="relative group/car">
      <button
        type="button"
        onClick={() => scroll(-1)}
        className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 z-10 w-8 h-8 items-center justify-center rounded-full bg-card border border-border shadow-md text-foreground opacity-0 group-hover/car:opacity-100 transition-opacity"
        title="Anterior"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div ref={ref} className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 custom-scrollbar">
        {children}
      </div>
      <button
        type="button"
        onClick={() => scroll(1)}
        className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 z-10 w-8 h-8 items-center justify-center rounded-full bg-card border border-border shadow-md text-foreground opacity-0 group-hover/car:opacity-100 transition-opacity"
        title="Próximo"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

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
  /** deviceType = aparelho escolhido no seletor (null quando veio da busca/filtro) */
  onSelectApp: (appId: string, deviceType?: string | null) => void;
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
  // ✅ 02/10/2026: "Detalhes" do app (descrição, estrelas, aparelhos)
  const [detailsAppId, setDetailsAppId] = useState<string | null>(null);
  const [quickFilter, setQuickFilter] = useState("");
  const [quickFilterOpen, setQuickFilterOpen] = useState(false);
  const quickFilterAnchor = useRef<HTMLElement | null>(null);
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
      setDetailsAppId(null);
      setQuickFilter("");
      setQuickFilterOpen(false);
      setEditingIconKey(null);
    }
  }, [open]);


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
    if (!quickFilterOpen) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.("[data-quick-filter]")) setQuickFilterOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [quickFilterOpen]);

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
      if (q || quickFilter) return true;
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
  }, [catalog, deviceType, clientServerId, presetDeviceTypes, hasPresetDeviceTypes, q, quickFilter]);

  // ✅ 02/10/2026 (pedido do Márcio): vitrine por estrelas (5 → 1, depois
  // sem classificação), cada nível num carrossel. As abas Pagos/Parceiros
  // saíram — o preço (ou "Grátis"/"Parceria") aparece no próprio card.
  const sections = useMemo(() => {
    const list = appsForDevice
      .filter((app) => app.name.toLowerCase().includes(q))
      .filter((app) => matchesQuickFilter(app, quickFilter))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
    const out: { key: string; tier: number | null; label?: string; apps: AppPickerCatalogItem[] }[] = [];
    // ✅ 02/10/2026 (pedido do Márcio): parceria (ex: Elite, NaTV) fica
    // fora das estrelas, numa seção própria no fim. Conta P2P com parceria
    // disponível vê só a parceria.
    // ✅ descontinuados numa seção própria, a última (pedido do Márcio)
    const discontinued = list.filter((a) => a.is_active === false);
    const active = list.filter((a) => a.is_active !== false);
    const partner = active.filter((a) => a.cost_type === "partnership");
    const regular = active.filter((a) => a.cost_type !== "partnership");
    const partnerSection = { key: "parceria", tier: null, label: "Parceria com o seu servidor", apps: partner };
    if (hasPresetDeviceTypes && !q && !quickFilter && partner.length) return [partnerSection];
    for (const t of [5, 4, 3, 2, 1]) {
      const apps = regular.filter((a) => Number(a.tier) === t);
      if (apps.length) out.push({ key: `t${t}`, tier: t, apps });
    }
    const none = regular.filter((a) => !a.tier);
    if (none.length) out.push({ key: "sem", tier: null, label: "Outros aplicativos", apps: none });
    if (partner.length) out.push(partnerSection);
    if (discontinued.length) out.push({ key: "descontinuados", tier: null, label: "Descontinuados", apps: discontinued });
    return out;
  }, [appsForDevice, q, hasPresetDeviceTypes, quickFilter]);
  const totalApps = sections.reduce((n, sec) => n + sec.apps.length, 0);

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

  const detailsApp = detailsAppId ? catalog.find((a) => a.id === detailsAppId) || null : null;

  function priceOf(app: AppPickerCatalogItem): { main: string; sub: string } {
    if (app.cost_type === "partnership") return { main: "Grátis", sub: "Parceria" };
    if (app.license_price == null) return { main: "Grátis", sub: "Sem licença" };
    const main = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: app.license_price_display_currency || "BRL",
    }).format(app.license_price_display ?? app.license_price);
    return {
      main,
      sub: app.license_period === "annual" ? "Licença anual" : app.license_period === "lifetime" ? "Licença vitalícia" : "Licença",
    };
  }

  function chooseButton(app: AppPickerCatalogItem, size: string) {
    const busy = busyAppId === app.id;
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => onSelectApp(app.id, q || quickFilter ? null : deviceType)}
        className={`${size} inline-flex items-center justify-center gap-1.5 rounded-lg text-white text-xs font-bold transition-colors disabled:opacity-60 ${
          isPortal ? "bg-sky-600 hover:bg-sky-500" : "bg-emerald-600 hover:bg-emerald-500"
        }`}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        {busy ? "Adicionando..." : isPortal ? "Escolher" : "Adicionar"}
      </button>
    );
  }

  if (!open) return null;

  const accentClass = isPortal
    ? "text-sky-600 bg-sky-500/10 border-sky-500/20"
    : "text-emerald-600 bg-emerald-500/10 border-emerald-500/20";
  const activeButtonClass = isPortal
    ? "bg-sky-500/10 border-sky-500/40 text-sky-500"
    : "bg-emerald-500/10 border-emerald-500/40 text-emerald-500";
  const inputFocusClass = isPortal ? "focus:border-sky-500" : "focus:border-emerald-500";
  const showTiles = !detailsAppId && !hasPresetDeviceTypes && !deviceType && !q && !quickFilter;
  const quickFilterLabel = QUICK_FILTERS.find((o) => o.value === quickFilter)?.label || "";

  const searchInput = (extra: string) => (
    <div className={`flex gap-1.5 ${extra}`} data-quick-filter>
      <div className="relative flex-1 min-w-0">
        <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar aplicativo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`w-full h-9 pl-8 pr-3 bg-muted border border-border rounded-lg text-sm text-foreground outline-none ${inputFocusClass}`}
        />
      </div>
      <button
        type="button"
        onClick={(e) => {
          quickFilterAnchor.current = e.currentTarget;
          setQuickFilterOpen((o) => !o);
        }}
        title={quickFilter ? `Filtro: ${quickFilterLabel}` : "Filtrar"}
        className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border transition-colors ${
          quickFilter ? activeButtonClass : "bg-muted border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        <ChevronDown className="w-4 h-4" />
      </button>
    </div>
  );

  return (
    <Modal onClose={onClose} maxWidth="max-w-4xl" zIndex="z-[100000]">
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
          {(detailsAppId || (deviceType && !q && !quickFilter)) && (
            <button
              onClick={() => (detailsAppId ? setDetailsAppId(null) : setDeviceType(null))}
              className="w-8 h-8 flex items-center justify-center bg-muted hover:bg-muted/70 rounded-lg text-foreground transition-colors shrink-0"
              title="Voltar"
            >
              ←
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-foreground truncate">
              {detailsApp ? "Detalhes" : q ? "Buscar aplicativo" : quickFilter ? quickFilterLabel.replace(/^★+ /, "") : deviceType ? deviceLabel(deviceType) : title}
            </h3>
            <p className="text-xs text-foreground/70">
              {detailsApp ? (
                detailsApp.name
              ) : q || quickFilter || deviceType || hasPresetDeviceTypes ? (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-white">
                    <Zap className="w-2.5 h-2.5 fill-current" />
                  </span>
                  Aplicativos com raio têm configuração automática
                  {q || quickFilter ? " · todos os aparelhos" : ""}
                </span>
              ) : (
                subtitle
              )}
            </p>
            {helperText && (
              <p className={`mt-1 text-[11px] ${accentClass} rounded-md border px-2 py-1 inline-flex w-fit`}>
                {helperText}
              </p>
            )}
          </div>
          {searchInput("hidden sm:flex w-64 shrink-0")}
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Fechar"
          >
            ✕
          </button>
        </div>

        {searchInput("sm:hidden w-full")}

        {quickFilterOpen && (
          <FloatingPanel
            anchorRef={quickFilterAnchor}
            open
            minWidth={200}
            align="right"
            preferredHeight={360}
            dataAttr="data-quick-filter"
            zClass="z-[100010]"
          >
            <div className="py-1 overflow-y-auto">
              {QUICK_FILTERS.map((o) => (
                <button
                  key={o.value || "todos"}
                  type="button"
                  onClick={() => {
                    setQuickFilter(o.value);
                    setQuickFilterOpen(false);
                    setDetailsAppId(null);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors ${
                    quickFilter === o.value ? "font-semibold text-foreground" : "text-foreground/80"
                  }`}
                >
                  <span className="w-4 shrink-0">{quickFilter === o.value && <Check className="w-4 h-4" />}</span>
                  <span className={o.value && /^[1-5]$/.test(o.value) ? "text-amber-500" : ""}>{o.label}</span>
                </button>
              ))}
            </div>
          </FloatingPanel>
        )}

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
        ) : detailsApp ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              {detailsApp.icon_url ? (
                <img src={detailsApp.icon_url} alt="" className="w-20 h-20 rounded-2xl object-cover border border-border shrink-0" />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center text-3xl shrink-0">📱</div>
              )}
              <div className="min-w-0 space-y-1">
                <p className="text-lg font-bold text-foreground flex items-center gap-2">
                  {detailsApp.name}
                  {detailsApp.has_integration && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400 text-white text-[10px] font-bold">
                      <Zap className="w-3 h-3 fill-current" /> Configuração automática
                    </span>
                  )}
                </p>
                {detailsApp.tier ? <TierStars value={detailsApp.tier} size={16} /> : null}
                <p className="text-sm font-semibold text-foreground">{priceOf(detailsApp).main}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">{priceOf(detailsApp).sub}</span>
                </p>
              </div>
            </div>
            {(detailsApp.device_types?.length || 0) > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Aparelhos compatíveis</p>
                <DeviceBadges types={detailsApp.device_types} />
              </div>
            )}
            {detailsApp.description ? (
              <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                {renderRichText(detailsApp.description)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Sem descrição cadastrada.</p>
            )}
            {chooseButton(detailsApp, "w-full h-10")}
          </div>
        ) : (
          <div className="flex flex-col gap-4 min-h-0">
            {catalogLoading ? (
              <p className="text-xs text-muted-foreground text-center py-6">Carregando...</p>
            ) : totalApps === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                {q ? "Nenhum aplicativo encontrado pra essa busca." : "Nenhum aplicativo disponível pra esse aparelho ainda."}
              </p>
            ) : (
              sections.map((sec) => (
                <section key={sec.key} className="space-y-2">
                  <div className="flex items-center gap-2">
                    {sec.tier ? (
                      <TierStars value={sec.tier} size={14} />
                    ) : (
                      <span className="text-xs font-bold text-foreground">{sec.label}</span>
                    )}
                    <span className="text-[11px] text-muted-foreground">{sec.apps.length}</span>
                  </div>
                  <Carousel>
                    {sec.apps.map((app) => {
                      const price = priceOf(app);
                      return (
                        <div
                          key={app.id}
                          className="relative snap-start shrink-0 w-40 sm:w-44 flex flex-col items-center text-center gap-2 p-3 rounded-xl border border-border bg-muted/30"
                        >
                          {app.has_integration && (
                            <span
                              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-amber-400 text-white shadow-md ring-2 ring-amber-200 dark:ring-amber-500/30"
                              title="Configuração automática"
                            >
                              <Zap className="w-4 h-4 fill-current" />
                            </span>
                          )}
                          {app.icon_url ? (
                            <img src={app.icon_url} alt="" loading="lazy" className="w-16 h-16 rounded-xl object-cover border border-border" />
                          ) : (
                            <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center text-2xl">📱</div>
                          )}
                          <p className="text-xs font-bold text-foreground leading-tight line-clamp-2 min-h-[2rem] flex items-center">
                            {app.name}
                          </p>
                          {app.is_active === false ? (
                            <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500 border border-rose-500/20 text-[10px] font-bold">
                              Descontinuado
                            </span>
                          ) : (
                            <div className="leading-tight">
                              <p className="text-base font-extrabold text-foreground">{price.main}</p>
                              <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{price.sub}</p>
                            </div>
                          )}
                          <div className="mt-auto w-full flex flex-col gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => setDetailsAppId(app.id)}
                              className="w-full h-8 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                            >
                              <Search className="w-3.5 h-3.5" />
                              Detalhes
                            </button>
                            {chooseButton(app, "w-full h-8")}
                          </div>
                        </div>
                      );
                    })}
                  </Carousel>
                </section>
              ))
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
