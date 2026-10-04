"use client";
// app/admin/gerenciador/aplicativo/page.tsx
import { X, Pencil, Trash2, Download, Settings, Zap, Wrench, RefreshCw, ChevronDown, Search, Check } from "lucide-react";

import React, { useEffect, useState, useRef } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { uploadToR2, releaseR2Files, useR2FileTracker } from "@/lib/r2-upload";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useTenantId } from "@/lib/tenant-context";
import { useConfirm } from "@/hooks/useConfirm";
import {
  AppFieldType,
  ALL_FIELD_TYPES,
  APP_FIELD_LABELS as FIELD_LABELS,
  FIELD_ICONS,
} from "@/lib/apps/field-types";
import {
  Technology,
  ALL_DEVICE_TYPES,
  deviceLabel,
  isBuiltInDevice,
  isCustomDevice,
  withoutLegacyDevices,
} from "@/lib/apps/device-types";
import { PORTAL_VARIABLE_OPTIONS } from "@/lib/apps/portal-variable-rules";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import GpcRokuActivationsModal from "./gpc_roku_activations_modal";
import DeviceBadges from "@/components/apps/DeviceBadges";
import TierStars from "@/components/apps/TierStars";
import FloatingPanel from "@/components/ui/FloatingPanel";
import { isoDateInSaoPaulo } from "@/lib/date-br";
import {
  type AppativaCatalogItem,
  type AppativaMeta,
  devicesFromAppativa,
  effectiveDevices,
  effectiveIcon,
  effectiveTier,
  periodFromAppativa,
} from "@/lib/apps/appativa-catalog";

// --- TIPOS ---
type AppField = {
  id: string;
  type: AppFieldType;
  // ✅ Nome customizado do campo pra ESSE app específico (pedido do Márcio,
  // 05/08/2026) — substitui o rótulo genérico (APP_FIELD_LABELS) nos modais
  // do admin e no portal do cliente. Sempre preenchido (default = rótulo
  // padrão do tipo ao adicionar o campo), editável depois.
  label: string;
};

type CostType = "free" | "paid" | "partnership";
type LicensePeriod = "annual" | "lifetime";

type AppData = {
  id: string;
  tenant_id: string;
  base_app_id?: string;
  name: string;
  info_url: string | null;
  icon_url?: string | null;
  is_active: boolean;
  fields_config: AppField[];
  integration_type?: string | null;
  cost_type?: CostType | null;
  partner_server_id?: string | null;
  license_price?: number | null;
  license_period?: LicensePeriod | null;
  // chaves fixas (lib/apps/device-types) ou nome de aparelho cadastrado à mão
  device_types?: string[] | null;
  technology?: Technology | null;
  portal_setup_instructions?: string | null;
  access_code?: string | null;
  portal_variable_fields?: string[] | null;
  discontinued_replacement_name?: string | null;
  // ✅ De-para com o catálogo da Appativa (achado 25/08/2026) — id/nome do
  // app correspondente lá, pra usar direto nos endpoints de ativação deles
  // sem precisar comparar nome a nome via CSV.
  appativa_app_id?: string | null;
  appativa_app_name?: string | null;
  // ✅ Escolha entre Duplecast/Appativa (achado 26/08/2026, pedido do
  // Márcio) — só importa quando integration_type="DUPLECAST" E
  // appativa_app_id também está mapeado (as duas opções existem pro mesmo
  // app): 'appativa' força a renovação automática a passar pela Appativa em
  // vez do Duplecast (ex: créditos do Duplecast acabaram); qualquer outro
  // valor (incl. null) mantém o Duplecast, que é o padrão. Nunca muda nada
  // pra apps sem os dois mapeados ao mesmo tempo.
  renewal_source?: string | null;
  // ✅ 30/09/2026 (refactor, docs/apps-refactor/PLANO.md): classificação
  // em estrelas — 1 a 5 (5 = melhor), null = sem classificação.
  tier?: number | null;
  // ✅ 02/10/2026: snapshot do app na AtivaApp (logo, nota, links...) —
  // padrão de logo/estrelas/aparelhos quando não há override. Ver
  // lib/apps/appativa-catalog.ts.
  appativa_meta?: AppativaMeta | null;
};

// ✅ 30/09/2026: classificação por estrelas (vários apps por nível).
// apps.tier = quantidade de estrelas (5 = melhor). Lista vem das melhores
// pras piores.
const APP_TIERS: { value: number; icon: string; label: string }[] = [5, 4, 3, 2, 1].map((n) => ({
  value: n,
  icon: "★".repeat(n),
  label: n === 1 ? "1 estrela" : `${n} estrelas`,
}));

// Integrações de configuração automática (apps.integration_type).
// Desde 03/10/2026 a lista do seletor vem das integrações cadastradas
// (app_integrations); esta é só a reserva de nome. IBO Sol removido de vez.
const INTEGRATION_OPTIONS: { value: string; label: string }[] = [
  { value: "GERENCIAAPP", label: "GerenciaApp (IBO Revenda, etc)" },
  { value: "DUPLECAST", label: "DupleCast" },
  { value: "IBOPRO", label: "IBO Pro Player" },
  { value: "QUICKPLAYER", label: "Quick Player" },
  { value: "MESSITV", label: "MessiTV" },
  { value: "BOBPLAYER", label: "BOB Player" },
  { value: "IBOPLAYER", label: "IBO Player" },
  { value: "IPTVDUPLEX", label: "IPTV Duplex Play" },
  { value: "IPTVPLAYERIO", label: "IPTV Playerio" },
  { value: "DUPLEXTV", label: "Duplex TV" },
  { value: "CLOUDDY", label: "ClouDDy" },
  { value: "NINJAPLUS", label: "Ninja Plus" },
  { value: "CAPPLAYER", label: "CAP Player" },
  { value: "IBOSMARTERS", label: "IBO Smarters Player" },
  { value: "CORTEX", label: "Cortex Player" },
  { value: "UTMPLAY", label: "UTM Play" },
  { value: "OTTPLAYER", label: "IPTV OTT Player" },
];

// Logo pequena de item do catálogo da AtivaApp (dropdown do modal).
function AppativaLogo({ src }: { src?: string | null }) {
  return src ? (
    <img src={src} alt="" loading="lazy" className="w-7 h-7 rounded-md object-cover border border-border shrink-0 bg-muted" />
  ) : (
    <span className="w-7 h-7 rounded-md bg-muted flex items-center justify-center text-xs shrink-0">📱</span>
  );
}

type ServerOption = {
  id: string;
  name: string;
};

// --- COMPONENTES UI ---
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
      {children}
    </label>
  );
}

function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50 ${className}`}
    />
  );
}

function Select({
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50 ${className}`}
    />
  );
}

// ✅ 06/09/2026 — linha arrastável do Construtor de Campos, migrada do drag
// nativo (HTML5) pro @dnd-kit (mesmo padrão já em uso em app/admin/settings/
// condominio/edicoes/nova/page.tsx) — ganha suporte a teclado/touch de graça.
// useSortable precisa de componente próprio (hook não pode rodar dentro de
// .map() no componente pai).
function SortableFieldRow({
  field,
  index,
  onRename,
  onRemove,
}: {
  field: AppField;
  index: number;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2 bg-card border border-border rounded-lg select-none"
    >
      <span
        {...attributes}
        {...listeners}
        className="text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing transition-colors text-sm px-0.5"
        title="Arrastar para reordenar"
      >
        ⠿
      </span>
      <span className="text-base shrink-0" title={FIELD_LABELS[field.type]}>
        {FIELD_ICONS[field.type]}
      </span>
      <input
        type="text"
        value={field.label}
        onChange={(e) => onRename(field.id, e.target.value)}
        onBlur={(e) => {
          if (!e.target.value.trim()) onRename(field.id, FIELD_LABELS[field.type]);
        }}
        placeholder={FIELD_LABELS[field.type]}
        title="Nome exibido no admin e no portal do cliente"
        className="flex-1 min-w-0 h-8 px-2 bg-transparent border border-transparent hover:border-border focus:border-emerald-500/60 rounded-lg text-sm font-medium text-foreground/90 outline-none transition-colors"
      />
      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
        #{index + 1}
      </span>
      <button
        onClick={() => onRemove(field.id)}
        className="w-8 h-8 flex items-center justify-center text-rose-500 hover:bg-rose-500/20 rounded-lg transition-colors"
        title="Remover campo"
      >
        ✕
      </button>
    </div>
  );
}

// --- PÁGINA ---
function normalizeApiUrl(url: string) {
  if (!url) return "";
  let s = url.trim().replace(/\/+$/, "");
  if (s.toLowerCase().startsWith("javascript:")) return "";
  if (s && !s.startsWith("http")) {
    s = "https://" + s;
  }
  return s;
}

export default function AppManagerPage() {
  const tenantId = useTenantId();
  const [apps, setApps] = useState<AppData[]>([]);
  const [myTenantId, setMyTenantId] = useState<string | null>(null);
  const [configuredIntegrations, setConfiguredIntegrations] = useState<
    { name: string; label: string; url: string; icon: string | null }[]
  >([]);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [search, setSearch] = useState("");
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<string>("Todos");
  // ✅ 02/10/2026 (pedido do Márcio): filtros combinados (todos valem juntos)
  const [starFilter, setStarFilter] = useState<string>("todas"); // "5".."1" | "sem"
  const [configFilter, setConfigFilter] = useState<string>("todas"); // auto | manual
  const [integrationFilter, setIntegrationFilter] = useState<string>("todas"); // valor | "none"
  const [renewFilter, setRenewFilter] = useState<string>("todas"); // AtivaApp | DupleCast | GerenciaApp | none
  const [costFilter, setCostFilter] = useState<string>("todos"); // free | paid | partnership
  // celular: filtros recolhidos atrás do botão "Filtros" (mesmo padrão da tela de clientes)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Seções recolhíveis da lista (legado e descontinuados começam fechadas)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    descontinuado: true,
  });
  const [savingTierId, setSavingTierId] = useState<string | null>(null);
  const [tierPickerFor, setTierPickerFor] = useState<string | null>(null);
  // ✅ 30/09/2026: rodapé do card = "Dispositivos" (balão) · "Ver detalhes"
  // (janela só de leitura com o que está configurado) · preço.
  const [devicesPopoverFor, setDevicesPopoverFor] = useState<string | null>(null);
  const [detailsApp, setDetailsApp] = useState<AppData | null>(null);
  useEffect(() => {
    if (!devicesPopoverFor) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.("[data-devices-popover]")) setDevicesPopoverFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDevicesPopoverFor(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [devicesPopoverFor]);
  useEffect(() => {
    if (!tierPickerFor) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.("[data-tier-picker]")) setTierPickerFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTierPickerFor(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [tierPickerFor]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // ✅ GPC Roku (achado 26/08/2026, pedido do Márcio — ver docs/sql/
  // gpc_roku_activations.sql): engrenagem no card abre o painel de MACs.
  const [gpcRokuActivationsFor, setGpcRokuActivationsFor] = useState<string | null>(null);

  // ✅ Trava de scroll do fundo agora vem de graça do <Modal> (components/ui/
  // Modal.tsx) que envolve o modal logo abaixo — tinha uma versão própria
  // aqui antes, rodando junto com a nova; a duplicidade corrompia a posição
  // de scroll do fundo ao fechar (mesmo bug já achado e corrigido em
  // novo_cliente.tsx, 10/08/2026).

  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"geral" | "dispositivo" | "campos">("geral");
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formFields, setFormFields] = useState<AppField[]>([]);
  const [formIntegration, setFormIntegration] = useState<string>("");
  // ✅ Sugestão de instruções por IA (pedido do Márcio, 06/09/2026) — mesmo
  // padrão de app/admin/settings/condominio/ModalAcao.tsx: state de
  // sugestão separado, nunca sobrescreve o textarea sozinho.
  const [sugestaoInstrucoes, setSugestaoInstrucoes] = useState<{
    text: string;
    basedOnAppName: string;
    viaAI: boolean;
  } | null>(null);
  const [sugerindoInstrucoes, setSugerindoInstrucoes] = useState(false);
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );
  const [formIconUrl, setFormIconUrl] = useState<string>("");
  // ✅ 30/09/2026: troca/remoção de logo apaga a anterior do R2 depois de
  // salvar; fechar sem salvar apaga o que foi enviado à toa.
  const r2Files = useR2FileTracker();
  const closeAppModal = () => {
    r2Files.discard();
    setIsModalOpen(false);
  };
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [formCostType, setFormCostType] = useState<CostType | "">("");
  const [formPartnerServerId, setFormPartnerServerId] = useState<string>("");
  const [formLicensePrice, setFormLicensePrice] = useState<string>("");
  const [formLicensePeriod, setFormLicensePeriod] = useState<
    LicensePeriod | ""
  >("");
  const [formDeviceTypes, setFormDeviceTypes] = useState<string[]>([]);
  // ✅ 02/10/2026: "Compatibilidade" virou lista de múltipla escolha.
  // Marcar "Descontinuado" guarda o que estava marcado aqui e desmarca o
  // resto; desmarcar devolve. É isso que vai pro banco enquanto estiver
  // descontinuado — reabrir e desmarcar depois também volta.
  const [devicesPickerOpen, setDevicesPickerOpen] = useState(false);
  const [devicesBeforeDiscontinue, setDevicesBeforeDiscontinue] = useState<string[] | null>(null);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [sessionCustomDevices, setSessionCustomDevices] = useState<string[]>([]);
  const [formTechnology, setFormTechnology] = useState<Technology>("IPTV");
  const [formPortalInstructions, setFormPortalInstructions] =
    useState<string>("");
  const [formAccessCode, setFormAccessCode] = useState<string>("");
  const [formVariableBadges, setFormVariableBadges] = useState<string[]>([]);
  // ✅ "Descontinuado" — reaproveita apps.is_active (existia, mas nunca era
  // exposto em lugar nenhum). Pedido do Márcio (25/07/2026): DuplexPlay saiu
  // de linha, clientes que já têm precisam ver aviso pra trocar; app some do
  // catálogo de "adicionar novo" mas continua listado pra quem já tem.
  const [formIsActive, setFormIsActive] = useState(true);
  const [formDiscontinuedReplacement, setFormDiscontinuedReplacement] =
    useState<string>("");
  // ✅ De-para com o catálogo da Appativa (achado 25/08/2026) — ver
  // AppativaCatalogItem/appativaCatalog.
  const [formAppativaAppId, setFormAppativaAppId] = useState<string>("");
  const [formAppativaAppName, setFormAppativaAppName] = useState<string>("");
  const [appativaCatalog, setAppativaCatalog] = useState<
    AppativaCatalogItem[]
  >([]);
  // ✅ Preço em R$ de 1 crédito do parceiro (api_integrations.
  // credit_unit_price) — usado pra mostrar o custo real de cada app
  // vinculado no card (achado 25/08/2026, pedido do Márcio: "só pra eu ver
  // visualmente meu custo e quanto eu cobro").
  const [appativaCreditUnitPrice, setAppativaCreditUnitPrice] = useState<
    number | null
  >(null);
  // ✅ Custo por código do Duplecast (achado 26/08/2026, pedido do Márcio,
  // mesmo espírito do appativaCreditUnitPrice acima) — flat por ativação,
  // não varia por app (diferente da Appativa, que tem custo por app).
  const [duplecastCreditUnitPrice, setDuplecastCreditUnitPrice] = useState<
    number | null
  >(null);
  // ✅ Escolha Duplecast/Appativa (achado 26/08/2026) — ver AppData.renewal_source.
  const [formRenewalSource, setFormRenewalSource] = useState<string>("duplecast");
  const [appativaPickerOpen, setAppativaPickerOpen] = useState(false);
  // ✅ 02/10/2026: dropdown único da AtivaApp — uma busca só (nome OU id),
  // no lugar dos 2 campos de antes. Escolher um item é que troca o vínculo.
  const [appativaQuery, setAppativaQuery] = useState("");
  // id da integração AtivaApp (api_integrations) — usado pelo botão Sync.
  const [appativaIntegrationId, setAppativaIntegrationId] = useState<string | null>(null);
  const [syncingAppativa, setSyncingAppativa] = useState(false);
  // ✅ 02/10/2026: "Configuração" virou dropdown com ícone (igual AtivaApp)
  const [integrationPickerOpen, setIntegrationPickerOpen] = useState(false);
  const [integrationQuery, setIntegrationQuery] = useState("");
  // ✅ 03/10/2026: relê as integrações ao abrir o seletor — renomear/criar uma
  // na tela de Integrações com esta página aberta não aparecia até o F5.
  async function refreshIntegrations() {
    if (!myTenantId) return;
    const { data } = await supabaseBrowser
      .from("app_integrations")
      .select("app_name, label, api_url, icon_url")
      .eq("tenant_id", myTenantId)
      .eq("is_active", true);
    if (data) {
      setConfiguredIntegrations(
        data.map((i) => ({ name: i.app_name, label: i.label || i.app_name, url: i.api_url || "", icon: i.icon_url || null })),
      );
    }
  }
  const integrationBtnRef = useRef<HTMLButtonElement>(null);
  const [duplecastIcon, setDuplecastIcon] = useState<string | null>(null);
  useEffect(() => {
    if (!integrationPickerOpen) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.("[data-integration-picker]")) setIntegrationPickerOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [integrationPickerOpen]);
  // botões que ancoram os painéis flutuantes (components/ui/FloatingPanel)
  const appativaBtnRef = useRef<HTMLButtonElement>(null);
  const devicesBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!devicesPickerOpen) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.("[data-devices-picker]")) setDevicesPickerOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [devicesPickerOpen]);
  useEffect(() => {
    if (!appativaPickerOpen) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.("[data-appativa-picker]")) setAppativaPickerOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [appativaPickerOpen]);

  // Dados exibidos no portal: marca o que o cliente precisa copiar no app.
  function toggleVariableBadge(key: string) {
    setFormVariableBadges((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function moveVariableBadge(key: string, direction: "left" | "right") {
    setFormVariableBadges((prev) => {
      const idx = prev.indexOf(key);
      if (idx === -1) return prev;
      const target = direction === "left" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function handleIconUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      addToast("error", "Arquivo inválido", "Selecione uma imagem.");
      return;
    }
    try {
      setUploadingIcon(true);
      const publicUrl = await uploadToR2(file, file.name, file.type, "apps");
      r2Files.trackUpload(publicUrl);
      setFormIconUrl(publicUrl);
      addToast("success", "Imagem carregada!", "Logo salva com sucesso.");
    } catch (e: any) {
      addToast("error", "Erro no upload", e?.message ?? "Falha.");
    } finally {
      setUploadingIcon(false);
    }
  }

  const selectedIntegrationConfig = configuredIntegrations.find(
    (i) => i.name === formIntegration,
  );
  const isUrlLocked =
    !!selectedIntegrationConfig && !!selectedIntegrationConfig.url;

  useEffect(() => {
    if (isUrlLocked) {
      setFormUrl(selectedIntegrationConfig.url);
    }
  }, [formIntegration, isUrlLocked, selectedIntegrationConfig]);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSeq = useRef(1);

  const { confirm: confirmDialog, ConfirmUI } = useConfirm();

  const removeToast = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  const addToast = (
    type: "success" | "error",
    title: string,
    message?: string,
  ) => {
    const id = Date.now() * 1000 + (toastSeq.current++ % 1000);
    const durationMs = 5000;

    setToasts((prev) => [...prev, { id, type, title, message, durationMs }]);

    setTimeout(() => {
      removeToast(id);
    }, durationMs);
  };

  async function loadData() {
    setLoading(true);
    try {
      const tid = tenantId;
      if (!tid) return;
      setMyTenantId(tid);

      const [appsRes, integrationsRes, serversRes, appativaRes, duplecastRes] = await Promise.all([
        supabaseBrowser
          .from("apps")
          .select("*")
          .eq("tenant_id", tid)
          .order("name", { ascending: true }),
        supabaseBrowser
          .from("app_integrations")
          .select("app_name, label, api_url, icon_url")
          .eq("tenant_id", tid)
          .eq("is_active", true),
        supabaseBrowser
          .from("servers")
          .select("id, name")
          .eq("tenant_id", tid)
          .eq("is_archived", false)
          .order("name", { ascending: true }),
        // ✅ Catálogo já sincronizado da Appativa (achado 25/08/2026, pedido
        // do Márcio) — usado pelo seletor "Appativa" no formulário, pra
        // vincular direto em vez de comparar nome a nome. Lê do cache
        // (api_integrations.catalog_cache), nunca chama a API deles daqui —
        // sincronizar é feito só em Settings > API de Integrações.
        supabaseBrowser
          .from("api_integrations")
          .select("id, catalog_cache, credit_unit_price")
          .eq("tenant_id", tid)
          .eq("provider", "APPATIVA")
          .eq("is_active", true)
          .maybeSingle(),
        // ✅ Custo por código do Duplecast (achado 26/08/2026) — mesmo
        // padrão da Appativa acima, só que sem catálogo (preço flat).
        supabaseBrowser
          .from("api_integrations")
          .select("credit_unit_price, icon_url")
          .eq("tenant_id", tid)
          .eq("provider", "DUPLECAST")
          .eq("is_active", true)
          .maybeSingle(),
      ]);

      if (appsRes.error) throw appsRes.error;
      if (integrationsRes.error) throw integrationsRes.error;
      if (serversRes.error) throw serversRes.error;

      const formattedApps = (appsRes.data || [])
        .map((app) => ({
          ...app,
          fields_config: Array.isArray(app.fields_config)
            ? app.fields_config
            : [],
        }))
        .sort((a, b) =>
          a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
        );

      setApps(formattedApps);
      setConfiguredIntegrations(
        integrationsRes.data?.map((i) => ({
          name: i.app_name,
          label: i.label || i.app_name,
          url: i.api_url || "",
          icon: i.icon_url || null,
        })) || [],
      );
      setServers(serversRes.data || []);
      setAppativaCatalog(
        (appativaRes.data?.catalog_cache as AppativaCatalogItem[]) || [],
      );
      setAppativaIntegrationId(appativaRes.data?.id ?? null);
      setAppativaCreditUnitPrice(
        appativaRes.data?.credit_unit_price != null
          ? Number(appativaRes.data.credit_unit_price)
          : null,
      );
      setDuplecastIcon(duplecastRes.data?.icon_url || null);
      setDuplecastCreditUnitPrice(
        duplecastRes.data?.credit_unit_price != null
          ? Number(duplecastRes.data.credit_unit_price)
          : null,
      );
    } catch (error: any) {
      addToast("error", "Erro ao carregar dados", error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredApps = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter((a) => {
      if (q && !String(a.name ?? "").toLowerCase().includes(q)) return false;
      if (deviceTypeFilter === "__none__") {
        // ✅ 02/10/2026: "Sem aparelho" = ainda não mapeado (nem à mão nem pela AtivaApp)
        if (effectiveDevices(a, appativaCatalog).value.length > 0) return false;
      } else if (
        deviceTypeFilter !== "Todos" &&
        !effectiveDevices(a, appativaCatalog).value.includes(deviceTypeFilter)
      )
        return false;
      if (starFilter !== "todas") {
        const t = effectiveTier(a, appativaCatalog).value;
        if (starFilter === "sem" ? !!t : t !== Number(starFilter)) return false;
      }
      if (configFilter === "auto" && !a.integration_type) return false;
      if (configFilter === "manual" && !!a.integration_type) return false;
      if (integrationFilter !== "todas") {
        if (integrationFilter === "none" ? !!a.integration_type : a.integration_type !== integrationFilter) return false;
      }
      if (renewFilter !== "todas") {
        // mesma regra dos raios do card (activationProviders)
        const via: string[] = [];
        if (a.integration_type === "DUPLECAST") via.push("DupleCast");
        if (a.appativa_app_id) via.push("AtivaApp");
        if (a.integration_type === "GERENCIAAPP") via.push("GerenciaApp");
        if (renewFilter === "none" ? via.length > 0 : !via.includes(renewFilter)) return false;
      }
      if (costFilter !== "todos" && (a.cost_type || "") !== costFilter) return false;
      return true;
    });
  }, [search, apps, deviceTypeFilter, appativaCatalog, starFilter, configFilter, integrationFilter, renewFilter, costFilter]);

  const hasActiveFilters =
    deviceTypeFilter !== "Todos" ||
    starFilter !== "todas" ||
    configFilter !== "todas" ||
    integrationFilter !== "todas" ||
    renewFilter !== "todas" ||
    costFilter !== "todos";

  function clearFilters() {
    setSearch("");
    setDeviceTypeFilter("Todos");
    setStarFilter("todas");
    setConfigFilter("todas");
    setIntegrationFilter("todas");
    setRenewFilter("todas");
    setCostFilter("todos");
  }

  // ✅ 30/09/2026 (refactor de aplicativos): a lista deixa de ser por custo
  // (Pagos/Parceria/Gratuitos) e passa a ser pela classificação do Márcio.
  // "Configuração manual" é derivado (sem integração e sem nível). Parceria
  // virou legado (os vínculos de clientes continuam valendo, mas o catálogo
  // não oferece mais app por servidor) e fica recolhida no fim.
  const sections = React.useMemo(() => {
    // ✅ 03/10/2026 (pedido do Márcio): dentro de cada classificação, os com
    // integração primeiro, depois só AtivaApp, depois manuais — e por nome.
    const autoRank = (a: AppData) => (a.integration_type ? 0 : a.appativa_app_id ? 1 : 2);
    const byName = (a: AppData, b: AppData) =>
      autoRank(a) - autoRank(b) ||
      a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    const ativos = filteredApps.filter((a) => a.is_active !== false);
    const correntes = ativos.filter((a) => a.cost_type !== "partnership");
    // estrelas do Márcio; sem elas, a nota da AtivaApp (semi-automático)
    const tierOf = (a: AppData) => effectiveTier(a, appativaCatalog).value;
    const out: { key: string; icon: string; label: string; hint?: string; apps: AppData[] }[] = [];
    for (const t of APP_TIERS) {
      out.push({
        key: `tier-${t.value}`,
        icon: t.icon,
        label: t.label,
        apps: correntes.filter((a) => tierOf(a) === t.value).sort(byName),
      });
    }
    out.push({
      key: "sem",
      icon: "",
      label: "Sem classificação",
      hint: "Escolha o nível no próprio card.",
      // ✅ 02/10/2026: vinculado na AtivaApp também é automático (renova por lá)
      apps: correntes.filter((a) => !tierOf(a) && (!!a.integration_type || !!a.appativa_app_id)).sort(byName),
    });
    out.push({
      key: "manual",
      icon: "🔧",
      label: "Configuração manual",
      hint: "Sem integração nem AtivaApp — configurados à mão.",
      apps: correntes.filter((a) => !tierOf(a) && !a.integration_type && !a.appativa_app_id).sort(byName),
    });
    out.push({
      key: "legado",
      icon: "🤝",
      label: "Parcerias com servidor",
      hint: "Exclusivos de um servidor (ex: P2P).",
      apps: ativos.filter((a) => a.cost_type === "partnership").sort(byName),
    });
    out.push({
      key: "descontinuado",
      icon: "🚫",
      label: "Descontinuados",
      apps: filteredApps.filter((a) => a.is_active === false).sort(byName),
    });
    return out.filter((sec) => sec.apps.length > 0);
  }, [filteredApps, appativaCatalog]);

  async function setAppTier(app: AppData, tier: number | null) {
    if (!tenantId) return;
    const previous = app.tier ?? null;
    setSavingTierId(app.id);
    setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, tier } : a)));
    const { error } = await supabaseBrowser
      .from("apps")
      .update({ tier })
      .eq("id", app.id)
      .eq("tenant_id", tenantId);
    setSavingTierId(null);
    if (error) {
      setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, tier: previous } : a)));
      addToast("error", "Não foi possível salvar a classificação", error.message);
    }
  }

  const isRootTenant = true;

  const filterSelectCls =
    "h-10 w-full md:w-auto px-2.5 bg-card border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500";
  const integrationFilterOptions = React.useMemo(() => {
    const used = new Set(apps.map((a) => a.integration_type).filter(Boolean) as string[]);
    return [...used]
      .map((v) => ({ value: v, label: integrationLabel(v) }))
      .sort((x, y) => x.label.localeCompare(y.label, "pt-BR"));
  }, [apps, configuredIntegrations]);

  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const editingApp = editingId ? apps.find((a) => a.id === editingId) || null : null;
  // Item da AtivaApp escolhido no modal: o do catálogo; se o catálogo não
  // tiver (ex: ainda não sincronizado), o snapshot salvo no próprio app.
  const formAppativaItem: AppativaCatalogItem | null = formAppativaAppId
    ? appativaCatalog.find((it) => it.id === formAppativaAppId) ||
      (editingApp?.appativa_meta?.id === formAppativaAppId ? editingApp.appativa_meta : null)
    : null;
  // id da AtivaApp -> nomes dos apps daqui vinculados a ele ("Já mapeados").
  const appativaMappedTo = React.useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of apps) {
      if (!a.appativa_app_id) continue;
      m.set(a.appativa_app_id, [...(m.get(a.appativa_app_id) || []), a.name]);
    }
    return m;
  }, [apps]);

  const deviceOptions = React.useMemo(() => {
    const custom = new Set<string>();
    for (const a of apps) for (const d of a.device_types || []) if (isCustomDevice(d)) custom.add(d);
    for (const d of [...sessionCustomDevices, ...formDeviceTypes, ...(devicesBeforeDiscontinue || [])])
      if (isCustomDevice(d)) custom.add(d);
    return [
      ...ALL_DEVICE_TYPES,
      ...[...custom].sort((x, y) => x.localeCompare(y, "pt-BR", { sensitivity: "base" })),
    ] as string[];
  }, [apps, sessionCustomDevices, formDeviceTypes, devicesBeforeDiscontinue]);
  const formAutoDevices: string[] = devicesFromAppativa(formAppativaItem);

  // Ícone de cada integração: o salvo nela (API de Integrações); senão o da
  // API do DupleCast; senão o de um app do catálogo que já usa essa
  // integração (a maioria não tem ícone próprio cadastrado).
  const integrationIcon = (value: string): string | null =>
    configuredIntegrations.find((i) => i.name === value)?.icon ||
    (value === "DUPLECAST" ? duplecastIcon : null) ||
    apps
      .filter((a) => a.integration_type === value)
      .map((a) => effectiveIcon(a, appativaCatalog))
      .find(Boolean) ||
    null;
  // ✅ 03/10/2026 (pedido do Márcio): nome = o que ele cadastrou na API de
  // Integrações; a lista fixa do código só cobre integração ainda não cadastrada.
  function integrationLabel(value: string) {
    return (
      configuredIntegrations.find((i) => i.name === value)?.label ||
      INTEGRATION_OPTIONS.find((o) => o.value === value)?.label ||
      value
    );
  }
  // Opções do seletor = integrações cadastradas e ativas (+ a atual do app,
  // se a dela não estiver cadastrada, pra não sumir da tela).
  const integrationPickerOptions = (() => {
    const opts = configuredIntegrations
      .map((i) => ({ value: i.name, label: i.label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }));
    if (formIntegration && !opts.some((o) => o.value === formIntegration)) {
      opts.unshift({ value: formIntegration, label: integrationLabel(formIntegration) });
    }
    const q = integrationQuery.trim().toLowerCase();
    return q ? opts.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : opts;
  })();

  function pickAppativa(it: AppativaCatalogItem | null) {
    setFormAppativaAppId(it?.id || "");
    setFormAppativaAppName(it?.nome || "");
    setAppativaPickerOpen(false);
    setAppativaQuery("");
  }

  // Acha o app na AtivaApp pelo nome (ignora acento/espaço/caixa): igual
  // primeiro; senão, só aceita se UM item contiver o nome (ex: "DupleCast"
  // -> "DUPLECAST IPTV"). Ambíguo = não chuta.
  function guessAppativaItem(name: string, items: AppativaCatalogItem[]) {
    const norm = (v: string) =>
      v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const n = norm(name);
    if (!n) return null;
    const live = items.filter((it) => !it.deletado);
    const exact = live.filter((it) => norm(it.nome) === n);
    if (exact.length === 1) return exact[0];
    const partial = live.filter((it) => norm(it.nome).includes(n));
    return partial.length === 1 ? partial[0] : null;
  }

  // ✅ 02/10/2026 (pedido do Márcio): botão Sync ao lado da URL — atualiza o
  // catálogo da AtivaApp e traz o que der desse app. Só preenche o que está
  // VAZIO: o que ele já preencheu à mão vale por cima. Logo, estrelas e
  // aparelhos não são copiados — ficam como padrão automático (appativa_meta)
  // até ele definir os dele.
  async function handleAppativaSync() {
    if (!appativaIntegrationId) return;
    setSyncingAppativa(true);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch("/api/integrations/appativa/list-apps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ integration_id: appativaIntegrationId, sync: true }),
      });
      const json = await res.json().catch(() => ({}) as any);
      if (!res.ok || !json?.ok) {
        addToast("error", "Falha no Sync", json?.error || "Não foi possível consultar a AtivaApp.");
        return;
      }
      const items = (json.items || []) as AppativaCatalogItem[];
      setAppativaCatalog(items);

      const linked = formAppativaAppId ? items.find((it) => it.id === formAppativaAppId) || null : null;
      if (formAppativaAppId && !linked) {
        addToast("error", "Catálogo atualizado", "O app vinculado não existe mais na AtivaApp — escolha outro.");
        return;
      }
      const item = linked || guessAppativaItem(formName, items);
      if (!item) {
        setAppativaQuery(formName.trim());
        setAppativaPickerOpen(true);
        addToast("success", "Catálogo atualizado", "Não achei esse app na AtivaApp pelo nome — escolha na lista.");
        return;
      }

      const filled: string[] = [];
      if (!linked) {
        pickAppativa(item);
        filled.push("vínculo");
      }
      if (!formUrl.trim() && !isUrlLocked && item.link_app) {
        setFormUrl(item.link_app);
        filled.push("URL");
      }
      const period = periodFromAppativa(item.plano);
      if (period && !formLicensePeriod) {
        setFormLicensePeriod(period);
        filled.push("período");
      }
      if (!formIconUrl && item.logo) filled.push("logo");
      addToast(
        "success",
        `Sincronizado com ${item.nome}`,
        filled.length
          ? `Preenchido: ${filled.join(", ")}. O que você já tinha preenchido foi mantido.`
          : "Nada vazio pra preencher — o que você já tinha preenchido foi mantido.",
      );
    } catch {
      addToast("error", "Erro", "Falha ao conectar com o servidor.");
    } finally {
      setSyncingAppativa(false);
    }
  }

  function openNew() {
    setEditingId(null);
    setActiveTab("geral");
    setSugestaoInstrucoes(null);
    setFormName("");
    setFormUrl("");
    // ✅ 02/10/2026 (pedido do Márcio): app novo já nasce com os campos mais
    // comuns, nessa ordem — ele tira/troca se for o caso.
    setFormFields(
      (["mac", "device_key", "date", "obs"] as AppFieldType[]).map((type) => ({
        id: generateShortId(),
        type,
        label: FIELD_LABELS[type],
      })),
    );
    setFormIntegration("");
    setFormIconUrl("");
    r2Files.setOriginal([]);
    setFormCostType("");
    setFormPartnerServerId("");
    setFormLicensePrice("");
    setFormLicensePeriod("");
    setFormDeviceTypes([]);
    setDevicesBeforeDiscontinue(null);
    setDevicesPickerOpen(false);
    setNewDeviceName("");
    setFormTechnology("IPTV");
    setFormPortalInstructions("");
    setFormAccessCode("");
    setFormVariableBadges([]);
    setFormIsActive(true);
    setFormDiscontinuedReplacement("");
    setFormAppativaAppId("");
    setFormAppativaAppName("");
    setFormRenewalSource("duplecast");
    setAppativaQuery("");
    setAppativaPickerOpen(false);
    setIsModalOpen(true);
  }

  function openEdit(app: AppData) {
    setEditingId(app.id);
    setActiveTab("geral");
    setSugestaoInstrucoes(null);
    setFormName(app.name);
    setFormUrl(app.info_url || "");
    // ✅ Backfill de label pra apps salvos antes desse campo existir — sem
    // isso o input de renomear abriria vazio em vez de mostrar o rótulo
    // padrão que já está em uso.
    setFormFields(
      (JSON.parse(JSON.stringify(app.fields_config)) as AppField[]).map(
        (f) => ({
          ...f,
          label: f.label || FIELD_LABELS[f.type] || f.type,
        }),
      ),
    );
    setFormIntegration(app.integration_type || "");
    setFormIconUrl(app.icon_url || "");
    r2Files.setOriginal([app.icon_url]);
    setFormCostType((app.cost_type as CostType) || "");
    setFormPartnerServerId(app.partner_server_id || "");
    setFormLicensePrice(
      app.license_price != null ? String(app.license_price) : "",
    );
    setFormLicensePeriod((app.license_period as LicensePeriod) || "");
    // descontinuado: aparelhos salvos ficam guardados (voltam se desmarcar)
    if (app.is_active === false) {
      setFormDeviceTypes([]);
      setDevicesBeforeDiscontinue(withoutLegacyDevices(app.device_types));
    } else {
      setFormDeviceTypes(withoutLegacyDevices(app.device_types));
      setDevicesBeforeDiscontinue(null);
    }
    setDevicesPickerOpen(false);
    setNewDeviceName("");
    setFormTechnology((app.technology as Technology) || "IPTV");
    setFormPortalInstructions(app.portal_setup_instructions || "");
    setFormAccessCode(app.access_code || "");
    const selectedBadges = Array.isArray(app.portal_variable_fields)
      ? app.portal_variable_fields
      : [];
    setFormVariableBadges(selectedBadges);
    setFormIsActive(app.is_active !== false);
    setFormDiscontinuedReplacement(app.discontinued_replacement_name || "");
    setFormAppativaAppId(app.appativa_app_id || "");
    setFormAppativaAppName(app.appativa_app_name || "");
    setFormRenewalSource(app.renewal_source || "duplecast");
    setAppativaQuery("");
    setAppativaPickerOpen(false);
    setIsModalOpen(true);
  }

  function toggleDeviceType(dt: string) {
    // clicar num aparelho com "Descontinuado" marcado reativa o app (com o
    // que estava marcado antes) e já aplica o clique
    if (!formIsActive) {
      const base = devicesBeforeDiscontinue || [];
      setFormIsActive(true);
      setDevicesBeforeDiscontinue(null);
      setFormDeviceTypes(base.includes(dt) ? base.filter((d) => d !== dt) : [...base, dt]);
      return;
    }
    setFormDeviceTypes((prev) =>
      prev.includes(dt) ? prev.filter((d) => d !== dt) : [...prev, dt],
    );
  }

  function toggleDiscontinued() {
    if (formIsActive) {
      setDevicesBeforeDiscontinue(formDeviceTypes);
      setFormDeviceTypes([]);
      setFormIsActive(false);
    } else {
      setFormDeviceTypes(devicesBeforeDiscontinue || []);
      setDevicesBeforeDiscontinue(null);
      setFormIsActive(true);
    }
  }

  // Aparelho novo (ex: "PS5"): se já existir com outro jeito de escrever
  // (fixo ou cadastrado), reaproveita; já entra marcado.
  function addCustomDevice() {
    const name = newDeviceName.trim().replace(/\s+/g, " ");
    if (!name) return;
    const key =
      deviceOptions.find(
        (d) =>
          d.toLowerCase() === name.toLowerCase() ||
          deviceLabel(d).toLowerCase() === name.toLowerCase(),
      ) || name;
    if (!isBuiltInDevice(key)) setSessionCustomDevices((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setNewDeviceName("");
    const isOn = formIsActive && formDeviceTypes.includes(key);
    if (!isOn) toggleDeviceType(key);
  }

  const generateShortId = () =>
    "f_" + Math.random().toString(36).substring(2, 7);

  function addField(type: AppFieldType) {
    setFormFields((prev) => [
      ...prev,
      { id: generateShortId(), type, label: FIELD_LABELS[type] },
    ]);
  }

  function renameField(id: string, label: string) {
    setFormFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, label } : f)),
    );
  }

  function removeField(id: string) {
    setFormFields((prev) => prev.filter((f) => f.id !== id));
  }

  function handleFieldDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFormFields((prev) => {
      const oldIndex = prev.findIndex((f) => f.id === active.id);
      const newIndex = prev.findIndex((f) => f.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  async function handleSugerirInstrucoes() {
    setSugerindoInstrucoes(true);
    setSugestaoInstrucoes(null);
    try {
      const { data: sessionData } = await supabaseBrowser.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/admin/aplicativo/sugerir-instrucoes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          app_name: formName.trim() || "este aplicativo",
          exclude_app_id: editingId || undefined,
          cost_type: formCostType || "free",
          license_price: formCostType === "paid" && formLicensePrice ? Number(formLicensePrice) : null,
          license_period: formCostType === "paid" ? formLicensePeriod : null,
          field_types: formFields.map((f) => f.type),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        addToast("error", "Falha na sugestão", json?.error || "Não foi possível gerar uma sugestão agora.");
        return;
      }
      if (!json.suggestion) {
        addToast("error", "Nenhum app parecido", "Não achei nenhum app parecido o bastante com instruções cadastradas.");
        return;
      }
      setSugestaoInstrucoes({ text: json.suggestion, basedOnAppName: json.basedOnAppName || "", viaAI: !!json.viaAI });
    } catch {
      addToast("error", "Erro", "Falha ao conectar com o servidor.");
    } finally {
      setSugerindoInstrucoes(false);
    }
  }

  async function handleSave() {
    if (!formName.trim()) {
      addToast("error", "Nome obrigatório", "O aplicativo precisa de um nome.");
      return;
    }

    if (formCostType === "partnership" && !formPartnerServerId) {
      addToast(
        "error",
        "Servidor obrigatório",
        "Selecione o servidor parceiro para este aplicativo.",
      );
      return;
    }

    setSaving(true);
    try {
      const tid = tenantId;
      if (!tid) {
        addToast(
          "error",
          "Tenant inválido",
          "Não foi possível identificar o tenant atual.",
        );
        return;
      }

      const safeUrl = normalizeApiUrl(formUrl);
      const isPaid = formCostType === "paid";
      const isPartnership = formCostType === "partnership";
      const variableBadgesToSave = formVariableBadges;
      const devicesToSave = formIsActive ? formDeviceTypes : devicesBeforeDiscontinue || [];

      const insertPayload = {
        tenant_id: tid,
        name: formName.trim(),
        info_url: safeUrl || null,
        icon_url: formIconUrl || null,
        fields_config: formFields,
        integration_type: formIntegration || null,
        cost_type: formCostType || null,
        partner_server_id: isPartnership ? formPartnerServerId : null,
        license_price:
          isPaid && formLicensePrice ? Number(formLicensePrice) : null,
        license_period: isPaid && formLicensePeriod ? formLicensePeriod : null,
        device_types: devicesToSave,
        technology: formTechnology,
        portal_setup_instructions: formPortalInstructions.trim() || null,
        access_code: formAccessCode.trim() || null,
        portal_variable_fields: variableBadgesToSave,
        is_active: formIsActive,
        discontinued_replacement_name:
          !formIsActive && formDiscontinuedReplacement.trim()
            ? formDiscontinuedReplacement.trim()
            : null,
        appativa_app_id: formAppativaAppId || null,
        appativa_app_name: formAppativaAppId ? formAppativaAppName || null : null,
        appativa_meta: formAppativaItem
          ? { ...formAppativaItem, synced_at: (formAppativaItem as AppativaMeta).synced_at || new Date().toISOString() }
          : null,
        renewal_source:
          formIntegration === "DUPLECAST" && formAppativaAppId
            ? formRenewalSource
            : null,
      };

      if (editingId) {
        const updatePayload = {
          name: formName.trim(),
          info_url: formUrl?.trim() ? formUrl.trim() : null,
          icon_url: formIconUrl || null,
          fields_config: formFields,
          integration_type: formIntegration || null,
          cost_type: formCostType || null,
          partner_server_id: isPartnership ? formPartnerServerId : null,
          license_price:
            isPaid && formLicensePrice ? Number(formLicensePrice) : null,
          license_period:
            isPaid && formLicensePeriod ? formLicensePeriod : null,
          device_types: devicesToSave,
          technology: formTechnology,
          portal_setup_instructions: formPortalInstructions.trim() || null,
          access_code: formAccessCode.trim() || null,
          portal_variable_fields: variableBadgesToSave,
          is_active: formIsActive,
          discontinued_replacement_name:
            !formIsActive && formDiscontinuedReplacement.trim()
              ? formDiscontinuedReplacement.trim()
              : null,
          appativa_app_id: formAppativaAppId || null,
          appativa_app_name: formAppativaAppId ? formAppativaAppName || null : null,
          appativa_meta: formAppativaItem
            ? { ...formAppativaItem, synced_at: (formAppativaItem as AppativaMeta).synced_at || new Date().toISOString() }
            : null,
          renewal_source:
            formIntegration === "DUPLECAST" && formAppativaAppId
              ? formRenewalSource
              : null,
        };
        const { error } = await supabaseBrowser
          .from("apps")
          .update(updatePayload)
          .eq("id", editingId)
          .eq("tenant_id", tid);
        if (error) throw error;
        addToast("success", "Atualizado", "Aplicativo atualizado com sucesso.");
      } else {
        const { error } = await supabaseBrowser
          .from("apps")
          .insert(insertPayload);
        if (error) throw error;
        addToast("success", "Criado", "Aplicativo criado com sucesso.");
      }

      r2Files.commit([formIconUrl]);
      setIsModalOpen(false);
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e?.message ?? "Erro inesperado.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirmDialog({
      tone: "rose",
      title: "Excluir aplicativo?",
      subtitle: "Isso pode afetar clientes que usam este app.",
      details: ["Essa ação não pode ser desfeita."],
      confirmText: "Excluir",
      cancelText: "Voltar",
    });

    if (!ok) return;

    try {
      const tid = tenantId;
      if (!tid) {
        addToast(
          "error",
          "Tenant inválido",
          "Não foi possível identificar o tenant atual.",
        );
        return;
      }

      const iconToRelease = apps.find((a) => a.id === id)?.icon_url;
      const { error } = await supabaseBrowser
        .from("apps")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tid);
      if (error) throw error;
      releaseR2Files([iconToRelease]);

      addToast("success", "Removido", "Aplicativo removido da sua lista.");
      loadData();
    } catch (e: any) {
      addToast("error", "Erro", e?.message ?? "Erro inesperado.");
    }
  }

  // Quem ativa/renova a licença automaticamente (raios), na ordem de
  // prioridade: DupleCast vem antes da AtivaApp, a não ser que o app esteja
  // marcado pra renovar pela AtivaApp (renewal_source = 'appativa').
  function activationProviders(app: AppData): string[] {
    const out: string[] = [];
    const hasDuplecast = app.integration_type === "DUPLECAST";
    const hasAtivaApp = !!app.appativa_app_id;
    if (hasDuplecast) out.push("DupleCast");
    if (hasAtivaApp) {
      if (hasDuplecast && app.renewal_source === "appativa") out.unshift("AtivaApp");
      else out.push("AtivaApp");
    }
    if (app.integration_type === "GERENCIAAPP") out.push("GerenciaApp");
    return out;
  }

  function appPriceLabel(app: AppData): string {
    return app.cost_type === "partnership"
        ? servers.find((s) => s.id === app.partner_server_id)?.name || "Parceria"
        : app.cost_type === "free" || !(Number(app.license_price) > 0)
          ? "Grátis"
          : `R$ ${Number(app.license_price).toFixed(2).replace(".", ",")}${
              app.license_period === "annual"
                ? "/ano"
                : app.license_period === "lifetime"
                  ? " vitalícia"
                  : ""
            }`;
  }

  function renderAppCard(app: AppData) {
    const needsConfiguration =
      app.integration_type &&
      !configuredIntegrations.some((i) => i.name === app.integration_type);
    const priceLabel = appPriceLabel(app);
    const canEdit = app.tenant_id === myTenantId;
    const canClassify =
      canEdit && app.is_active !== false && app.cost_type !== "partnership";
    const providers = activationProviders(app);
    const pickerOpen = tierPickerFor === app.id;
    const icon = effectiveIcon(app, appativaCatalog);
    const tier = effectiveTier(app, appativaCatalog);
    const devices = effectiveDevices(app, appativaCatalog);

    return (
      <div
        key={app.id}
        className="bg-card border border-border rounded-xl p-3 shadow-sm hover:shadow-md transition-all flex flex-col gap-3"
      >
        <div className="flex items-start gap-3">
          {icon ? (
            <img
              src={icon}
              alt=""
              className="w-11 h-11 rounded-lg object-cover border border-border shrink-0"
            />
          ) : (
            <div className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center text-lg shrink-0">
              📱
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-sm text-foreground truncate pt-0.5" title={app.name}>
                {app.name}
              </p>
              {canClassify ? (
                <div className="relative shrink-0" data-tier-picker>
                  <button
                    type="button"
                    disabled={savingTierId === app.id}
                    onClick={() => setTierPickerFor(pickerOpen ? null : app.id)}
                    className="inline-flex items-center px-1.5 py-1 rounded-md border border-border hover:border-amber-400/60 transition-colors disabled:opacity-50"
                    title={
                      tier.auto
                        ? `${tier.value} de 5 estrelas pela nota da AtivaApp — clique pra definir a sua`
                        : app.tier
                          ? `${app.tier} de 5 estrelas — clique pra mudar`
                          : "Classificar"
                    }
                  >
                    <TierStars value={tier.value} size={14} />
                  </button>
                  {pickerOpen && (
                    <div className="absolute right-0 top-full mt-1 z-30 w-40 rounded-lg border border-border bg-card shadow-lg p-1">
                      {[5, 4, 3, 2, 1].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => {
                            setTierPickerFor(null);
                            if (app.tier !== n) void setAppTier(app, n);
                          }}
                          className={`w-full flex items-center px-2 py-1.5 rounded-md hover:bg-muted transition-colors ${app.tier === n ? "bg-amber-400/10" : ""}`}
                        >
                          <TierStars value={n} size={14} />
                        </button>
                      ))}
                      {app.tier != null && (
                        <button
                          type="button"
                          onClick={() => {
                            setTierPickerFor(null);
                            void setAppTier(app, null);
                          }}
                          className="w-full text-left px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted transition-colors"
                        >
                          Remover classificação
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : tier.value ? (
                <span className="shrink-0 pt-1">
                  <TierStars value={tier.value} size={14} />
                </span>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2 mt-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs min-w-0">
                {app.integration_type ? (
                  <span
                    className={`inline-flex items-center gap-1 ${needsConfiguration ? "text-amber-500" : "text-sky-600 dark:text-sky-400"}`}
                    title={
                      needsConfiguration
                        ? `Integração ${app.integration_type} sem API configurada`
                        : `Configuração automática (${app.integration_type})`
                    }
                  >
                    <Settings className="w-3.5 h-3.5" aria-hidden="true" />
                    {needsConfiguration ? "Configurar API" : "Automático"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground" title="Sem integração — configurado à mão">
                    <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
                    Manual
                  </span>
                )}
                {providers.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"
                    title={`Ativação/renovação automática via ${p}`}
                  >
                    <Zap className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                    {p}
                  </span>
                ))}
              </div>
              <div className="flex items-center shrink-0 -mr-1">
                {app.name === "GPC Roku" && (
                  <button
                    onClick={() => setGpcRokuActivationsFor(app.id)}
                    className="p-1 text-sky-500 hover:bg-sky-500/10 rounded-md transition-colors"
                    title="Gerenciar MACs ativados"
                  >
                    <IconSettings />
                  </button>
                )}
                {canEdit && (
                  <>
                    <button
                      onClick={() => openEdit(app)}
                      className="p-1 text-muted-foreground/70 hover:text-amber-500 hover:bg-amber-500/10 rounded-md transition-colors"
                      title="Editar"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(app.id)}
                      className="p-1 text-muted-foreground/70 hover:text-rose-500 hover:bg-rose-500/10 rounded-md transition-colors"
                      title="Excluir"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-auto">
          <div className="relative" data-devices-popover>
            <button
              type="button"
              onClick={() => setDevicesPopoverFor(devicesPopoverFor === app.id ? null : app.id)}
              disabled={!devices.value.length}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              title={devices.auto ? "Aparelhos compatíveis (pela AtivaApp)" : "Aparelhos compatíveis"}
            >
              Dispositivos
              <span className="text-muted-foreground/70">{devices.value.length}</span>
            </button>
            {devicesPopoverFor === app.id && (
              <div className="absolute left-0 bottom-full mb-1 z-30 w-64 rounded-lg border border-border bg-card shadow-lg p-2">
                <DeviceBadges types={devices.value} />
                {devices.auto && (
                  <p className="mt-1.5 text-[10px] text-muted-foreground">Pela AtivaApp — marque os seus no Editar pra substituir.</p>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setDetailsApp(app)}
            className="h-6 px-2.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold hover:bg-emerald-500/20 transition-colors"
          >
            Ver detalhes
          </button>
          <span className="text-sm font-semibold text-foreground shrink-0">
            {app.is_active === false && app.discontinued_replacement_name
              ? <span className="text-xs font-normal text-muted-foreground">→ {app.discontinued_replacement_name}</span>
              : priceLabel}
          </span>
        </div>
      </div>
    );
  }

  function renderSection(sec: {
    key: string;
    icon: string;
    label: string;
    hint?: string;
    apps: AppData[];
  }) {
    const collapsed = !!collapsedSections[sec.key];
    return (
      <section key={sec.key} className="space-y-3">
        <button
          type="button"
          onClick={() =>
            setCollapsedSections((prev) => ({ ...prev, [sec.key]: !prev[sec.key] }))
          }
          className="w-full flex items-center justify-between gap-2 border-b border-border pb-2 text-left hover:border-emerald-500/50 transition-colors"
        >
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-sm font-bold text-foreground">
              {sec.key.startsWith("tier-") ? (
                <TierStars value={Number(sec.key.slice(5))} size={15} />
              ) : (
                <>
                  <span>{sec.icon}</span> {sec.label}
                </>
              )}
            </span>
            <span className="text-xs text-muted-foreground">{sec.apps.length}</span>
            {sec.hint && (
              <span className="hidden sm:inline text-xs text-muted-foreground truncate">
                — {sec.hint}
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            {collapsed ? "Mostrar ▼" : "Ocultar ▲"}
          </span>
        </button>
        {!collapsed && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
            {sec.apps.map((app) => renderAppCard(app))}
          </div>
        )}
      </section>
    );
  }

  // ✅ Exportar catálogo próprio (achado 25/08/2026, pedido do Márcio) —
  // pra comparar nome a nome contra o catálogo de um parceiro (ex: exportar
  // ali em Settings > API de Integrações > Parceiros > Aplicativos
  // disponíveis) e decidir os de-para/ajustes de nome antes de ativar apps
  // por lá.
  function exportAppsCsv() {
    const header = "nome;tipo_custo;preco_licenca;periodo_licenca;integracao;tecnologia;ativo\n";
    const rows = apps
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }))
      .map((a) => {
        const custo =
          a.cost_type === "paid"
            ? "Pago"
            : a.cost_type === "partnership"
              ? "Parceria"
              : a.cost_type === "free"
                ? "Gratuito"
                : "";
        const preco = a.license_price != null ? a.license_price.toFixed(2).replace(".", ",") : "";
        const periodo =
          a.license_period === "annual"
            ? "Anual"
            : a.license_period === "lifetime"
              ? "Vitalícia"
              : "";
        return `${a.name.replace(/;/g, ",")};${custo};${preco};${periodo};${a.integration_type || ""};${a.technology || ""};${a.is_active ? "Sim" : "Não"}`;
      })
      .join("\n");
    const blob = new Blob(["﻿" + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `meu-catalogo-apps-${isoDateInSaoPaulo()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors">
      {/* ✅ Toasts em overlay */}
      <div className="fixed inset-x-0 top-2 z-[999999] px-3 sm:px-6 pointer-events-none">
        <div className="pointer-events-auto">
          <ToastNotifications toasts={toasts} removeToast={removeToast} />
        </div>
      </div>

      {ConfirmUI}

      {detailsApp && (() => {
        const a = detailsApp;
        const providers = activationProviders(a);
        const integOk =
          !a.integration_type ||
          configuredIntegrations.some((i) => i.name === a.integration_type);
        const ativaItem: AppativaCatalogItem | null = a.appativa_app_id
          ? appativaCatalog.find((it) => it.id === a.appativa_app_id) || a.appativa_meta || null
          : null;
        const ativaCost =
          ativaItem && appativaCreditUnitPrice != null ? ativaItem.valor * appativaCreditUnitPrice : null;
        const icon = effectiveIcon(a, appativaCatalog);
        const tier = effectiveTier(a, appativaCatalog);
        const devices = effectiveDevices(a, appativaCatalog);
        const autoTag = (
          <span className="ml-1.5 align-middle text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400">
            AtivaApp
          </span>
        );
        // Lojas/links de instalação que a AtivaApp informa pra esse app.
        const ativaLinks = ativaItem
          ? (
              [
                ["Android TV", ativaItem.links?.androidtv],
                ["Samsung", ativaItem.links?.samsung],
                ["LG", ativaItem.links?.lg],
                ["Roku", ativaItem.links?.roku],
                ["Microsoft", ativaItem.links?.microsoft],
                ["Apple", ativaItem.links?.apple],
              ] as [string, string | null | undefined][]
            ).filter(([, url]) => !!url && /^https?:\/\//i.test(String(url)))
          : [];
        const ativaFields = ativaItem
          ? [ativaItem.mac_e_key ? "MAC + Key" : null, ativaItem.is_device_id ? "Device ID" : null].filter(Boolean)
          : [];
        const row = (label: string, value: React.ReactNode) => (
          <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2 border-b border-border last:border-0 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-foreground min-w-0 break-words">{value}</span>
          </div>
        );
        return (
          <Modal onClose={() => setDetailsApp(null)} maxWidth="max-w-3xl">
            <ModalHeader onClose={() => setDetailsApp(null)}>
              <div className="flex items-center gap-3 min-w-0">
                {icon ? (
                  <img src={icon} alt="" className="w-10 h-10 rounded-lg object-cover border border-border shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">📱</div>
                )}
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-foreground truncate">{a.name}</h2>
                  <span className="flex items-center" title={tier.auto ? `Pela nota da AtivaApp (${ativaItem?.avaliacao})` : undefined}>
                    <TierStars value={tier.value} size={13} />
                    {tier.auto && autoTag}
                  </span>
                </div>
              </div>
            </ModalHeader>
            <ModalBody>
              <div className="px-1">
                {row("Situação", a.is_active === false
                  ? `Descontinuado${a.discontinued_replacement_name ? ` — usar ${a.discontinued_replacement_name}` : ""}`
                  : "Ativo")}
                {row("Preço ao cliente", appPriceLabel(a))}
                {row("Configuração", a.integration_type
                  ? `Automática — ${a.integration_type}${integOk ? "" : " (API ainda não configurada)"}`
                  : "Manual (sem integração)")}
                {row("Ativação / renovação", providers.length ? (
                  <span className="flex flex-col gap-0.5">
                    {providers.map((p) => (
                      <span key={p}>
                        ⚡ {p}
                        {p === "AtivaApp" && a.appativa_app_name ? ` — ${a.appativa_app_name}` : ""}
                        {p === "AtivaApp" && ativaCost != null ? ` · custo ${brl(ativaCost)}` : ""}
                        {p === "DupleCast" && duplecastCreditUnitPrice != null ? ` · custo ${brl(duplecastCreditUnitPrice)}/código` : ""}
                      </span>
                    ))}
                  </span>
                ) : "Manual")}
                {row("Aparelhos", devices.value.length ? (
                  <span>
                    <DeviceBadges types={devices.value} />
                    {devices.auto && <span className="block mt-1 text-[11px] text-muted-foreground">Pelos links da AtivaApp {autoTag}</span>}
                  </span>
                ) : "—")}
                {row("Campos pedidos", a.fields_config?.length ? (
                  <span className="flex flex-wrap gap-1">
                    {a.fields_config.map((f) => (
                      <span key={f.id} className="inline-flex items-center gap-1 h-6 px-1.5 rounded-md border border-border text-xs text-muted-foreground">
                        {FIELD_ICONS[f.type]} {f.label || FIELD_LABELS[f.type]}
                      </span>
                    ))}
                  </span>
                ) : "—")}
                {row("Site do app", a.info_url ? (
                  <a href={a.info_url} target="_blank" rel="noopener noreferrer" className="text-sky-600 dark:text-sky-400 underline">
                    {a.info_url}
                  </a>
                ) : "—")}
                {row("Tecnologia", a.technology || "IPTV")}
                {/* ✅ 02/10/2026: o que a AtivaApp informa desse app (padrão —
                    o que o Márcio preenche aqui vale por cima). */}
                {ativaItem && (
                  <>
                    <div className="pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Na AtivaApp
                    </div>
                    {row("App", (
                      <span>
                        {ativaItem.nome}
                        {ativaItem.deletado && <span className="ml-1 text-[11px] text-rose-500">(removido lá)</span>}
                        <span className="block text-[10px] font-mono text-muted-foreground">{ativaItem.id}</span>
                      </span>
                    ))}
                    {ativaItem.avaliacao != null && row("Nota", `${String(ativaItem.avaliacao).replace(".", ",")} de 5`)}
                    {(ativaItem.plano || ativaItem.classe) && row("Plano", [
                      ativaItem.plano === "VIT" ? "Vitalício" : ativaItem.plano === "ANUAL" ? "Anual" : ativaItem.plano,
                      ativaItem.classe ? `classe ${ativaItem.classe}` : null,
                    ].filter(Boolean).join(" · "))}
                    {ativaFields.length > 0 && row("Pede", ativaFields.join(" e "))}
                    {ativaItem.downloader_code && row("Downloader", (
                      <span className="font-mono">{ativaItem.downloader_code}</span>
                    ))}
                    {ativaLinks.length > 0 && row("Lojas", (
                      <span className="flex flex-wrap gap-x-3 gap-y-1">
                        {ativaLinks.map(([label, url]) => (
                          <a key={label} href={String(url)} target="_blank" rel="noopener noreferrer" className="text-sky-600 dark:text-sky-400 underline">
                            {label}
                          </a>
                        ))}
                      </span>
                    ))}
                    {ativaItem.descricao && row("Descrição", (
                      <span className="whitespace-pre-wrap text-xs text-muted-foreground">{ativaItem.descricao}</span>
                    ))}
                  </>
                )}
                {a.portal_setup_instructions && row("Instruções no portal", (
                  <span className="whitespace-pre-wrap text-xs text-muted-foreground">{a.portal_setup_instructions}</span>
                ))}
              </div>
            </ModalBody>
            <ModalFooter>
              <button
                type="button"
                onClick={() => setDetailsApp(null)}
                className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Fechar
              </button>
              {a.tenant_id === myTenantId && (
                <button
                  type="button"
                  onClick={() => {
                    setDetailsApp(null);
                    openEdit(a);
                  }}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
                >
                  Editar
                </button>
              )}
            </ModalFooter>
          </Modal>
        );
      })()}

      {gpcRokuActivationsFor && tenantId && (
        <GpcRokuActivationsModal tenantId={tenantId} onClose={() => setGpcRokuActivationsFor(null)} />
      )}

      {/* HEADER DA PÁGINA */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate text-foreground">
              Aplicativos
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={exportAppsCsv}
            title="Exportar catálogo (CSV) — pra comparar com o de um parceiro"
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted font-medium text-xs md:text-sm transition-all flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Exportar</span>
          </button>
          <button
            onClick={openNew}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
          >
            <span className="text-base leading-none">+</span>
            Novo Aplicativo
          </button>
        </div>
      </div>

      {/* BUSCA + FILTROS COMBINADOS (02/10/2026) — todos valem juntos.
          Computador: busca e filtros numa linha só. Celular: busca + botão
          "Filtros" que abre o painel (mesmo padrão da tela de clientes). */}
      {(() => {
        const filterSelects = (
          <>
              <select
                value={starFilter}
                onChange={(e) => setStarFilter(e.target.value)}
                title="Estrelas"
                className={`${filterSelectCls} ${starFilter !== "todas" ? "border-emerald-500/50 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : ""}`}
              >
                <option value="todas">Todas as estrelas</option>
                <option value="5">★★★★★ 5 estrelas</option>
                <option value="4">★★★★ 4 estrelas</option>
                <option value="3">★★★ 3 estrelas</option>
                <option value="2">★★ 2 estrelas</option>
                <option value="1">★ 1 estrela</option>
                <option value="sem">Sem estrela</option>
              </select>
              <select
                value={configFilter}
                onChange={(e) => setConfigFilter(e.target.value)}
                title="Configuração"
                className={`${filterSelectCls} ${configFilter !== "todas" ? "border-emerald-500/50 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : ""}`}
              >
                <option value="todas">Automático e manual</option>
                <option value="auto">Automático</option>
                <option value="manual">Manual</option>
              </select>
              <select
                value={integrationFilter}
                onChange={(e) => setIntegrationFilter(e.target.value)}
                title="Integração"
                className={`${filterSelectCls} ${integrationFilter !== "todas" ? "border-emerald-500/50 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : ""}`}
              >
                <option value="todas">Todas as integrações</option>
                <option value="none">Sem integração</option>
                {integrationFilterOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={renewFilter}
                onChange={(e) => setRenewFilter(e.target.value)}
                title="Ativação / renovação"
                className={`${filterSelectCls} ${renewFilter !== "todas" ? "border-emerald-500/50 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : ""}`}
              >
                <option value="todas">Toda ativação</option>
                <option value="AtivaApp">⚡ AtivaApp</option>
                <option value="DupleCast">⚡ DupleCast</option>
                <option value="GerenciaApp">⚡ GerenciaApp</option>
                <option value="none">Sem ativação automática</option>
              </select>
              <select
                value={costFilter}
                onChange={(e) => setCostFilter(e.target.value)}
                title="Tipo"
                className={`${filterSelectCls} ${costFilter !== "todos" ? "border-emerald-500/50 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : ""}`}
              >
                <option value="todos">Pago, grátis e parceria</option>
                <option value="paid">Pago</option>
                <option value="free">Gratuito</option>
                <option value="partnership">Parceria</option>
              </select>
              <select
                value={deviceTypeFilter}
                onChange={(e) => setDeviceTypeFilter(e.target.value)}
                title="Aparelho"
                className={`${filterSelectCls} ${deviceTypeFilter !== "Todos" ? "border-emerald-500/50 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : ""}`}
              >
                <option value="Todos">Todos os aparelhos</option>
                <option value="__none__">Sem aparelho (não mapeado)</option>
                {deviceOptions.map((dt) => (
                  <option key={dt} value={dt}>
                    {deviceLabel(dt)}
                  </option>
                ))}
              </select>
          </>
        );
        const searchBox = (
          <div className="flex-1 min-w-0 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar aplicativo..."
              className="w-full h-10 px-3 pr-8 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-rose-500"
                title="Limpar busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
        const clearBtn = (hasActiveFilters || search.trim()) && (
          <button
            type="button"
            onClick={clearFilters}
            className="h-10 px-3 shrink-0 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 text-sm font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" /> Limpar
          </button>
        );
        return (
          <div className="px-3 md:p-4 md:bg-card md:border md:border-border md:rounded-xl md:shadow-sm space-y-3">
            <div className="hidden md:flex items-center justify-between text-xs font-medium uppercase text-muted-foreground tracking-wider">
              <span>Filtros rápidos</span>
              <span className="normal-case tracking-normal">
                {filteredApps.length === apps.length
                  ? `${apps.length} aplicativos`
                  : `${filteredApps.length} de ${apps.length} aplicativos`}
              </span>
            </div>

            {/* computador: tudo na mesma linha (quebra se faltar espaço) */}
            <div className="hidden md:flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[14rem] flex">{searchBox}</div>
              {filterSelects}
              {clearBtn}
            </div>

            {/* celular: busca + botão Filtros */}
            <div className="md:hidden flex items-center gap-2">
              {searchBox}
              <button
                type="button"
                onClick={() => setMobileFiltersOpen((v) => !v)}
                className={`h-10 px-3 shrink-0 rounded-lg border font-medium text-sm transition-colors ${
                  hasActiveFilters
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                    : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Filtros
              </button>
            </div>
            {mobileFiltersOpen && (
              <div className="md:hidden p-3 rounded-xl border border-border space-y-2 [&_select]:w-full [&_select]:h-10">
                {filterSelects}
                <div className="flex gap-2 pt-1">
                  {clearBtn}
                  <button
                    type="button"
                    onClick={() => setMobileFiltersOpen(false)}
                    className="flex-1 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
                  >
                    Ver {filteredApps.length} aplicativo{filteredApps.length === 1 ? "" : "s"}
                  </button>
                </div>
              </div>
            )}
            <p className="md:hidden text-xs text-muted-foreground">
              {filteredApps.length === apps.length
                ? `${apps.length} aplicativos`
                : `${filteredApps.length} de ${apps.length} aplicativos`}
            </p>
          </div>
        );
      })()}

      {/* LISTAGEM — por classificação */}
      {loading ? (
        <div className="text-center py-10 text-muted-foreground bg-transparent rounded-xl border border-dashed border-border">
          Carregando aplicativos...
        </div>
      ) : sections.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground bg-transparent rounded-xl border border-dashed border-border">
          {apps.length === 0
            ? 'Nenhum aplicativo cadastrado. Clique em "Novo Aplicativo" para começar.'
            : search.trim()
              ? `Nenhum aplicativo encontrado para "${search.trim()}".`
              : "Nenhum aplicativo encontrado para os filtros selecionados."}
        </div>
      ) : (
        <div className="px-3 sm:px-0 space-y-6">
          {sections.map((sec) => renderSection(sec))}
          <div className="h-24 md:h-20" />
        </div>
      )}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO */}
      {isModalOpen && (
        <Modal onClose={closeAppModal} maxWidth="max-w-3xl">
          <ModalHeader onClose={closeAppModal}>
            <h2 className="text-lg font-medium text-foreground">
              {editingId ? "Editar Aplicativo" : "Novo Aplicativo"}
            </h2>
          </ModalHeader>

            <ModalBody className="p-3 sm:p-4 space-y-3">
              {/* ABAS */}
              <div className="flex justify-center border-b border-border bg-muted/50 -mx-3 sm:-mx-4 -mt-3 sm:-mt-4 px-4 py-2 mb-1">
                <div className="flex rounded-lg p-1 w-full sm:w-auto overflow-x-auto">
                  {(
                    [
                      { key: "geral", label: "GERAL" },
                      { key: "dispositivo", label: "DISPOSITIVO" },
                      { key: "campos", label: "CAMPOS" },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`flex-1 sm:flex-none px-4 py-2 text-xs font-medium rounded-md transition-all uppercase tracking-wider whitespace-nowrap ${
                        activeTab === tab.key
                          ? "bg-card text-emerald-500 shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {activeTab === "geral" && (
              <div className="space-y-3 animate-in slide-in-from-right-4 duration-300">
              {/* ✅ 02/10/2026 (refactor de apps): Nome | URL + Sync da AtivaApp */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Nome do Aplicativo</Label>
                  <Input
                    placeholder="Ex: DupleCast, IBO..."
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div>
                  <Label>URL de Configuração</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://..."
                      value={formUrl}
                      onChange={(e) => setFormUrl(e.target.value)}
                      disabled={isUrlLocked}
                      className={
                        isUrlLocked ? "opacity-60 cursor-not-allowed" : ""
                      }
                    />
                    <button
                      type="button"
                      onClick={handleAppativaSync}
                      disabled={syncingAppativa || !appativaIntegrationId}
                      className="shrink-0 h-10 px-3 inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400 text-xs font-semibold hover:bg-sky-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={
                        appativaIntegrationId
                          ? "Atualiza o catálogo da AtivaApp e preenche o que estiver vazio (o que você já preencheu é mantido)"
                          : "AtivaApp não configurada em API de Integrações"
                      }
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingAppativa ? "animate-spin" : ""}`} />
                      Sync
                    </button>
                  </div>
                  {isUrlLocked && (
                    <p className="text-[10px] text-emerald-500 mt-1 font-medium">
                      URL gerenciada automaticamente pela integração.
                    </p>
                  )}
                </div>
              </div>

              {/* LOGO DO APP */}
              <div>
                <Label>Logo do Aplicativo</Label>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleIconUpload(file);
                  }}
                  onPaste={(e) => {
                    const file = Array.from(e.clipboardData.files).find((f) =>
                      f.type.startsWith("image/"),
                    );
                    if (file) handleIconUpload(file);
                  }}
                  className="flex items-center gap-4 p-3 border-2 border-dashed border-border rounded-xl hover:border-emerald-500/50 transition-colors"
                  tabIndex={0}
                >
                  {formIconUrl || formAppativaItem?.logo ? (
                    <img
                      src={formIconUrl || formAppativaItem?.logo || ""}
                      alt="Logo"
                      className="w-12 h-12 rounded-lg object-cover border border-border shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0 text-2xl">
                      📱
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground/90">
                      {uploadingIcon
                        ? "Enviando..."
                        : "Arraste, cole (Ctrl+V) ou clique para selecionar"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {!formIconUrl && formAppativaItem?.logo
                        ? "Usando a logo da AtivaApp — envie uma pra substituir"
                        : "PNG, JPG, WebP — funciona com figurinhas do WhatsApp"}
                    </p>
                  </div>
                  <label className="cursor-pointer shrink-0">
                    <span className="h-8 px-3 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-xs font-medium flex items-center hover:bg-emerald-500/20 transition-colors">
                      {uploadingIcon ? "..." : "Selecionar"}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingIcon}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleIconUpload(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {formIconUrl && (
                    <button
                      type="button"
                      onClick={() => setFormIconUrl("")}
                      className="shrink-0 p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/20 transition-colors"
                      title={formAppativaItem?.logo ? "Remover logo (volta pra da AtivaApp)" : "Remover logo"}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* CONFIGURAÇÃO AUTOMÁTICA — integração própria | AtivaApp */}
              {isRootTenant &&
                (!editingId ||
                  apps.find((a) => a.id === editingId)?.tenant_id ===
                    myTenantId) && (
                  <div className="border border-border rounded-xl p-3 space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Configuração automática
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label>Configuração</Label>
                        <div data-integration-picker>
                          <button
                            ref={integrationBtnRef}
                            type="button"
                            onClick={() => {
                              setIntegrationQuery("");
                              if (!integrationPickerOpen) void refreshIntegrations();
                              setIntegrationPickerOpen((o) => !o);
                            }}
                            className={`w-full h-10 px-2 flex items-center gap-2 border rounded-lg text-sm text-left outline-none transition-colors ${
                              formIntegration
                                ? "border-emerald-500/30 bg-emerald-500/10"
                                : "border-border hover:border-emerald-500/40"
                            }`}
                          >
                            {formIntegration ? (
                              <>
                                <AppativaLogo src={integrationIcon(formIntegration)} />
                                <span className="flex-1 min-w-0 truncate text-foreground">
                                  {integrationLabel(formIntegration)}
                                </span>
                              </>
                            ) : (
                              <span className="flex-1 px-1 text-muted-foreground">Sem integração</span>
                            )}
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                          </button>
                          {integrationPickerOpen && (
                            <FloatingPanel
                              anchorRef={integrationBtnRef}
                              open
                              preferredHeight={460}
                              dataAttr="data-integration-picker"
                            >
                              <div className="shrink-0 p-2 border-b border-border">
                                <div className="relative">
                                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                                  <input
                                    autoFocus
                                    value={integrationQuery}
                                    onChange={(e) => setIntegrationQuery(e.target.value)}
                                    placeholder="Buscar integração..."
                                    className="w-full h-9 pl-8 pr-2 bg-transparent border border-border rounded-md text-sm text-foreground outline-none focus:border-emerald-500/50"
                                  />
                                </div>
                              </div>
                              <div className="flex-1 min-h-0 overflow-y-auto py-1">
                                {[
                                  ...(integrationQuery.trim() ? [] : [{ value: "", label: "Sem integração" }]),
                                  ...integrationPickerOptions,
                                ].map((opt) => {
                                  const configured =
                                    !opt.value || configuredIntegrations.some((i) => i.name === opt.value);
                                  return (
                                    <button
                                      key={opt.value || "none"}
                                      type="button"
                                      onClick={() => {
                                        setFormIntegration(opt.value);
                                        setIntegrationPickerOpen(false);
                                      }}
                                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted transition-colors ${
                                        opt.value === formIntegration ? "bg-emerald-500/10" : ""
                                      }`}
                                    >
                                      {opt.value ? (
                                        <AppativaLogo src={integrationIcon(opt.value)} />
                                      ) : (
                                        <span className="w-7 h-7 rounded-md border border-dashed border-border flex items-center justify-center shrink-0">
                                          <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
                                        </span>
                                      )}
                                      <span className="flex-1 min-w-0 truncate text-sm text-foreground">{opt.label}</span>
                                      {!configured && (
                                        <span className="shrink-0 text-[10px] font-medium text-amber-500">API não configurada</span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </FloatingPanel>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Configura o app sozinho ao criar o cliente.
                        </p>
                      </div>

                      {/* AtivaApp — de-para pelo id do catálogo deles (achado
                          25/08/2026: "tem confusões de nomes"). Desde 02/10/2026
                          é um dropdown só: busca por nome OU id, com os já
                          mapeados em cima e as logos de lá. */}
                      <div className="relative" data-appativa-picker>
                        <Label>AtivaApp</Label>
                        <button
                          ref={appativaBtnRef}
                          type="button"
                          onClick={() => {
                            setAppativaQuery("");
                            setAppativaPickerOpen((o) => !o);
                          }}
                          disabled={appativaCatalog.length === 0 && !formAppativaAppId}
                          className={`w-full h-10 px-2 flex items-center gap-2 border rounded-lg text-sm text-left outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            formAppativaAppId
                              ? "border-emerald-500/30 bg-emerald-500/10"
                              : "border-border hover:border-emerald-500/40"
                          }`}
                        >
                          {formAppativaAppId ? (
                            <>
                              <AppativaLogo src={formAppativaItem?.logo} />
                              <span className="flex-1 min-w-0 truncate text-foreground">
                                {formAppativaAppName || formAppativaItem?.nome || formAppativaAppId}
                              </span>
                              {formAppativaItem && appativaCreditUnitPrice != null && (
                                <span className="shrink-0 text-[11px] text-muted-foreground" title="Seu custo por ativação">
                                  {brl(formAppativaItem.valor * appativaCreditUnitPrice)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="flex-1 px-1 text-muted-foreground">
                              {appativaCatalog.length ? "Sem vínculo" : "Catálogo vazio — use o Sync"}
                            </span>
                          )}
                          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                        </button>
                        {appativaPickerOpen && (() => {
                          const q = appativaQuery.trim().toLowerCase();
                          const hit = (it: AppativaCatalogItem) =>
                            !q || it.nome.toLowerCase().includes(q) || it.id.toLowerCase().includes(q);
                          const mapped = appativaCatalog.filter((it) => appativaMappedTo.has(it.id) && hit(it));
                          const others = appativaCatalog.filter((it) => !appativaMappedTo.has(it.id) && hit(it));
                          const option = (it: AppativaCatalogItem) => {
                            const ours = appativaMappedTo.get(it.id);
                            return (
                              <button
                                key={it.id}
                                type="button"
                                onClick={() => pickAppativa(it)}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted transition-colors ${
                                  it.id === formAppativaAppId ? "bg-emerald-500/10" : ""
                                }`}
                              >
                                <AppativaLogo src={it.logo} />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm text-foreground truncate">
                                    {it.nome}
                                    {it.deletado && (
                                      <span className="ml-1 text-[10px] font-medium text-rose-500">removido lá</span>
                                    )}
                                  </span>
                                  <span className="block text-[10px] text-muted-foreground truncate">
                                    {ours?.length ? `↔ ${ours.join(", ")}` : <span className="font-mono">{it.id}</span>}
                                  </span>
                                </span>
                                {appativaCreditUnitPrice != null && (
                                  <span className="shrink-0 text-[11px] text-muted-foreground">
                                    {brl(it.valor * appativaCreditUnitPrice)}
                                  </span>
                                )}
                              </button>
                            );
                          };
                          return (
                            <FloatingPanel
                              anchorRef={appativaBtnRef}
                              open
                              preferredHeight={420}
                              minWidth={320}
                              align="right"
                              dataAttr="data-appativa-picker"
                            >
                              <div className="shrink-0 p-2 border-b border-border">
                                <div className="relative">
                                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                                  <input
                                    autoFocus
                                    value={appativaQuery}
                                    onChange={(e) => setAppativaQuery(e.target.value)}
                                    placeholder="Buscar por nome ou ID..."
                                    className="w-full h-9 pl-8 pr-2 bg-transparent border border-border rounded-md text-sm text-foreground outline-none focus:border-emerald-500/50"
                                  />
                                </div>
                              </div>
                              <div className="flex-1 min-h-0 overflow-y-auto py-1">
                                {mapped.length > 0 && (
                                  <>
                                    <p className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                      Já mapeados · {mapped.length}
                                    </p>
                                    {mapped.map(option)}
                                  </>
                                )}
                                {others.length > 0 && (
                                  <>
                                    <p className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                      {q ? "Outros" : "Todos"} · {others.length}
                                    </p>
                                    {others.map(option)}
                                  </>
                                )}
                                {mapped.length + others.length === 0 && (
                                  <p className="px-3 py-2 text-xs text-muted-foreground">
                                    Nenhum aplicativo encontrado na AtivaApp.
                                  </p>
                                )}
                              </div>
                              {formAppativaAppId && (
                                <button
                                  type="button"
                                  onClick={() => pickAppativa(null)}
                                  className="shrink-0 w-full flex items-center gap-1.5 px-3 py-2 border-t border-border text-xs text-muted-foreground hover:text-rose-500 hover:bg-rose-500/5 transition-colors"
                                >
                                  <X className="w-3 h-3" />
                                  Remover vínculo
                                </button>
                              )}
                            </FloatingPanel>
                          );
                        })()}
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Ativa/renova a licença pela AtivaApp.
                        </p>
                      </div>
                    </div>

                    {/* ✅ Escolha Duplecast x Appativa (achado 26/08/2026, pedido
                        do Márcio) — só faz sentido quando o app É o Duplecast E
                        também está vinculado na Appativa (as duas automações
                        disputam a mesma renovação). Default "Duplecast" — o
                        simples fato de vincular na Appativa NUNCA muda sozinho
                        qual parceiro está ativo; só troca quando escolhido aqui
                        explicitamente. */}
                    {formIntegration === "DUPLECAST" && formAppativaAppId && (
                      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                        <Label>Renovar automaticamente via</Label>
                        <select
                          value={formRenewalSource}
                          onChange={(e) => setFormRenewalSource(e.target.value)}
                          className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50"
                        >
                          <option value="duplecast">
                            DupleCast{duplecastCreditUnitPrice != null ? ` (${brl(duplecastCreditUnitPrice)}/código)` : ""}
                          </option>
                          <option value="appativa">AtivaApp (fallback)</option>
                        </select>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Os dois estão vinculados nesse app — escolha qual realmente
                          ativa quando um cliente paga a renovação. Útil pra trocar
                          pra AtivaApp se os códigos do DupleCast acabarem.
                        </p>
                      </div>
                    )}
                  </div>
                )}

              {/* ✅ 02/10/2026: Tipo — Pago abre preço e período na mesma
                  linha; Parceria abre o servidor parceiro. Parceria voltou
                  como opção normal no mesmo dia (Márcio: apps exclusivos de
                  um servidor continuam existindo, ex: os P2P). */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select
                    value={formCostType}
                    onChange={(e) =>
                      setFormCostType(e.target.value as CostType | "")
                    }
                  >
                    <option value="">Não definido</option>
                    <option value="free">Gratuito</option>
                    <option value="paid">Pago</option>
                    <option value="partnership">Parceria com servidor</option>
                  </Select>
                </div>
                {formCostType === "paid" && (
                  <>
                    <div>
                      <Label>Preço da renovação (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Ex: 30.00"
                        value={formLicensePrice}
                        onChange={(e) => setFormLicensePrice(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Período</Label>
                      <Select
                        value={formLicensePeriod}
                        onChange={(e) =>
                          setFormLicensePeriod(
                            e.target.value as LicensePeriod | "",
                          )
                        }
                      >
                        <option value="">Não definido</option>
                        <option value="annual">Anual</option>
                        <option value="lifetime">Vitalícia</option>
                      </Select>
                    </div>
                  </>
                )}
                {formCostType === "partnership" && (
                  <div className="sm:col-span-2">
                    <Label>Servidor parceiro</Label>
                    <Select
                      value={formPartnerServerId}
                      onChange={(e) => setFormPartnerServerId(e.target.value)}
                    >
                      <option value="">Selecione o servidor...</option>
                      {servers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
              </div>
              )}

              {activeTab === "dispositivo" && (
              <div className="space-y-3 animate-in slide-in-from-right-4 duration-300">
              {/* DISPOSITIVO E TECNOLOGIA */}
              <div className="bg-transparent border border-border rounded-xl p-3 space-y-3">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Dispositivo e Tecnologia
                </h3>

                {/* ✅ 02/10/2026 (pedido do Márcio): IPTV | P2P | Compatibilidade
                    numa linha só. Compatibilidade = lista de múltipla escolha
                    com atalho "Descontinuado" e cadastro de aparelho novo. */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <Label>Tecnologia</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["IPTV", "P2P"] as Technology[]).map((tech) => (
                        <button
                          key={tech}
                          type="button"
                          onClick={() => setFormTechnology(tech)}
                          className={`h-10 rounded-lg border text-sm font-medium transition-colors ${
                            formTechnology === tech
                              ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-500"
                              : "bg-transparent border-border text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {tech}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="relative" data-devices-picker>
                    <Label>Compatibilidade</Label>
                    <button
                      ref={devicesBtnRef}
                      type="button"
                      onClick={() => setDevicesPickerOpen((o) => !o)}
                      className={`w-full h-10 px-3 flex items-center gap-2 border rounded-lg text-sm text-left transition-colors ${
                        !formIsActive
                          ? "border-rose-500/40 bg-rose-500/10 text-rose-500"
                          : formDeviceTypes.length
                            ? "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                            : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <span className="flex-1 min-w-0 truncate">
                        {!formIsActive
                          ? "Descontinuado"
                          : formDeviceTypes.length
                            ? formDeviceTypes.map(deviceLabel).join(", ")
                            : formAutoDevices.length
                              ? `Pela AtivaApp (${formAutoDevices.length})`
                              : "Nenhum aparelho"}
                      </span>
                      {formIsActive && formDeviceTypes.length > 1 && (
                        <span className="shrink-0 text-[11px] font-semibold">{formDeviceTypes.length}</span>
                      )}
                      <ChevronDown className="w-4 h-4 shrink-0 opacity-70" />
                    </button>

                    {devicesPickerOpen && (
                      <FloatingPanel
                        anchorRef={devicesBtnRef}
                        open
                        preferredHeight={460}
                        minWidth={288}
                        align="right"
                        dataAttr="data-devices-picker"
                      >
                        {/* atalho: Descontinuado desmarca o resto; desligar devolve o que estava marcado */}
                        <button
                          type="button"
                          onClick={toggleDiscontinued}
                          className={`shrink-0 w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                            !formIsActive ? "bg-rose-500/10 text-rose-500" : "text-foreground hover:bg-muted"
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              !formIsActive ? "bg-rose-500 border-rose-500 text-white" : "border-border"
                            }`}
                          >
                            {!formIsActive && <Check className="w-3 h-3" />}
                          </span>
                          Descontinuado
                        </button>
                        {!formIsActive && (
                          <div className="shrink-0 px-3 pb-2 bg-rose-500/10">
                            <input
                              type="text"
                              value={formDiscontinuedReplacement}
                              onChange={(e) => setFormDiscontinuedReplacement(e.target.value)}
                              placeholder="Recomendar no lugar (opcional)"
                              className="w-full h-8 px-2 bg-card border border-rose-500/30 rounded-md text-xs text-foreground outline-none focus:border-rose-500/60"
                            />
                          </div>
                        )}

                        <div className="flex-1 min-h-0 overflow-y-auto py-1 border-t border-border">
                          {deviceOptions.map((dt) => {
                            const active = formIsActive && formDeviceTypes.includes(dt);
                            return (
                              <button
                                key={dt}
                                type="button"
                                onClick={() => toggleDeviceType(dt)}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted transition-colors ${
                                  formIsActive ? "text-foreground" : "text-muted-foreground"
                                }`}
                              >
                                <span
                                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                    active ? "bg-sky-500 border-sky-500 text-white" : "border-border"
                                  }`}
                                >
                                  {active && <Check className="w-3 h-3" />}
                                </span>
                                <span className="flex-1 truncate">{deviceLabel(dt)}</span>
                                {formIsActive && !formDeviceTypes.length && formAutoDevices.includes(dt) && (
                                  <span className="text-[10px] text-sky-600 dark:text-sky-400">AtivaApp</span>
                                )}
                              </button>
                            );
                          })}
                        </div>

                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            addCustomDevice();
                          }}
                          className="shrink-0 flex gap-1.5 p-2 border-t border-border"
                        >
                          <input
                            value={newDeviceName}
                            onChange={(e) => setNewDeviceName(e.target.value)}
                            placeholder="Novo aparelho (ex: PS5)"
                            maxLength={30}
                            className="flex-1 min-w-0 h-8 px-2 bg-transparent border border-border rounded-md text-xs text-foreground outline-none focus:border-emerald-500/50"
                          />
                          <button
                            type="submit"
                            disabled={!newDeviceName.trim()}
                            className="h-8 px-2.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                          >
                            Adicionar
                          </button>
                        </form>
                      </FloatingPanel>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground -mt-1">
                  Só aparece pra cliente com a mesma tecnologia e nos aparelhos marcados.
                  {formIsActive && !formDeviceTypes.length && formAutoDevices.length > 0 &&
                    " Sem nada marcado, vale o que a AtivaApp informa."}
                </p>

                <div>
                  <Label>Dados do cliente exibidos no portal</Label>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    Marque o que esse app precisa para configurar.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {PORTAL_VARIABLE_OPTIONS.map((opt) => {
                      const active = formVariableBadges.includes(opt.key);
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => toggleVariableBadge(opt.key)}
                          className={`px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                            active
                              ? "bg-sky-500/10 border-sky-500/40 text-sky-500"
                              : "bg-transparent border-border text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  {formVariableBadges.length > 0 && (
                    <div className="mt-3 rounded-lg border border-border/70 bg-muted/30 p-2.5">
                      <p className="text-[11px] font-medium text-muted-foreground mb-2">
                        Ordem de exibição no portal (esquerda para direita)
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {formVariableBadges.map((key, index) => {
                          const label =
                            PORTAL_VARIABLE_OPTIONS.find(
                              (opt) => opt.key === key,
                            )?.label || key;
                          return (
                            <div
                              key={key}
                              className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-600"
                            >
                              <span>{label}</span>
                              <button
                                type="button"
                                onClick={() => moveVariableBadge(key, "left")}
                                disabled={index === 0}
                                className="px-1 text-[10px] rounded border border-sky-500/20 disabled:opacity-30"
                                title="Mover para a esquerda"
                              >
                                ←
                              </button>
                              <button
                                type="button"
                                onClick={() => moveVariableBadge(key, "right")}
                                disabled={
                                  index === formVariableBadges.length - 1
                                }
                                className="px-1 text-[10px] rounded border border-sky-500/20 disabled:opacity-30"
                                title="Mover para a direita"
                              >
                                →
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {formVariableBadges.includes("codigo") && (
                    <div className="mt-2">
                      <input
                        type="text"
                        value={formAccessCode}
                        onChange={(e) => setFormAccessCode(e.target.value)}
                        placeholder="Ex: 4100, pfast — código fixo que o app pede pra logar"
                        className="w-full px-3 py-2 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Valor fixo, igual pra todos os clientes desse app (ex:
                        Brasil IPTV usa "4100").
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Instruções de configuração (portal do cliente)</Label>
                    <button
                      type="button"
                      onClick={handleSugerirInstrucoes}
                      disabled={sugerindoInstrucoes}
                      className="text-[11px] font-medium text-emerald-500 hover:text-emerald-400 disabled:opacity-50 transition-colors shrink-0"
                    >
                      {sugerindoInstrucoes ? "Buscando..." : "✨ Sugerir com IA"}
                    </button>
                  </div>
                  <textarea
                    value={formPortalInstructions}
                    onChange={(e) => setFormPortalInstructions(e.target.value)}
                    rows={5}
                    placeholder="Passo a passo pro cliente configurar esse app sozinho (ex: onde baixar, como inserir o Device ID, etc). Fica vazio até você preencher — o botão de instruções some do portal se não tiver nada aqui."
                    className="w-full px-3 py-2 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50 resize-y"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Texto livre com o passo a passo básico de configuração.
                  </p>

                  {sugestaoInstrucoes && (
                    <div className="mt-2 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
                      <p className="text-[10px] font-medium text-emerald-600 uppercase tracking-wider">
                        {sugestaoInstrucoes.viaAI
                          ? `Sugestão da IA — baseada em "${sugestaoInstrucoes.basedOnAppName}"`
                          : `Copiado de "${sugestaoInstrucoes.basedOnAppName}" (app quase idêntico, sem gastar IA)`}
                      </p>
                      <p className="text-sm text-foreground/90 whitespace-pre-wrap">
                        {sugestaoInstrucoes.text}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setFormPortalInstructions(sugestaoInstrucoes.text);
                            setSugestaoInstrucoes(null);
                          }}
                          className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
                        >
                          Usar este texto
                        </button>
                        <button
                          type="button"
                          onClick={() => setSugestaoInstrucoes(null)}
                          className="h-8 px-3 rounded-lg border border-border text-muted-foreground text-xs font-medium hover:bg-muted transition-colors"
                        >
                          Descartar
                        </button>
                      </div>
                    </div>
                  )}
                </div>

              </div>
              </div>
              )}

              {activeTab === "campos" && (
              <div className="space-y-3 animate-in slide-in-from-right-4 duration-300">
              {/* CONSTRUTOR DE CAMPOS */}
              <div className="bg-transparent border border-border rounded-xl p-3 space-y-3">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Campos Personalizados
                </h3>
                <p className="text-[11px] text-muted-foreground -mt-1">
                  Clique num campo disponível pra adicionar, arraste os
                  selecionados pra reordenar e renomeie como quiser (nome que
                  aparece no admin e no portal do cliente).
                </p>

                {(() => {
                  const available = ALL_FIELD_TYPES.filter(
                    (type) => !formFields.some((f) => f.type === type),
                  );
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* DISPONÍVEIS */}
                      <div>
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                          Disponíveis
                        </p>
                        <div className="space-y-1.5">
                          {available.length === 0 ? (
                            <div className="text-center py-4 text-muted-foreground text-xs italic border border-dashed border-border rounded-lg">
                              Todos os tipos de campo já foram adicionados.
                            </div>
                          ) : (
                            available.map((type) => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => addField(type)}
                                className="w-full flex items-center gap-2 px-3 py-2 bg-transparent border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:border-emerald-500/50 hover:text-foreground hover:bg-emerald-500/5 transition-colors text-left"
                              >
                                <span className="text-base shrink-0">{FIELD_ICONS[type]}</span>
                                <span className="flex-1 min-w-0 truncate">{FIELD_LABELS[type]}</span>
                                <span className="text-emerald-500 text-xs font-bold shrink-0">+</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>

                      {/* SELECIONADOS */}
                      <div>
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                          Selecionados
                        </p>
                        {formFields.length === 0 ? (
                          <div className="text-center py-4 text-muted-foreground text-xs italic border border-dashed border-border rounded-lg">
                            Nenhum campo extra definido. O app usará apenas o
                            campo "Nome" ou "Usuário".
                          </div>
                        ) : (
                          <DndContext
                            sensors={dndSensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleFieldDragEnd}
                          >
                            <SortableContext
                              items={formFields.map((f) => f.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              <div className="space-y-1.5">
                                {formFields.map((field, index) => (
                                  <SortableFieldRow
                                    key={field.id}
                                    field={field}
                                    index={index}
                                    onRename={renameField}
                                    onRemove={removeField}
                                  />
                                ))}
                              </div>
                            </SortableContext>
                          </DndContext>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
              </div>
              )}
            </ModalBody>

            <ModalFooter>
              <button
                onClick={closeAppModal}
                className="px-4 py-2 text-muted-foreground hover:bg-muted rounded-lg text-sm font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold shadow-lg disabled:opacity-50 transition-all"
              >
                {saving ? "Salvando..." : "Salvar Configuração"}
              </button>
            </ModalFooter>
        </Modal>
      )}
    </div>
  );
}

function IconEdit() {
  return <Pencil className="w-4 h-4" />;
}
function IconSettings() {
  return <Settings className="w-4 h-4" />;
}
function IconX() {
  return <X className="w-4 h-4" />;
}
function IconTrash() {
  return <Trash2 className="w-4 h-4" />;
}
