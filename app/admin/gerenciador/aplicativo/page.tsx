"use client";
import { X, Pencil } from "lucide-react";

import React, { useEffect, useState, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, {
  ToastMessage,
} from "@/app/admin/ToastNotifications";
import { getCurrentTenantId } from "@/lib/tenant";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// --- TIPOS ---
type AppFieldType =
  | "date"
  | "mac"
  | "device_key"
  | "email"
  | "password"
  | "url"
  | "obs";

type AppField = {
  id: string;
  type: AppFieldType;
};

// Label fixo derivado do tipo — usado no card e no export
const FIELD_LABELS: Record<AppFieldType, string> = {
  date: "Vencimento",
  mac: "Device ID (MAC)",
  device_key: "Device Key",
  email: "E-mail",
  password: "Senha",
  url: "URL",
  obs: "Obs",
};

// Ícone visual por tipo
const FIELD_ICONS: Record<AppFieldType, string> = {
  date: "📅",
  mac: "🔌",
  device_key: "🔑",
  email: "✉️",
  password: "🔒",
  url: "🔗",
  obs: "📝",
};

// Ordem de exibição no construtor
const ALL_FIELD_TYPES: AppFieldType[] = [
  "date",
  "mac",
  "device_key",
  "email",
  "password",
  "url",
  "obs",
];

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
const [apps, setApps] = useState<AppData[]>([]);
  const [myTenantId, setMyTenantId] = useState<string | null>(null);
  const [configuredIntegrations, setConfiguredIntegrations] = useState<
    { name: string; url: string }[]
  >([]);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [search, setSearch] = useState("");
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
  const [formLicensePeriod, setFormLicensePeriod] = useState<LicensePeriod | "">("");

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
      const tid = await getCurrentTenantId();
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
    if (!q) return apps;

    return apps.filter((a) => {
      const name = String(a.name ?? "").toLowerCase();
      return name.includes(q);
    });
  }, [search, apps]);

  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  const groupedApps = React.useMemo(() => {
    const groups: Record<string, AppData[]> = {};

    filteredApps.forEach((app) => {
      let family = app.integration_type || "SEM_INTEGRACAO";

      if (
        family !== "SEM_INTEGRACAO" &&
        family !== "GERENCIAAPP" &&
        family !== "IBOSOL"
      ) {
        family = "OUTRAS_INTEGRACOES";
      }

      if (!groups[family]) groups[family] = [];
      groups[family].push(app);
    });

    const sortedFamilies = Object.keys(groups).sort((a, b) => {
      const orderWeight: Record<string, number> = {
        GERENCIAAPP: 1,
        IBOSOL: 2,
        OUTRAS_INTEGRACOES: 3,
        SEM_INTEGRACAO: 4,
      };

      const valA = orderWeight[a] || 10;
      const valB = orderWeight[b] || 10;

      if (valA !== valB) return valA - valB;
      return a.localeCompare(b);
    });

    return { groups, sortedFamilies };
  }, [filteredApps]);

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
    setFormLicensePrice(app.license_price != null ? String(app.license_price) : "");
    setFormLicensePeriod((app.license_period as LicensePeriod) || "");
    setIsModalOpen(true);
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
      const tid = await getCurrentTenantId();
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

      const insertPayload = {
        tenant_id: tid,
        name: formName.trim(),
        info_url: safeUrl || null,
        icon_url: formIconUrl || null,
        fields_config: formFields,
        integration_type: formIntegration || null,
        cost_type: formCostType || null,
        partner_server_id: isPartnership ? formPartnerServerId : null,
        license_price: isPaid && formLicensePrice ? Number(formLicensePrice) : null,
        license_period: isPaid && formLicensePeriod ? formLicensePeriod : null,
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
          license_price: isPaid && formLicensePrice ? Number(formLicensePrice) : null,
          license_period: isPaid && formLicensePeriod ? formLicensePeriod : null,
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
      const tid = await getCurrentTenantId();
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
      app.license_period === "annual" ? "/ano" : app.license_period === "lifetime" ? " vitalícia" : "";
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

              {app.integration_type && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm ${needsConfiguration ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"}`}
                >
                  ⚡{" "}
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

      {/* BARRA DE BUSCA */}
      <div className="px-3 sm:px-0">
        <div className="md:p-4 md:bg-card md:border md:border-border md:rounded-xl md:sticky md:top-4 z-20">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Buscar aplicativo por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {search.trim() ? (
              <button
                onClick={() => setSearch("")}
                className="h-10 px-3 rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                title="Limpar busca"
              >
                Limpar
              </button>
            ) : null}
          </div>
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
              : "Nenhum aplicativo para exibir."}
        </div>
      ) : (
        <div className="px-3 sm:px-0 space-y-6">
          {groupedApps.sortedFamilies.map((family) => {
            const appsInFamily = groupedApps.groups[family];
            const isCollapsed = collapsedGroups[family];

            let familyName = "";
            let familyIcon = "⚡";

            if (family === "GERENCIAAPP") {
              familyName = "GerenciaApp";
            } else if (family === "IBOSOL") {
              familyName = "IBO Sol";
            } else if (family === "OUTRAS_INTEGRACOES") {
              familyName = "Outras Integrações";
            } else if (family === "SEM_INTEGRACAO") {
              familyName = "Sem Integração";
              familyIcon = "📁";
            } else {
              familyName = family;
            }

            return (
              <div key={family} className="space-y-3">
                <div
                  className="flex items-center justify-between cursor-pointer border-b border-border pb-2 group select-none transition-colors hover:border-emerald-500/50"
                  onClick={() => toggleGroup(family)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{familyIcon}</span>
                    <h2 className="text-sm font-bold text-foreground/90 uppercase tracking-wider">
                      Família: {familyName}
                    </h2>
<span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm">
                      {appsInFamily.length}{" "}
                      {appsInFamily.length > 1 ? "Apps" : "App"}
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

                {!isCollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 animate-in slide-in-from-top-2 duration-300">
                    {appsInFamily.map((app) => renderAppCard(app))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="h-24 md:h-20" />
        </div>
      )}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200 overflow-hidden overscroll-contain"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="w-full max-w-lg sm:max-w-2xl bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-transparent rounded-t-xl">
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

            <div className="p-6 overflow-y-auto space-y-6 overscroll-contain">
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
                      <option value="IBOSOL">IBO Sol</option>
                      <option value="IBOPRO">IBO Pro Player</option>
                      <option value="QUICKPLAYER">Quick Player</option>
                      <option value="LAZERPLAY">Lazer Play</option>
                      <option value="FUNPLAY">Fun Play</option>
                      <option value="FOCOXPLAY">FocoX Play</option>
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
                    onChange={(e) => setFormCostType(e.target.value as CostType | "")}
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
                      Este app é exclusivo/gratuito para clientes deste servidor.
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
                        onChange={(e) => setFormLicensePeriod(e.target.value as LicensePeriod | "")}
                      >
                        <option value="">Não definido</option>
                        <option value="annual">Anual</option>
                        <option value="lifetime">Vitalícia (paga uma vez)</option>
                      </Select>
                    </div>
                  </div>
                )}
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

            <div className="px-6 py-4 border-t border-border bg-transparent flex justify-end gap-2 rounded-b-xl">
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
function IconTrash() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
