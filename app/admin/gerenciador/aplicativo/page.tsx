"use client";
// app/admin/gerenciador/aplicativo/page.tsx
import { X, Pencil, Trash2 } from "lucide-react";

import React, { useEffect, useState, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
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
  DeviceType,
  ALL_DEVICE_TYPES,
  DEVICE_TYPE_LABELS,
} from "@/lib/apps/device-types";
import { PORTAL_VARIABLE_OPTIONS } from "@/lib/apps/portal-variable-rules";

// --- TIPOS ---
type AppField = {
  id: string;
  type: AppFieldType;
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
  device_types?: DeviceType[] | null;
  technology?: Technology | null;
  portal_setup_instructions?: string | null;
  access_code?: string | null;
  portal_variable_fields?: string[] | null;
  discontinued_replacement_name?: string | null;
};

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
    { name: string; url: string }[]
  >([]);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [search, setSearch] = useState("");
  const [costFilter, setCostFilter] = useState<"Todos" | CostType>("Todos");
  const [integrationFilter, setIntegrationFilter] = useState<
    "Todos" | "com" | "sem"
  >("Todos");
  const [partnerServerFilter, setPartnerServerFilter] = useState("Todos");
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<
    "Todos" | DeviceType
  >("Todos");
  const [technologyFilter, setTechnologyFilter] = useState<
    "Todos" | Technology
  >("Todos");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const modalScrollYRef = useRef(0);

  useEffect(() => {
    if (!isModalOpen) return;
    if (typeof window === "undefined") return;

    const body = document.body;
    const html = document.documentElement;

    const scrollY = window.scrollY || window.pageYOffset || 0;
    modalScrollYRef.current = scrollY;

    const prevBodyOverflow = body.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyTop = body.style.top;
    const prevBodyWidth = body.style.width;
    const prevHtmlOverflow = html.style.overflow;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.position = prevBodyPosition;
      body.style.top = prevBodyTop;
      body.style.width = prevBodyWidth;

      window.scrollTo(0, modalScrollYRef.current || 0);
    };
  }, [isModalOpen]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formFields, setFormFields] = useState<AppField[]>([]);
  const [formIntegration, setFormIntegration] = useState<string>("");
  const dragIndexRef = useRef<number | null>(null);
  const [formIconUrl, setFormIconUrl] = useState<string>("");
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [formCostType, setFormCostType] = useState<CostType | "">("");
  const [formPartnerServerId, setFormPartnerServerId] = useState<string>("");
  const [formLicensePrice, setFormLicensePrice] = useState<string>("");
  const [formLicensePeriod, setFormLicensePeriod] = useState<
    LicensePeriod | ""
  >("");
  const [formDeviceTypes, setFormDeviceTypes] = useState<DeviceType[]>([]);
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
      const res = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          folder: "apps",
        }),
      });
      const { presignedUrl, publicUrl } = await res.json();
      await fetch(presignedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
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

      const [appsRes, integrationsRes, serversRes] = await Promise.all([
        supabaseBrowser
          .from("apps")
          .select("*")
          .eq("tenant_id", tid)
          .order("name", { ascending: true }),
        supabaseBrowser
          .from("app_integrations")
          .select("app_name, api_url")
          .eq("tenant_id", tid)
          .eq("is_active", true),
        supabaseBrowser
          .from("servers")
          .select("id, name")
          .eq("tenant_id", tid)
          .order("name", { ascending: true }),
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
          url: i.api_url || "",
        })) || [],
      );
      setServers(serversRes.data || []);
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
      if (q) {
        const name = String(a.name ?? "").toLowerCase();
        if (!name.includes(q)) return false;
      }

      if (costFilter !== "Todos" && a.cost_type !== costFilter) return false;

      if (integrationFilter === "com" && !a.integration_type) return false;
      if (integrationFilter === "sem" && a.integration_type) return false;

      if (
        costFilter === "partnership" &&
        partnerServerFilter !== "Todos" &&
        a.partner_server_id !== partnerServerFilter
      )
        return false;

      if (
        deviceTypeFilter !== "Todos" &&
        !(a.device_types || []).includes(deviceTypeFilter)
      )
        return false;

      if (
        technologyFilter !== "Todos" &&
        (a.technology || "IPTV") !== technologyFilter
      )
        return false;

      return true;
    });
  }, [
    search,
    apps,
    costFilter,
    integrationFilter,
    partnerServerFilter,
    deviceTypeFilter,
    technologyFilter,
  ]);

  const hasActiveFilters =
    costFilter !== "Todos" ||
    integrationFilter !== "Todos" ||
    deviceTypeFilter !== "Todos" ||
    technologyFilter !== "Todos";

  function clearFilters() {
    setSearch("");
    setCostFilter("Todos");
    setIntegrationFilter("Todos");
    setPartnerServerFilter("Todos");
    setDeviceTypeFilter("Todos");
    setTechnologyFilter("Todos");
  }

  // ✅ Filtro direto de Custo: "Parceria" já vem com o servidor aninhado (sem 2º passo)
  const costFilterValue =
    costFilter === "partnership"
      ? partnerServerFilter === "Todos"
        ? "partnership"
        : `partnership:${partnerServerFilter}`
      : costFilter;

  function handleCostFilterChange(value: string) {
    if (value.startsWith("partnership:")) {
      setCostFilter("partnership");
      setPartnerServerFilter(value.split(":")[1]);
    } else if (value === "partnership") {
      setCostFilter("partnership");
      setPartnerServerFilter("Todos");
    } else {
      setCostFilter(value as "Todos" | CostType);
      setPartnerServerFilter("Todos");
    }
  }

  // ✅ Só mostra no filtro as opções que realmente têm aplicativo cadastrado
  const hasFreeApps = React.useMemo(
    () => apps.some((a) => a.cost_type === "free"),
    [apps],
  );
  const hasPaidApps = React.useMemo(
    () => apps.some((a) => a.cost_type === "paid"),
    [apps],
  );
  const hasPartnershipApps = React.useMemo(
    () => apps.some((a) => a.cost_type === "partnership"),
    [apps],
  );
  const hasComIntegracao = React.useMemo(
    () => apps.some((a) => !!a.integration_type),
    [apps],
  );
  const hasSemIntegracao = React.useMemo(
    () => apps.some((a) => !a.integration_type),
    [apps],
  );
  const partnerServersInUse = React.useMemo(() => {
    const ids = new Set(
      apps
        .filter((a) => a.cost_type === "partnership" && a.partner_server_id)
        .map((a) => a.partner_server_id as string),
    );
    return servers.filter((s) => ids.has(s.id));
  }, [apps, servers]);

  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  // ✅ Agrupa por custo — Pago → Parceria → Gratuito (cada app aparece uma
  // única vez, sem duplicar por dispositivo). Dentro de cada lista, apps com
  // integração automática sempre no topo, depois por nome.
  function compareApps(a: AppData, b: AppData) {
    const intA = a.integration_type ? 0 : 1;
    const intB = b.integration_type ? 0 : 1;
    if (intA !== intB) return intA - intB;

    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  }

  const COST_GROUPS: { key: CostType; label: string }[] = [
    { key: "paid", label: "💰 Pagos" },
    { key: "partnership", label: "🤝 Parceria" },
    { key: "free", label: "🆓 Gratuitos" },
  ];

  const groupedByCost = React.useMemo(() => {
    const groups: Record<CostType, AppData[]> = {
      paid: [],
      partnership: [],
      free: [],
    };
    // ✅ Descontinuados saem da seção de custo deles (Pago/Parceria/Gratuito)
    // e ganham seção própria — junto com qualquer app sem custo definido
    // (hoje não existe nenhum, mas evita um app sumir da tela se acontecer).
    const discontinued: AppData[] = [];

    filteredApps.forEach((app) => {
      if (app.is_active === false) {
        discontinued.push(app);
      } else if (
        app.cost_type === "paid" ||
        app.cost_type === "partnership" ||
        app.cost_type === "free"
      ) {
        groups[app.cost_type].push(app);
      } else {
        discontinued.push(app);
      }
    });

    (Object.keys(groups) as CostType[]).forEach((key) =>
      groups[key].sort(compareApps),
    );
    discontinued.sort(compareApps);

    return { groups, discontinued };
  }, [filteredApps]);

  type SubGroup = { key: string; label: string; apps: AppData[] };

  // ✅ Parceria: sub-divide por servidor parceiro (mesma fonte do filtro
  // "Parceria por servidor"). Cada app pertence a um único servidor, então
  // não duplica.
  const partnershipSubGroups = React.useMemo<SubGroup[]>(() => {
    const byServer: Record<string, AppData[]> = {};
    const noServer: AppData[] = [];

    groupedByCost.groups.partnership.forEach((app) => {
      if (app.partner_server_id) {
        if (!byServer[app.partner_server_id])
          byServer[app.partner_server_id] = [];
        byServer[app.partner_server_id].push(app);
      } else {
        noServer.push(app);
      }
    });

    const result = Object.keys(byServer)
      .map((serverId) => ({
        key: serverId,
        label: servers.find((s) => s.id === serverId)?.name || "Servidor",
        apps: byServer[serverId],
      }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }),
      );

    if (noServer.length > 0) {
      result.push({
        key: "SEM_SERVIDOR",
        label: "Sem servidor definido",
        apps: noServer,
      });
    }

    return result;
  }, [groupedByCost, servers]);

  // ✅ Gratuitos: sem sub-divisão por Android/iOS — fica uma lista só.
  // Computador continua separado (apps só de computador não se misturam
  // com os de TV/celular).
  const freeSubGroups = React.useMemo<SubGroup[]>(() => {
    const gratuitos: AppData[] = [];
    const computador: AppData[] = [];

    groupedByCost.groups.free.forEach((app) => {
      const types = Array.isArray(app.device_types) ? app.device_types : [];
      if (types.includes("COMPUTADOR")) {
        computador.push(app);
      } else {
        gratuitos.push(app);
      }
    });

    const result: SubGroup[] = [];
    if (gratuitos.length > 0)
      result.push({ key: "GRATUITOS", label: "", apps: gratuitos });
    if (computador.length > 0)
      result.push({ key: "COMPUTADOR", label: "Computador", apps: computador });
    return result;
  }, [groupedByCost]);

  const isRootTenant = true;

  function openNew() {
    setEditingId(null);
    setFormName("");
    setFormUrl("");
    setFormFields([]);
    setFormIntegration("");
    setFormIconUrl("");
    setFormCostType("");
    setFormPartnerServerId("");
    setFormLicensePrice("");
    setFormLicensePeriod("");
    setFormDeviceTypes([]);
    setFormTechnology("IPTV");
    setFormPortalInstructions("");
    setFormAccessCode("");
    setFormVariableBadges([]);
    setFormIsActive(true);
    setFormDiscontinuedReplacement("");
    setIsModalOpen(true);
  }

  function openEdit(app: AppData) {
    setEditingId(app.id);
    setFormName(app.name);
    setFormUrl(app.info_url || "");
    setFormFields(JSON.parse(JSON.stringify(app.fields_config)));
    setFormIntegration(app.integration_type || "");
    setFormIconUrl(app.icon_url || "");
    setFormCostType((app.cost_type as CostType) || "");
    setFormPartnerServerId(app.partner_server_id || "");
    setFormLicensePrice(
      app.license_price != null ? String(app.license_price) : "",
    );
    setFormLicensePeriod((app.license_period as LicensePeriod) || "");
    setFormDeviceTypes((app.device_types as DeviceType[]) || []);
    setFormTechnology((app.technology as Technology) || "IPTV");
    setFormPortalInstructions(app.portal_setup_instructions || "");
    setFormAccessCode(app.access_code || "");
    const selectedBadges = Array.isArray(app.portal_variable_fields)
      ? app.portal_variable_fields
      : [];
    setFormVariableBadges(selectedBadges);
    setFormIsActive(app.is_active !== false);
    setFormDiscontinuedReplacement(app.discontinued_replacement_name || "");
    setIsModalOpen(true);
  }

  function toggleDeviceType(dt: DeviceType) {
    setFormDeviceTypes((prev) =>
      prev.includes(dt) ? prev.filter((d) => d !== dt) : [...prev, dt],
    );
  }

  const generateShortId = () =>
    "f_" + Math.random().toString(36).substring(2, 7);

  function addField(type: AppFieldType) {
    setFormFields((prev) => [...prev, { id: generateShortId(), type }]);
  }

  function removeField(id: string) {
    setFormFields((prev) => prev.filter((f) => f.id !== id));
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
        device_types: formDeviceTypes,
        technology: formTechnology,
        portal_setup_instructions: formPortalInstructions.trim() || null,
        access_code: formAccessCode.trim() || null,
        portal_variable_fields: variableBadgesToSave,
        is_active: formIsActive,
        discontinued_replacement_name:
          !formIsActive && formDiscontinuedReplacement.trim()
            ? formDiscontinuedReplacement.trim()
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
          device_types: formDeviceTypes,
          technology: formTechnology,
          portal_setup_instructions: formPortalInstructions.trim() || null,
          access_code: formAccessCode.trim() || null,
          portal_variable_fields: variableBadgesToSave,
          is_active: formIsActive,
          discontinued_replacement_name:
            !formIsActive && formDiscontinuedReplacement.trim()
              ? formDiscontinuedReplacement.trim()
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

      const { error } = await supabaseBrowser
        .from("apps")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tid);
      if (error) throw error;

      addToast("success", "Removido", "Aplicativo removido da sua lista.");
      loadData();
    } catch (e: any) {
      addToast("error", "Erro", e?.message ?? "Erro inesperado.");
    }
  }

  function renderAppCard(app: AppData) {
    const partnerServerName = app.partner_server_id
      ? servers.find((s) => s.id === app.partner_server_id)?.name || "Servidor"
      : "";
    const licensePeriodLabel =
      app.license_period === "annual"
        ? "/ano"
        : app.license_period === "lifetime"
          ? " vitalícia"
          : "";
    const needsConfiguration =
      app.integration_type &&
      !configuredIntegrations.some((i) => i.name === app.integration_type);
    const appLabel =
      app.integration_type === "GERENCIAAPP"
        ? "GerenciaApp"
        : app.integration_type === "DUPLECAST"
          ? "DupleCast"
          : app.integration_type === "IBOSOL"
            ? "IBO Sol"
            : app.integration_type === "IBOPRO"
              ? "IBO Pro Player"
              : app.integration_type === "QUICKPLAYER"
                ? "Quick Player"
                : app.integration_type === "MESSITV"
                  ? "MessiTV"
                  : app.integration_type === "BOBPLAYER"
                    ? "BOB Player"
                    : app.integration_type === "IBOPLAYER"
                      ? "IBO Player"
                      : app.integration_type === "IPTVDUPLEX"
                        ? "IPTV Duplex Play"
                        : app.integration_type === "IPTVPLAYERIO"
                          ? "IPTV Playerio"
                          : app.integration_type === "DUPLEXTV"
                            ? "Duplex TV"
                            : app.integration_type === "CLOUDDY"
                              ? "ClouDDy"
                              : app.integration_type === "NINJAPLAYER"
                                ? "Ninja Player"
                                : app.integration_type === "LAZERPLAY"
                                  ? "Lazer Play"
                                  : app.integration_type === "FUNPLAY"
                                    ? "Fun Play"
                                    : app.integration_type === "FOCOXPLAY"
                                      ? "FocoX Play"
                                      : app.integration_type;

    return (
      <div
        key={app.id}
        className="group bg-card border border-border rounded-xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-all relative"
      >
        <div className="flex justify-between items-start mb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {app.icon_url ? (
                <img
                  src={app.icon_url}
                  alt=""
                  className="w-8 h-8 rounded-lg object-cover border border-border shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-base shrink-0">
                  📱
                </div>
              )}
              <h3 className="font-bold text-lg text-foreground leading-none">
                {app.name}
              </h3>
            </div>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {app.tenant_id !== myTenantId && (
                <span className="inline-flex items-center text-[10px] font-medium bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded-full">
                  🔒
                </span>
              )}

              {app.is_active === false && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-rose-500/10 text-rose-500 border border-rose-500/20">
                  🚫 Descontinuado
                </span>
              )}

              {app.integration_type && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm ${needsConfiguration ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" : "bg-sky-500/10 text-sky-500 border border-sky-500/20"}`}
                >
                  {needsConfiguration
                    ? `${appLabel} - Configurar API`
                    : `${appLabel} - Integrado`}
                </span>
              )}

              {app.cost_type === "free" && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-sky-500/10 text-sky-500 border border-sky-500/20">
                  🆓 Gratuito
                </span>
              )}

              {app.cost_type === "partnership" && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-violet-500/10 text-violet-500 border border-violet-500/20">
                  🤝 Parceria: {partnerServerName}
                </span>
              )}

              {app.cost_type === "paid" && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  💰{" "}
                  {app.license_price
                    ? `R$ ${Number(app.license_price).toFixed(2).replace(".", ",")}${licensePeriodLabel}`
                    : "Pago"}
                </span>
              )}

              {app.technology === "P2P" && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-fuchsia-500/10 text-fuchsia-500 border border-fuchsia-500/20">
                  P2P
                </span>
              )}

              {(app.device_types || []).map((dt) => (
                <span
                  key={dt}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-muted text-muted-foreground border border-border"
                >
                  {DEVICE_TYPE_LABELS[dt]}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            {app.tenant_id === myTenantId && (
              <>
                <button
                  onClick={() => openEdit(app)}
                  className="p-1.5 text-amber-500 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 rounded-lg transition-all"
                  title="Editar"
                >
                  <IconEdit />
                </button>

                <button
                  onClick={() => handleDelete(app.id)}
                  className="p-1.5 text-rose-500 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 rounded-lg transition-all"
                  title="Excluir"
                >
                  <IconTrash />
                </button>
              </>
            )}
          </div>
        </div>

        {app.info_url && (
          <a
            href={app.info_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-sky-500 hover:underline truncate max-w-[200px] block mb-3"
          >
            🌐 {app.info_url}
          </a>
        )}

        <div className="pt-3 border-t border-border space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Campos exigidos:
          </p>

          <div className="flex flex-wrap gap-1">
            {app.fields_config.length > 0 ? (
              app.fields_config.map((field, idx) => (
                <span
                  key={idx}
                  className="px-2 py-1 bg-muted border border-border rounded text-[10px] text-muted-foreground font-medium flex items-center gap-1"
                >
                  {FIELD_ICONS[field.type]} {FIELD_LABELS[field.type]}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-muted-foreground italic">
                Apenas nome (padrão)
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderAppGroup(
    key: string,
    label: string,
    appsInGroup: AppData[],
    subGroups?: SubGroup[],
  ) {
    const isCollapsed = collapsedGroups[key];
    const total = subGroups
      ? subGroups.reduce((n, sg) => n + sg.apps.length, 0)
      : appsInGroup.length;
    return (
      <div key={key} className="space-y-3">
        <div
          className="flex items-center justify-between cursor-pointer border-b border-border pb-2 group select-none transition-colors hover:border-emerald-500/50"
          onClick={() => toggleGroup(key)}
        >
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground/90 uppercase tracking-wider">
              {label}
            </h2>
            <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm">
              {total} {total > 1 ? "Apps" : "App"}
            </span>
          </div>

          <button
            className="text-muted-foreground group-hover:text-emerald-500 transition-colors p-1"
            title={isCollapsed ? "Expandir" : "Minimizar"}
          >
            <svg
              className={`w-4 h-4 transition-transform duration-300 ${isCollapsed ? "" : "rotate-180"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>

        {!isCollapsed &&
          (subGroups ? (
            <div className="space-y-5 animate-in slide-in-from-top-2 duration-300">
              {subGroups.map((sg) => (
                <div key={sg.key} className="space-y-2">
                  {sg.label && (
                    <h3 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/80 uppercase tracking-wide pl-0.5">
                      {sg.label}
                      <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm normal-case">
                        {sg.apps.length} {sg.apps.length > 1 ? "Apps" : "App"}
                      </span>
                    </h3>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                    {sg.apps.map((app) => renderAppCard(app))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 animate-in slide-in-from-top-2 duration-300">
              {appsInGroup.map((app) => renderAppCard(app))}
            </div>
          ))}
      </div>
    );
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

      {/* HEADER DA PÁGINA */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate text-foreground">
              Aplicativos
            </h1>
          </div>
        </div>

        <button
          onClick={openNew}
          className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
        >
          <span className="text-base leading-none">+</span>
          Novo Aplicativo
        </button>
      </div>

      {/* BARRA DE FILTROS */}
      <div className="px-3 sm:px-0">
        <div className="md:p-4 md:bg-card md:border md:border-border md:rounded-xl md:sticky md:top-4 z-20 space-y-3">
          <div className="hidden md:block text-xs font-medium uppercase text-muted-foreground tracking-wider">
            Filtros Rápidos
          </div>

          {/* MOBILE (somente): pesquisa + botão abrir painel */}
          <div className="md:hidden flex items-center gap-2">
            <div className="flex-1 relative">
              <Input
                placeholder="Buscar aplicativo por nome..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-rose-500"
                >
                  <IconX />
                </button>
              )}
            </div>

            <button
              onClick={() => setMobileFiltersOpen((v) => !v)}
              className={`h-10 px-3 rounded-lg border font-medium text-sm transition-colors ${
                hasActiveFilters
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                  : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              title="Filtros"
            >
              Filtros
            </button>
          </div>

          {/* DESKTOP (somente): tudo na mesma linha */}
          <div className="hidden md:flex items-center gap-2">
            <div className="flex-1 relative">
              <Input
                placeholder="Buscar aplicativo por nome..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-rose-500"
                >
                  <IconX />
                </button>
              )}
            </div>

            <div className="w-[210px]">
              <Select
                value={costFilterValue}
                onChange={(e) => handleCostFilterChange(e.target.value)}
              >
                <option value="Todos">Custo (Todos)</option>
                {hasFreeApps && <option value="free">🆓 Gratuito</option>}
                {hasPaidApps && <option value="paid">💰 Pago</option>}
                {hasPartnershipApps && (
                  <option value="partnership">
                    🤝 Parceria (Todos os servidores)
                  </option>
                )}
                {partnerServersInUse.length > 0 && (
                  <optgroup label="🤝 Parceria por servidor">
                    {partnerServersInUse.map((s) => (
                      <option key={s.id} value={`partnership:${s.id}`}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </div>

            <div className="w-[170px]">
              <Select
                value={integrationFilter}
                onChange={(e) =>
                  setIntegrationFilter(
                    e.target.value as "Todos" | "com" | "sem",
                  )
                }
              >
                <option value="Todos">Integração (Todas)</option>
                {hasComIntegracao && (
                  <option value="com">Com integração</option>
                )}
                {hasSemIntegracao && (
                  <option value="sem">Sem integração</option>
                )}
              </Select>
            </div>

            <div className="w-[190px]">
              <Select
                value={deviceTypeFilter}
                onChange={(e) =>
                  setDeviceTypeFilter(e.target.value as "Todos" | DeviceType)
                }
              >
                <option value="Todos">Dispositivo (Todos)</option>
                {ALL_DEVICE_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {DEVICE_TYPE_LABELS[dt]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="w-[130px]">
              <Select
                value={technologyFilter}
                onChange={(e) =>
                  setTechnologyFilter(e.target.value as "Todos" | Technology)
                }
              >
                <option value="Todos">Tec. (Todas)</option>
                <option value="IPTV">IPTV</option>
                <option value="P2P">P2P</option>
              </Select>
            </div>

            <button
              onClick={clearFilters}
              className="h-10 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 text-sm font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
            >
              <IconX /> Limpar
            </button>
          </div>

          {/* Painel de filtros no mobile */}
          {mobileFiltersOpen && (
            <div className="md:hidden mt-1 p-3 rounded-xl border border-border bg-transparent space-y-2">
              <Select
                value={costFilterValue}
                onChange={(e) => handleCostFilterChange(e.target.value)}
              >
                <option value="Todos">Custo (Todos)</option>
                {hasFreeApps && <option value="free">🆓 Gratuito</option>}
                {hasPaidApps && <option value="paid">💰 Pago</option>}
                {hasPartnershipApps && (
                  <option value="partnership">
                    🤝 Parceria (Todos os servidores)
                  </option>
                )}
                {partnerServersInUse.length > 0 && (
                  <optgroup label="🤝 Parceria por servidor">
                    {partnerServersInUse.map((s) => (
                      <option key={s.id} value={`partnership:${s.id}`}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>

              <Select
                value={integrationFilter}
                onChange={(e) =>
                  setIntegrationFilter(
                    e.target.value as "Todos" | "com" | "sem",
                  )
                }
              >
                <option value="Todos">Integração (Todas)</option>
                {hasComIntegracao && (
                  <option value="com">Com integração</option>
                )}
                {hasSemIntegracao && (
                  <option value="sem">Sem integração</option>
                )}
              </Select>

              <Select
                value={deviceTypeFilter}
                onChange={(e) =>
                  setDeviceTypeFilter(e.target.value as "Todos" | DeviceType)
                }
              >
                <option value="Todos">Dispositivo (Todos)</option>
                {ALL_DEVICE_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {DEVICE_TYPE_LABELS[dt]}
                  </option>
                ))}
              </Select>

              <Select
                value={technologyFilter}
                onChange={(e) =>
                  setTechnologyFilter(e.target.value as "Todos" | Technology)
                }
              >
                <option value="Todos">Tecnologia (Todas)</option>
                <option value="IPTV">IPTV</option>
                <option value="P2P">P2P</option>
              </Select>

              <button
                onClick={() => {
                  clearFilters();
                  setMobileFiltersOpen(false);
                }}
                className="w-full h-10 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 text-sm font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
              >
                <IconX /> Limpar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* LISTAGEM */}
      {loading ? (
        <div className="text-center py-10 text-muted-foreground bg-transparent rounded-xl border border-dashed border-border">
          Carregando aplicativos...
        </div>
      ) : filteredApps.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground bg-transparent rounded-xl border border-dashed border-border">
          {apps.length === 0
            ? 'Nenhum aplicativo cadastrado. Clique em "Novo Aplicativo" para começar.'
            : search.trim()
              ? `Nenhum aplicativo encontrado para "${search.trim()}".`
              : hasActiveFilters
                ? "Nenhum aplicativo encontrado para os filtros selecionados."
                : "Nenhum aplicativo para exibir."}
        </div>
      ) : (
        <div className="px-3 sm:px-0 space-y-6">
          {COST_GROUPS.filter(
            (g) => groupedByCost.groups[g.key].length > 0,
          ).map((g) =>
            renderAppGroup(
              g.key,
              g.label,
              groupedByCost.groups[g.key],
              g.key === "partnership"
                ? partnershipSubGroups
                : g.key === "free"
                  ? freeSubGroups
                  : undefined,
            ),
          )}
          {groupedByCost.discontinued.length > 0 &&
            renderAppGroup(
              "DESCONTINUADO",
              "🚫 Descontinuado",
              groupedByCost.discontinued,
            )}
          <div className="h-24 md:h-20" />
        </div>
      )}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4 animate-in fade-in duration-200 overflow-hidden overscroll-contain"
          onMouseDown={(e) => {
            // ✅ onMouseDown (não onClick) + checagem do alvo exatamente no
            // fundo — só fecha se o clique COMEÇAR no backdrop. Com onClick
            // puro, selecionar texto dentro do modal e soltar o mouse fora
            // fechava o modal sem querer (pedido do Márcio, 31/07/2026).
            if (e.target === e.currentTarget) setIsModalOpen(false);
          }}
        >
          <div
            className="w-full h-full sm:h-auto sm:max-w-3xl bg-card border-0 sm:border border-border sm:rounded-xl shadow-2xl flex flex-col max-h-full sm:max-h-[90vh] animate-in zoom-in-95 duration-200"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-transparent sm:rounded-t-xl">
              <h2 className="text-lg font-medium text-foreground">
                {editingId ? "Editar Aplicativo" : "Novo Aplicativo"}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 p-6 overflow-y-auto space-y-6 overscroll-contain">
              {/* DADOS BÁSICOS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  <Label>URL de Configuração (Global)</Label>
                  <Input
                    placeholder="https://..."
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    disabled={isUrlLocked}
                    className={
                      isUrlLocked ? "opacity-60 cursor-not-allowed" : ""
                    }
                  />
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
                  {formIconUrl ? (
                    <img
                      src={formIconUrl}
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
                      PNG, JPG, WebP — funciona com figurinhas do WhatsApp
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
                      title="Remover logo"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* INTEGRAÇÃO */}
              {isRootTenant &&
                (!editingId ||
                  apps.find((a) => a.id === editingId)?.tenant_id ===
                    myTenantId) && (
                  <div>
                    <Label>Integração automática</Label>
                    <select
                      value={formIntegration}
                      onChange={(e) => setFormIntegration(e.target.value)}
                      className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50"
                    >
                      <option value="">Sem integração</option>
                      <option value="GERENCIAAPP">
                        GerenciaApp (IBO Revenda, etc)
                      </option>
                      <option value="DUPLECAST">DupleCast</option>
                      {/* IBOSOL removido do select em 27/07/2026 (pedido do
                          Márcio) — consolidava vários apps da família via
                          activation.iboplayer.com, que não funciona mais.
                          Apps que já estavam com integration_type=IBOSOL
                          (ex: "IBO Player") continuam salvos assim até serem
                          migrados individualmente — não afeta quem já usa. */}
                      <option value="IBOPRO">IBO Pro Player</option>
                      <option value="QUICKPLAYER">Quick Player</option>
                      <option value="MESSITV">MessiTV</option>
                      <option value="BOBPLAYER">BOB Player</option>
                      <option value="IBOPLAYER">IBO Player</option>
                      <option value="IPTVDUPLEX">IPTV Duplex Play</option>
                      <option value="IPTVPLAYERIO">IPTV Playerio</option>
                      <option value="DUPLEXTV">Duplex TV</option>
                      <option value="CLOUDDY">ClouDDy</option>
                      <option value="NINJAPLAYER">Ninja Player</option>
                    </select>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Quando configurado, habilita automação ao criar clientes.
                    </p>
                  </div>
                )}

              {/* CUSTO E PARCERIA */}
              <div className="bg-transparent border border-border rounded-xl p-4 space-y-4">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Custo e Parceria
                </h3>

                <div>
                  <Label>Tipo</Label>
                  <Select
                    value={formCostType}
                    onChange={(e) =>
                      setFormCostType(e.target.value as CostType | "")
                    }
                  >
                    <option value="">Não definido</option>
                    <option value="free">Gratuito (universal)</option>
                    <option value="paid">Pago (licença à parte)</option>
                    <option value="partnership">Parceria com servidor</option>
                  </Select>
                </div>

                {formCostType === "partnership" && (
                  <div>
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
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Este app é exclusivo/gratuito para clientes deste
                      servidor.
                    </p>
                  </div>
                )}

                {formCostType === "paid" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Valor da licença (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Ex: 30.00"
                        value={formLicensePrice}
                        onChange={(e) => setFormLicensePrice(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Período da licença</Label>
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
                        <option value="lifetime">
                          Vitalícia (paga uma vez)
                        </option>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              {/* DISPOSITIVO E TECNOLOGIA */}
              <div className="bg-transparent border border-border rounded-xl p-4 space-y-4">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Dispositivo e Tecnologia
                </h3>

                <div>
                  <Label>Tecnologia</Label>
                  <div className="flex gap-2">
                    {(["IPTV", "P2P"] as Technology[]).map((tech) => (
                      <button
                        key={tech}
                        type="button"
                        onClick={() => setFormTechnology(tech)}
                        className={`flex-1 h-10 rounded-lg border text-sm font-medium transition-colors ${
                          formTechnology === tech
                            ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-500"
                            : "bg-transparent border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {tech}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Só aparece para cliente com a mesma tecnologia (IPTV ou
                    P2P).
                  </p>
                </div>

                <div>
                  <Label>Dispositivos compatíveis</Label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_DEVICE_TYPES.map((dt) => {
                      const active = formDeviceTypes.includes(dt);
                      return (
                        <button
                          key={dt}
                          type="button"
                          onClick={() => toggleDeviceType(dt)}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                            active
                              ? "bg-sky-500/10 border-sky-500/40 text-sky-500"
                              : "bg-transparent border-border text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {DEVICE_TYPE_LABELS[dt]}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Marque os aparelhos onde esse app funciona.
                  </p>
                </div>

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
                  <Label>Instruções de configuração (portal do cliente)</Label>
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
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label>Aplicativo descontinuado</Label>
                    <button
                      type="button"
                      onClick={() => setFormIsActive((v) => !v)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${!formIsActive ? "bg-rose-500" : "bg-muted"}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-card transition ${!formIsActive ? "translate-x-4.5" : "translate-x-1"}`}
                      />
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Continua aparecendo no catálogo de "+ Adicionar aplicativo"
                    do portal (quem já usa precisa achar ele lá), mas ao tentar
                    adicionar mostra um aviso pra trocar em vez de adicionar.
                    Quem já tem também vê o aviso no card.
                  </p>
                  {!formIsActive && (
                    <input
                      type="text"
                      value={formDiscontinuedReplacement}
                      onChange={(e) =>
                        setFormDiscontinuedReplacement(e.target.value)
                      }
                      placeholder="Recomendar no lugar (opcional) — ex: DupleCast"
                      className="w-full h-9 px-3 mt-2 bg-transparent border border-rose-500/30 rounded-lg text-sm text-foreground outline-none focus:border-rose-500/60"
                    />
                  )}
                </div>
              </div>

              {/* CONSTRUTOR DE CAMPOS */}
              <div className="bg-transparent border border-border rounded-xl p-4 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Campos Personalizados
                  </h3>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {ALL_FIELD_TYPES.map((type) => {
                      const alreadyAdded = formFields.some(
                        (f) => f.type === type,
                      );
                      return (
                        <button
                          key={type}
                          onClick={() => addField(type)}
                          disabled={alreadyAdded}
                          className={`text-xs px-2 py-1 border rounded font-medium transition-colors flex items-center gap-1
                            ${
                              alreadyAdded
                                ? "opacity-30 cursor-not-allowed bg-muted border-border text-muted-foreground"
                                : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20"
                            }`}
                        >
                          {FIELD_ICONS[type]} + {FIELD_LABELS[type]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  {formFields.length === 0 && (
                    <div className="text-center py-4 text-muted-foreground text-xs italic border border-dashed border-border rounded-lg">
                      Nenhum campo extra definido. O app usará apenas o campo
                      "Nome" ou "Usuário".
                    </div>
                  )}

                  {formFields.map((field, index) => (
                    <div
                      key={field.id}
                      draggable
                      onDragStart={() => {
                        dragIndexRef.current = index;
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        const from = dragIndexRef.current;
                        if (from === null || from === index) return;
                        setFormFields((prev) => {
                          const next = [...prev];
                          const [moved] = next.splice(from, 1);
                          next.splice(index, 0, moved);
                          return next;
                        });
                        dragIndexRef.current = null;
                      }}
                      onDragEnd={() => {
                        dragIndexRef.current = null;
                      }}
                      className="flex items-center gap-3 px-3 py-2 bg-card border border-border rounded-lg cursor-default select-none"
                    >
                      <span
                        className="text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing transition-colors text-sm px-0.5"
                        title="Arrastar para reordenar"
                      >
                        ⠿
                      </span>
                      <span className="text-base">
                        {FIELD_ICONS[field.type]}
                      </span>
                      <span className="flex-1 text-sm font-medium text-foreground/90">
                        {FIELD_LABELS[field.type]}
                      </span>
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        #{index + 1}
                      </span>
                      <button
                        onClick={() => removeField(field.id)}
                        className="w-8 h-8 flex items-center justify-center text-rose-500 hover:bg-rose-500/20 rounded-lg transition-colors"
                        title="Remover campo"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border bg-transparent flex justify-end gap-2 sm:rounded-b-xl">
              <button
                onClick={() => setIsModalOpen(false)}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconEdit() {
  return <Pencil className="w-4 h-4" />;
}
function IconX() {
  return <X className="w-4 h-4" />;
}
function IconTrash() {
  return <Trash2 className="w-4 h-4" />;
}
