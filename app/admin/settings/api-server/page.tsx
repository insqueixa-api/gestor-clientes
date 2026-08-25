"use client";
// app/admin/settings/api-server/page.tsx
import { Loader2, Pencil, RefreshCcw, Trash2, CreditCard } from "lucide-react";

import { useEffect, useRef, useState } from "react";
import type { ReactNode, MouseEvent } from "react";
import dynamic from "next/dynamic";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
const NovaIntegracaoModal = dynamic(() => import("./nova_integracao_modal"), {
  ssr: false,
});
const AppIntegracaoModal = dynamic(() => import("./app_integracao_modal"), {
  ssr: false,
});
const ApiIntegracaoModal = dynamic(() => import("./api_integracao_modal"), {
  ssr: false,
});
const AppativaCatalogModal = dynamic(
  () => import("./appativa_catalog_modal"),
  { ssr: false },
);
const RecargaAppativaModal = dynamic(
  () => import("./recarga_appativa_modal"),
  { ssr: false },
);

type IntegrationRow = {
  id: string;
  tenant_id: string;

  provider: string; // 'NATV'
  integration_name: string;

  owner_id: number | null;
  owner_username: string | null;
  credits_last_known: number | null;
  credits_last_sync_at: string | null;

  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
};

// ✅ icon_url próprio (achado 26/08/2026) — vem de uma query separada
// contra server_integrations (a view vw_server_integrations não expõe essa
// coluna), mesmo padrão de serverLogoMap logo abaixo.
type ServerIntegrationIcon = { id: string; icon_url: string | null };

type AppIntegration = {
  id: string;
  tenant_id: string;
  app_name: string;
  label: string;
  login_email: string | null;
  login_password: string | null;
  api_url: string | null;
  pin?: string | null;
  icon_url?: string | null;
  is_active: boolean;
  created_at: string;
};

// ✅ "Parceiros" (24/08/2026) — terceira categoria, separada de aplicativo
// (robô que configura app no dispositivo do cliente) e servidor (painel
// IPTV): integrações de API de parceiros externos, ex: Appativa. Chave de
// API sempre lida daqui (nunca de env var), porque pode rotacionar.
type PartnerIntegration = {
  id: string;
  tenant_id: string;
  provider: string;
  label: string;
  login_email: string | null;
  login_password: string | null;
  api_key: string | null;
  api_url: string | null;
  credits_available: number | null;
  credits_last_sync_at: string | null;
  credit_unit_price: number | null;
  icon_url?: string | null;
  is_active: boolean;
  created_at: string;
};

export default function ApiServerPage() {
  const tenantId = useTenantId();
  const [loading, setLoading] = useState(true);
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // ✅ Página única com seções colapsáveis (25/08/2026, pedido do Márcio) —
  // antes eram 3 abas que trocavam a view inteira; agora Servidores,
  // Parceiros e Aplicativos ficam todos na mesma tela, cada um com sua
  // seta pra colapsar/expandir, mesmo padrão de gerenciador/aplicativo.
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const toggleGroup = (groupName: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  const [appList, setAppList] = useState<AppIntegration[]>([]);
  const [editingApp, setEditingApp] = useState<AppIntegration | null>(null);
  const [showTypeChooser, setShowTypeChooser] = useState(false);
  const [isModalAppOpen, setIsModalAppOpen] = useState(false);
  const [partnerList, setPartnerList] = useState<PartnerIntegration[]>([]);
  const [editingPartner, setEditingPartner] =
    useState<PartnerIntegration | null>(null);
  const [isModalPartnerOpen, setIsModalPartnerOpen] = useState(false);
  const [syncingCreditsFor, setSyncingCreditsFor] = useState<string | null>(
    null,
  );
  const [catalogModalFor, setCatalogModalFor] = useState<string | null>(null);
  const [recargaAppativaFor, setRecargaAppativaFor] =
    useState<PartnerIntegration | null>(null);

  // ✅ Logo dos servidores: HERDADA de `servers.logo_url` por padrão, mas
  // agora também pode ter upload próprio aqui (achado 26/08/2026, pedido do
  // Márcio: "quero poder mudar todas as fotos aqui, sem herdar nada de
  // lugar nenhum" — o herdado continua valendo como fallback quando não
  // houver upload próprio, mas nunca mais fica travado). serverLogoMap =
  // herdado (servers.logo_url); serverIconMap = próprio
  // (server_integrations.icon_url, novo).
  const [serverLogoMap, setServerLogoMap] = useState<Map<string, string>>(
    new Map(),
  );
  const [serverIconMap, setServerIconMap] = useState<Map<string, string>>(
    new Map(),
  );
  const [uploadingServerIconFor, setUploadingServerIconFor] = useState<
    string | null
  >(null);
  const serverIconFileInputs = useRef<Record<string, HTMLInputElement | null>>(
    {},
  );

  // ✅ Logo dos aplicativos: herdada do catálogo (`apps.icon_url`) só quando
  // TODOS os apps que batem com esse handler têm a MESMA logo (ex: um app
  // só, ou vários com ícone idêntico). Se não bater (ex: GERENCIAAPP cobre
  // 7 apps com logos diferentes), a integração usa a própria
  // `app_integrations.icon_url` (upload manual, ver handleAppIconUpload).
  const [appIconMap, setAppIconMap] = useState<Map<string, string>>(new Map());
  const [uploadingIconFor, setUploadingIconFor] = useState<string | null>(null);
  const appIconFileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // ✅ Ícone próprio do parceiro (novo, achado 26/08/2026) — sem nada pra
  // herdar aqui (Appativa não tem "outra aba" com logo), só upload manual.
  const [uploadingPartnerIconFor, setUploadingPartnerIconFor] = useState<
    string | null
  >(null);
  const partnerIconFileInputs = useRef<Record<string, HTMLInputElement | null>>(
    {},
  );

  const { confirm, ConfirmUI } = useConfirm();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function addToast(
    type: "success" | "error",
    title: string,
    message?: string,
  ) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 5000);
  }

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function fetchData() {
    try {
      setLoading(true);

      if (!tenantId) {
        setLoading(false);
        return;
      }

      const [srvRes, appRes, partnerRes, serversLogoRes, appsIconRes, serverIconRes] = await Promise.all([
        supabaseBrowser
          .from("vw_server_integrations")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabaseBrowser
          .from("app_integrations")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabaseBrowser
          .from("api_integrations")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabaseBrowser
          .from("servers")
          .select("id,logo_url,panel_integration")
          .eq("tenant_id", tenantId)
          .not("panel_integration", "is", null)
          .not("logo_url", "is", null),
        // ⚠️ Sem filtro de tenant_id de propósito — igual a busca de catálogo
        // em novo_cliente.tsx (achado 27/07/2026: apps pode ter linhas de
        // tenant "raiz" que não batem com getCurrentTenantId(), fazendo a
        // logo nunca casar — o app search do modal do cliente já não filtra
        // por isso, então aqui segue o mesmo padrão comprovado).
        supabaseBrowser
          .from("apps")
          .select("icon_url,integration_type")
          .not("integration_type", "is", null),
        // ✅ vw_server_integrations não expõe icon_url (view com lista de
        // colunas explícita, sem "*" real) — busca direto na tabela base.
        supabaseBrowser
          .from("server_integrations")
          .select("id,icon_url")
          .eq("tenant_id", tenantId)
          .not("icon_url", "is", null),
      ]);

      if (srvRes.error) throw srvRes.error;
      if (appRes.error) throw appRes.error;
      setIntegrations((srvRes.data as IntegrationRow[]) || []);
      setAppList((appRes.data as AppIntegration[]) || []);
      // ✅ Não derruba a página se a tabela api_integrations ainda não
      // existir (SQL rodado depois, docs/sql/api_integrations_partners.sql)
      // — só a aba "Parceiros" fica vazia até lá.
      if (!partnerRes.error) {
        setPartnerList((partnerRes.data as PartnerIntegration[]) || []);
      }

      // Servidor → logo (1ª ocorrência não-nula por integration_id)
      const srvLogoMap = new Map<string, string>();
      (serversLogoRes.data || []).forEach((s: any) => {
        if (
          s.panel_integration &&
          s.logo_url &&
          !srvLogoMap.has(s.panel_integration)
        ) {
          srvLogoMap.set(s.panel_integration, s.logo_url);
        }
      });
      setServerLogoMap(srvLogoMap);

      // ✅ Ícone próprio (upload manual, novo) — sobrepõe o herdado quando
      // presente.
      const srvIconMap = new Map<string, string>();
      (serverIconRes.data || []).forEach((s: ServerIntegrationIcon) => {
        if (s.icon_url) srvIconMap.set(s.id, s.icon_url);
      });
      setServerIconMap(srvIconMap);

      // Handler → logo do catálogo, só quando TODOS os apps que batem com
      // esse handler têm logo cadastrada E é a mesma pra todos (1 app só, ou
      // vários com ícone idêntico). Se faltar logo em qualquer um deles ou
      // as logos divergirem (caso do GERENCIAAPP, com 7 apps diferentes),
      // fica ambíguo e cai pro upload manual da própria integração.
      const iconsByHandler = new Map<string, Set<string>>();
      const missingIconByHandler = new Set<string>();
      (appsIconRes.data || []).forEach((a: any) => {
        const key = String(a.integration_type || "")
          .trim()
          .toUpperCase();
        if (!key) return;
        if (!iconsByHandler.has(key)) iconsByHandler.set(key, new Set());
        if (a.icon_url) iconsByHandler.get(key)!.add(a.icon_url);
        else missingIconByHandler.add(key);
      });
      const resolvedAppIconMap = new Map<string, string>();
      iconsByHandler.forEach((icons, key) => {
        if (icons.size === 1 && !missingIconByHandler.has(key)) {
          resolvedAppIconMap.set(key, [...icons][0]);
        }
      });
      setAppIconMap(resolvedAppIconMap);
    } catch (e: any) {
      addToast(
        "error",
        "Erro ao carregar",
        e?.message ?? "Falha ao carregar dados.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatNumber = (n: number | null | undefined) =>
    new Intl.NumberFormat("pt-BR").format(Number(n ?? 0));

  function providerLabel(p: string) {
    const u = String(p || "").toUpperCase();
    if (u === "NATV") return "NaTV";
    if (u === "FAST") return "Fast";
    if (u === "ELITE") return "Elite";
    return u || "--";
  }

  const [editingIntegration, setEditingIntegration] = useState<{
    id: string;
    provider: string;
    integration_name: string | null;
    is_active: boolean | null;
  } | null>(null);

  async function handleSync(row: IntegrationRow) {
    try {
      const provider = String(row.provider || "").toUpperCase();

      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess?.session?.access_token;
      const authHeaders = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      // ── ELITE: fluxo via extensão ──────────────────────────────────────────
      if (provider === "ELITE") {
        addToast(
          "success",
          "Sincronizando",
          "Validando Elite e buscando saldo...",
        );

        // 1. Busca as credenciais na rota
        const credRes = await fetch("/api/integrations/elite/sync", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            integration_id: row.id,
            action: "get_credentials",
          }),
        });
        const credJson = await credRes.json().catch(() => ({}));
        if (!credRes.ok || !credJson?.ok)
          throw new Error(credJson?.error || "Falha ao buscar credenciais.");

        const { baseUrl, username, password } = credJson.credentials;

        // 2. Dispara a extensão e aguarda a resposta
        const extResult = await new Promise<{
          ok: boolean;
          saldo?: string;
          loggedUser?: string;
          error?: string;
        }>((resolve) => {
          const handler = (event: Event) => {
            window.removeEventListener(
              "UNIGESTOR_INTEGRATION_RESPONSE",
              handler,
            );
            resolve((event as CustomEvent).detail);
          };
          window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE", handler);
          window.dispatchEvent(
            new CustomEvent("UNIGESTOR_INTEGRATION_CALL", {
              detail: { action: "ELITE_SYNC", baseUrl, username, password },
            }),
          );
        });

        if (!extResult?.ok)
          throw new Error(
            extResult?.error || "A extensão não retornou o saldo.",
          );

        // 3. Salva o saldo no banco
        const saveRes = await fetch("/api/integrations/elite/sync", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            integration_id: row.id,
            action: "save_sync",
            saldo: extResult.saldo,
            loggedUser: extResult.loggedUser,
          }),
        });
        const saveJson = await saveRes.json().catch(() => ({}));
        if (!saveRes.ok || !saveJson?.ok)
          throw new Error(saveJson?.error || "Falha ao salvar saldo.");

        addToast(
          "success",
          "OK",
          saveJson?.message || "Saldo Elite sincronizado.",
        );
        fetchData();
        return;
      }

      // ── NATV / FAST: fluxo direto ──────────────────────────────────────────
      const url =
        provider === "FAST"
          ? "/api/integrations/fast/sync"
          : "/api/integrations/natv/sync";

      addToast(
        "success",
        "Sincronizando",
        `Validando ${providerLabel(provider)} e buscando saldo...`,
      );

      const res = await fetch(url, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ integration_id: row.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok)
        throw new Error(json?.error || "Falha ao sincronizar.");

      addToast("success", "OK", json?.message || "Sincronizado.");
      fetchData();
    } catch (e: any) {
      addToast("error", "Erro", e?.message ?? "Falha ao sincronizar.");
    }
  }

  async function handleDelete(row: IntegrationRow) {
    const ok = await confirm({
      title: "Remover integração?",
      subtitle: `Deseja remover a integração "${row.integration_name}" (${providerLabel(row.provider)})?`,
      tone: "rose",
      confirmText: "Remover",
      cancelText: "Voltar",
      details: [
        "A integração será removida do UniGestor.",
        "Isso não remove clientes no painel do servidor.",
      ],
    });
    if (!ok) return;

    try {
      const { error } = await supabaseBrowser
        .from("server_integrations")
        .delete()
        .eq("id", row.id);

      if (error) throw error;

      addToast("success", "Removido", "Integração removida com sucesso.");
      fetchData();
    } catch (e: any) {
      addToast(
        "error",
        "Erro ao remover",
        e?.message ?? "Falha ao remover integração.",
      );
    }
  }

  function appLabel(a: string) {
    const u = String(a || "").toUpperCase();
    if (u === "GERENCIAAPP") return "GerenciaApp";
    return a || "--";
  }

  // ✅ Ícone próprio do servidor (achado 26/08/2026) — mesmo mecanismo de
  // handleAppIconUpload, mas grava em server_integrations.icon_url. Some
  // como fallback quando não houver upload (serverLogoMap, herdado de
  // servers.logo_url) continua funcionando igual, só que agora dá pra
  // sobrepor.
  async function handleServerIconUpload(row: IntegrationRow, file: File) {
    if (!file.type.startsWith("image/")) {
      addToast("error", "Arquivo inválido", "Selecione uma imagem.");
      return;
    }
    try {
      setUploadingServerIconFor(row.id);
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          folder: "server_integrations",
        }),
      });
      const { presignedUrl, publicUrl } = await presignRes.json();
      await fetch(presignedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      const { error } = await supabaseBrowser
        .from("server_integrations")
        .update({ icon_url: publicUrl })
        .eq("id", row.id);
      if (error) throw error;
      addToast("success", "Logo salva", "Ícone atualizado com sucesso.");
      fetchData();
    } catch (e: any) {
      addToast(
        "error",
        "Erro no upload",
        e?.message ?? "Falha ao enviar a imagem.",
      );
    } finally {
      setUploadingServerIconFor(null);
    }
  }

  // ✅ Ícone próprio do parceiro (achado 26/08/2026) — mesmo mecanismo,
  // grava em api_integrations.icon_url.
  async function handlePartnerIconUpload(row: PartnerIntegration, file: File) {
    if (!file.type.startsWith("image/")) {
      addToast("error", "Arquivo inválido", "Selecione uma imagem.");
      return;
    }
    try {
      setUploadingPartnerIconFor(row.id);
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          folder: "api_integrations",
        }),
      });
      const { presignedUrl, publicUrl } = await presignRes.json();
      await fetch(presignedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      const { error } = await supabaseBrowser
        .from("api_integrations")
        .update({ icon_url: publicUrl })
        .eq("id", row.id);
      if (error) throw error;
      addToast("success", "Logo salva", "Ícone atualizado com sucesso.");
      fetchData();
    } catch (e: any) {
      addToast(
        "error",
        "Erro no upload",
        e?.message ?? "Falha ao enviar a imagem.",
      );
    } finally {
      setUploadingPartnerIconFor(null);
    }
  }

  // ✅ Logo manual da integração — só usada quando o catálogo não resolve
  // uma logo única pra esse handler (ver appIconMap em fetchData).
  async function handleAppIconUpload(row: AppIntegration, file: File) {
    if (!file.type.startsWith("image/")) {
      addToast("error", "Arquivo inválido", "Selecione uma imagem.");
      return;
    }
    try {
      setUploadingIconFor(row.id);
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          folder: "app_integrations",
        }),
      });
      const { presignedUrl, publicUrl } = await presignRes.json();
      await fetch(presignedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      const { error } = await supabaseBrowser
        .from("app_integrations")
        .update({ icon_url: publicUrl })
        .eq("id", row.id);
      if (error) throw error;
      addToast("success", "Logo salva", "Ícone atualizado com sucesso.");
      fetchData();
    } catch (e: any) {
      addToast(
        "error",
        "Erro no upload",
        e?.message ?? "Falha ao enviar a imagem.",
      );
    } finally {
      setUploadingIconFor(null);
    }
  }

  async function handleAppDelete(row: AppIntegration) {
    const ok = await confirm({
      title: "Remover integração?",
      subtitle: `Deseja remover "${row.label}" (${appLabel(row.app_name)})?`,
      tone: "rose",
      confirmText: "Remover",
      cancelText: "Voltar",
      details: ["A integração será removida do UniGestor."],
    });
    if (!ok) return;
    try {
      const { error } = await supabaseBrowser
        .from("app_integrations")
        .delete()
        .eq("id", row.id);
      if (error) throw error;
      addToast("success", "Removido", "Integração de aplicativo removida.");
      fetchData();
    } catch (e: any) {
      addToast("error", "Erro ao remover", e?.message ?? "Falha.");
    }
  }

  async function handleAppToggle(row: AppIntegration) {
    try {
      const { error } = await supabaseBrowser
        .from("app_integrations")
        .update({ is_active: !row.is_active })
        .eq("id", row.id);
      if (error) throw error;
      addToast("success", row.is_active ? "Desativada" : "Ativada");
      fetchData();
    } catch (e: any) {
      addToast("error", "Erro", e?.message ?? "Falha.");
    }
  }

  function partnerLabel(p: string) {
    const u = String(p || "").toUpperCase();
    if (u === "APPATIVA") return "Appativa";
    return p || "--";
  }

  async function handlePartnerDelete(row: PartnerIntegration) {
    const ok = await confirm({
      title: "Remover parceiro?",
      subtitle: `Deseja remover "${row.label}" (${partnerLabel(row.provider)})?`,
      tone: "rose",
      confirmText: "Remover",
      cancelText: "Voltar",
      details: ["A integração será removida do UniGestor."],
    });
    if (!ok) return;
    try {
      const { error } = await supabaseBrowser
        .from("api_integrations")
        .delete()
        .eq("id", row.id);
      if (error) throw error;
      addToast("success", "Removido", "Parceiro removido.");
      fetchData();
    } catch (e: any) {
      addToast("error", "Erro ao remover", e?.message ?? "Falha.");
    }
  }

  async function handlePartnerToggle(row: PartnerIntegration) {
    try {
      const { error } = await supabaseBrowser
        .from("api_integrations")
        .update({ is_active: !row.is_active })
        .eq("id", row.id);
      if (error) throw error;
      addToast("success", row.is_active ? "Desativado" : "Ativado");
      fetchData();
    } catch (e: any) {
      addToast("error", "Erro", e?.message ?? "Falha.");
    }
  }

  async function handleSyncCredits(row: PartnerIntegration) {
    setSyncingCreditsFor(row.id);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess?.session?.access_token;
      const res = await fetch("/api/integrations/appativa/sync-credits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ integration_id: row.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao sincronizar saldo.");
      }
      addToast("success", "Saldo atualizado", `${json.credits_available} crédito(s) disponíveis.`);
      fetchData();
    } catch (e: any) {
      addToast("error", "Erro", e?.message ?? "Falha ao sincronizar saldo.");
    } finally {
      setSyncingCreditsFor(null);
    }
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors">
      {/* Topo */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
              API de Integrações
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <div className="relative">
            <button
              onClick={() => setShowTypeChooser((v) => !v)}
              className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
              type="button"
            >
              <span>+</span> Nova Integração
            </button>

            {showTypeChooser && (
              <div className="absolute right-0 mt-2 w-48 rounded-xl border border-border bg-card shadow-2xl z-50 overflow-hidden">
                <button
                  onClick={() => {
                    setShowTypeChooser(false);
                    setEditingIntegration(null);
                    setIsModalOpen(true);
                  }}
                  className="w-full px-4 py-3 text-left text-sm font-medium text-foreground/90 hover:bg-muted/50 flex items-center gap-2 border-b border-border"
                >
                  🖥️ Servidor
                </button>
                <button
                  onClick={() => {
                    setShowTypeChooser(false);
                    setEditingApp(null);
                    setIsModalAppOpen(true);
                  }}
                  className="w-full px-4 py-3 text-left text-sm font-medium text-foreground/90 hover:bg-muted/50 flex items-center gap-2 border-b border-border"
                >
                  📱 Aplicativo
                </button>
                <button
                  onClick={() => {
                    setShowTypeChooser(false);
                    setEditingPartner(null);
                    setIsModalPartnerOpen(true);
                  }}
                  className="w-full px-4 py-3 text-left text-sm font-medium text-foreground/90 hover:bg-muted/50 flex items-center gap-2"
                >
                  🤝 Parceiro
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-xl border border-border">
          Carregando integrações...
        </div>
      )}

      <CollapsibleSection
        icon="🖥️"
        label="Servidores"
        count={integrations.length}
        collapsed={!!collapsedGroups.servidores}
        onToggle={() => toggleGroup("servidores")}
      >
        <>
          {!loading && integrations.length === 0 && (
            <div className="p-12 text-center text-muted-foreground bg-card rounded-xl border border-dashed border-border">
              Nenhuma integração de servidor cadastrada.
            </div>
          )}
          {!loading && integrations.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-5">
              {integrations.map((row) => (
                <div
                  key={row.id}
                  className="rounded-none sm:rounded-xl overflow-hidden shadow-sm border flex flex-col transition-all bg-card border-border hover:border-emerald-500/30"
                >
                  <div className="px-4 sm:px-5 py-3 flex justify-between items-center border-b border-border bg-transparent">
                    <div className="min-w-0 pr-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {(() => {
                          // ✅ Ícone próprio (upload manual aqui) sempre
                          // ganha do herdado (servers.logo_url) — achado
                          // 26/08/2026, pedido do Márcio: poder trocar sem
                          // depender do que a outra aba definiu.
                          const ownIcon = serverIconMap.get(row.id);
                          const inheritedIcon = serverLogoMap.get(row.id);
                          const displayIcon = ownIcon || inheritedIcon;
                          return (
                            <div
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                const file = e.dataTransfer.files?.[0];
                                if (file) handleServerIconUpload(row, file);
                              }}
                              onPaste={(e) => {
                                const file = Array.from(
                                  e.clipboardData.files,
                                ).find((f) => f.type.startsWith("image/"));
                                if (file) handleServerIconUpload(row, file);
                              }}
                              onClick={() =>
                                serverIconFileInputs.current[row.id]?.click()
                              }
                              tabIndex={0}
                              title="Clique, arraste ou cole (Ctrl+V) uma imagem"
                              className="relative w-7 h-7 rounded-lg border border-dashed border-border shrink-0 flex items-center justify-center cursor-pointer hover:border-emerald-500/50 transition-colors overflow-hidden"
                            >
                              {uploadingServerIconFor === row.id ? (
                                <span className="text-[9px] text-muted-foreground animate-pulse">
                                  ...
                                </span>
                              ) : displayIcon ? (
                                <img
                                  src={displayIcon}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-xs">🖥️</span>
                              )}
                              <input
                                ref={(el) => {
                                  serverIconFileInputs.current[row.id] = el;
                                }}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleServerIconUpload(row, f);
                                  e.target.value = "";
                                }}
                              />
                            </div>
                          );
                        })()}
                        <h2
                          className="text-base font-medium truncate text-foreground/90 tracking-tight"
                          title={row.integration_name}
                        >
                          {row.integration_name}
                        </h2>

                        <span className="inline-flex items-center text-[10px] font-medium bg-sky-500/10 text-sky-500 border border-sky-500/20 px-2.5 py-0.5 rounded-full uppercase">
                          {providerLabel(row.provider)}
                        </span>

                        {!row.is_active && (
                          <span className="inline-flex items-center text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2.5 py-0.5 rounded-full uppercase">
                            Inativa
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <IconActionBtn
                        title="Editar"
                        tone="amber"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingIntegration({
                            id: row.id,
                            provider: row.provider,
                            integration_name: row.integration_name,
                            is_active: row.is_active,
                          });
                          setIsModalOpen(true);
                        }}
                      >
                        <IconEdit />
                      </IconActionBtn>

                      <IconActionBtn
                        title="Testar/Sync"
                        tone="blue"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSync(row);
                        }}
                      >
                        <IconSync />
                      </IconActionBtn>

                      <IconActionBtn
                        title="Remover"
                        tone="red"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(row);
                        }}
                      >
                        <IconTrash />
                      </IconActionBtn>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          👤 Usuário
                        </span>
                        <span className="font-medium text-foreground/90">
                          {row.owner_username ?? "--"}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          🆔 Owner ID
                        </span>
                        <span className="font-medium text-foreground/90">
                          {row.owner_id ?? "--"}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 sm:border-l sm:pl-4 border-border">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          🧾 Créditos
                        </span>
                        <span
                          className={`font-medium px-2 py-0.5 rounded-lg text-xs ${
                            (row.credits_last_known ?? 0) > 10
                              ? "text-emerald-500 bg-emerald-500/10"
                              : "text-rose-500 bg-rose-500/10"
                          }`}
                        >
                          {row.credits_last_known == null
                            ? "--"
                            : formatNumber(row.credits_last_known)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          ⏱ Último sync
                        </span>
                        <span className="font-medium text-foreground/90">
                          {row.credits_last_sync_at
                            ? new Date(row.credits_last_sync_at).toLocaleString(
                                "pt-BR",
                              )
                            : "--"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {isModalOpen && (
            <NovaIntegracaoModal
              integration={editingIntegration}
              onClose={() => {
                setIsModalOpen(false);
                setEditingIntegration(null);
              }}
              onSuccess={() => {
                setIsModalOpen(false);
                setEditingIntegration(null);
                addToast("success", "Salvo", "Integração salva com sucesso.");
                fetchData();
              }}
              onError={(msg) => addToast("error", "Erro", msg)}
            />
          )}
        </>
      </CollapsibleSection>

      <CollapsibleSection
        icon="🤝"
        label="Parceiros"
        count={partnerList.length}
        collapsed={!!collapsedGroups.parceiros}
        onToggle={() => toggleGroup("parceiros")}
      >
        <>
          {!loading && partnerList.length === 0 && (
            <div className="p-12 text-center text-muted-foreground bg-card rounded-xl border border-dashed border-border">
              Nenhum parceiro cadastrado.
            </div>
          )}
          {!loading && partnerList.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-5">
              {partnerList.map((row) => (
                <div
                  key={row.id}
                  className="rounded-none sm:rounded-xl overflow-hidden shadow-sm border flex flex-col transition-all bg-card border-border hover:border-emerald-500/30"
                >
                  <div className="px-4 sm:px-5 py-3 flex justify-between items-center border-b border-border bg-transparent">
                    <div className="flex items-center gap-2 min-w-0 pr-3">
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const file = e.dataTransfer.files?.[0];
                          if (file) handlePartnerIconUpload(row, file);
                        }}
                        onPaste={(e) => {
                          const file = Array.from(e.clipboardData.files).find(
                            (f) => f.type.startsWith("image/"),
                          );
                          if (file) handlePartnerIconUpload(row, file);
                        }}
                        onClick={() =>
                          partnerIconFileInputs.current[row.id]?.click()
                        }
                        tabIndex={0}
                        title="Clique, arraste ou cole (Ctrl+V) uma imagem"
                        className="relative w-7 h-7 rounded-lg border border-dashed border-border shrink-0 flex items-center justify-center cursor-pointer hover:border-emerald-500/50 transition-colors overflow-hidden"
                      >
                        {uploadingPartnerIconFor === row.id ? (
                          <span className="text-[9px] text-muted-foreground animate-pulse">
                            ...
                          </span>
                        ) : row.icon_url ? (
                          <img
                            src={row.icon_url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-sm">🤝</span>
                        )}
                        <input
                          ref={(el) => {
                            partnerIconFileInputs.current[row.id] = el;
                          }}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handlePartnerIconUpload(row, f);
                            e.target.value = "";
                          }}
                        />
                      </div>
                      <h2 className="text-base font-medium truncate text-foreground/90 tracking-tight">
                        {row.label}
                      </h2>
                      <span className="inline-flex items-center text-[10px] font-medium bg-purple-500/10 text-purple-500 border border-purple-500/20 px-2.5 py-0.5 rounded-full uppercase">
                        {partnerLabel(row.provider)}
                      </span>
                      {!row.is_active && (
                        <span className="inline-flex items-center text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2.5 py-0.5 rounded-full uppercase">
                          Inativo
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {row.provider === "APPATIVA" && (
                        <>
                          <IconActionBtn
                            title="Nova recarga"
                            tone="green"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRecargaAppativaFor(row);
                            }}
                          >
                            <IconMoney />
                          </IconActionBtn>
                          <IconActionBtn
                            title="Sincronizar saldo"
                            tone="blue"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSyncCredits(row);
                            }}
                          >
                            {syncingCreditsFor === row.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <IconSync />
                            )}
                          </IconActionBtn>
                        </>
                      )}
                      <IconActionBtn
                        title="Editar"
                        tone="amber"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPartner(row);
                          setIsModalPartnerOpen(true);
                        }}
                      >
                        <IconEdit />
                      </IconActionBtn>
                      <IconActionBtn
                        title={row.is_active ? "Desativar" : "Ativar"}
                        tone={row.is_active ? "red" : "green"}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePartnerToggle(row);
                        }}
                      >
                        {row.is_active ? <IconPause /> : <IconPlay />}
                      </IconActionBtn>
                      <IconActionBtn
                        title="Remover"
                        tone="red"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePartnerDelete(row);
                        }}
                      >
                        <IconTrash />
                      </IconActionBtn>
                    </div>
                  </div>
                  <div className="p-4 sm:p-5 text-sm space-y-2">
                    {row.provider === "APPATIVA" && (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">
                            🧾 Créditos
                          </span>
                          <span
                            className={`font-medium px-2 py-0.5 rounded-lg text-xs ${
                              (row.credits_available ?? 0) >= 5
                                ? "text-emerald-500 bg-emerald-500/10"
                                : "text-rose-500 bg-rose-500/10"
                            }`}
                          >
                            {row.credits_available == null
                              ? "--"
                              : row.credits_available}
                          </span>
                        </div>
                        {row.credits_last_sync_at && (
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">
                              ⏱ Último sync
                            </span>
                            <span className="font-medium text-foreground/90">
                              {new Date(row.credits_last_sync_at).toLocaleString(
                                "pt-BR",
                              )}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">
                            💰 Valor do crédito
                          </span>
                          <span className="font-medium text-foreground/90">
                            {row.credit_unit_price != null
                              ? row.credit_unit_price.toLocaleString("pt-BR", {
                                  style: "currency",
                                  currency: "BRL",
                                })
                              : "-- (editar pra definir)"}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCatalogModalFor(row.id)}
                          className="w-full h-9 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1.5"
                        >
                          📱 Aplicativos disponíveis
                        </button>
                      </>
                    )}
                    {row.api_url && (
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-muted-foreground shrink-0">
                          🔗 URL
                        </span>
                        <a
                          href={row.api_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-sky-500 hover:underline truncate max-w-[200px]"
                          title={row.api_url}
                        >
                          {row.api_url.replace(/^https?:\/\//, "")}
                        </a>
                      </div>
                    )}
                    {row.login_email && (
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">📧 Login</span>
                        <span className="font-medium text-foreground/90">
                          {row.login_email}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">🔑 Chave</span>
                      <span className="font-mono text-xs text-foreground/70">
                        {row.api_key
                          ? `${row.api_key.slice(0, 6)}••••${row.api_key.slice(-4)}`
                          : "--"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      </CollapsibleSection>

      <CollapsibleSection
        icon="📱"
        label="Aplicativos"
        count={appList.length}
        collapsed={!!collapsedGroups.aplicativos}
        onToggle={() => toggleGroup("aplicativos")}
      >
        <>
          {!loading && appList.length === 0 && (
            <div className="p-12 text-center text-muted-foreground bg-card rounded-xl border border-dashed border-border">
              Nenhuma integração de aplicativo cadastrada.
            </div>
          )}
          {!loading && appList.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-5">
              {appList.map((row) => (
                <div
                  key={row.id}
                  className="rounded-none sm:rounded-xl overflow-hidden shadow-sm border flex flex-col transition-all bg-card border-border hover:border-emerald-500/30"
                >
                  <div className="px-4 sm:px-5 py-3 flex justify-between items-center border-b border-border bg-transparent">
                    <div className="flex items-center gap-2 min-w-0 pr-3">
                      {(() => {
                        // ✅ Ícone próprio (upload manual aqui) sempre ganha
                        // do herdado do catálogo — achado 26/08/2026,
                        // pedido do Márcio: poder trocar mesmo quando o
                        // catálogo já resolvia uma logo única antes.
                        const catalogIcon = appIconMap.get(
                          String(row.app_name || "")
                            .trim()
                            .toUpperCase(),
                        );
                        const displayIcon = row.icon_url || catalogIcon;
                        return (
                          <div
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const file = e.dataTransfer.files?.[0];
                              if (file) handleAppIconUpload(row, file);
                            }}
                            onPaste={(e) => {
                              const file = Array.from(
                                e.clipboardData.files,
                              ).find((f) => f.type.startsWith("image/"));
                              if (file) handleAppIconUpload(row, file);
                            }}
                            onClick={() =>
                              appIconFileInputs.current[row.id]?.click()
                            }
                            tabIndex={0}
                            title="Clique, arraste ou cole (Ctrl+V) uma imagem"
                            className="relative w-7 h-7 rounded-lg border border-dashed border-border shrink-0 flex items-center justify-center cursor-pointer hover:border-emerald-500/50 transition-colors overflow-hidden"
                          >
                            {uploadingIconFor === row.id ? (
                              <span className="text-[9px] text-muted-foreground animate-pulse">
                                ...
                              </span>
                            ) : displayIcon ? (
                              <img
                                src={displayIcon}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                +
                              </span>
                            )}
                            <input
                              ref={(el) => {
                                appIconFileInputs.current[row.id] = el;
                              }}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleAppIconUpload(row, f);
                                e.target.value = "";
                              }}
                            />
                          </div>
                        );
                      })()}
                      <h2 className="text-base font-medium truncate text-foreground/90 tracking-tight">
                        {row.label}
                      </h2>
                      <span className="inline-flex items-center text-[10px] font-medium bg-purple-500/10 text-purple-500 border border-purple-500/20 px-2.5 py-0.5 rounded-full uppercase">
                        {appLabel(row.app_name)}
                      </span>
                      {!row.is_active && (
                        <span className="inline-flex items-center text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2.5 py-0.5 rounded-full uppercase">
                          Inativa
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <IconActionBtn
                        title="Editar"
                        tone="amber"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingApp(row);
                          setIsModalAppOpen(true);
                        }}
                      >
                        <IconEdit />
                      </IconActionBtn>
                      <IconActionBtn
                        title={row.is_active ? "Desativar" : "Ativar"}
                        tone={row.is_active ? "red" : "green"}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAppToggle(row);
                        }}
                      >
                        {row.is_active ? <IconPause /> : <IconPlay />}
                      </IconActionBtn>
                      <IconActionBtn
                        title="Remover"
                        tone="red"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAppDelete(row);
                        }}
                      >
                        <IconTrash />
                      </IconActionBtn>
                    </div>
                  </div>
                  <div className="p-4 sm:p-5 text-sm space-y-2">
                    {row.api_url && (
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-muted-foreground shrink-0">
                          🔗 URL
                        </span>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <a
                            href={row.api_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-sky-500 hover:underline truncate max-w-[180px]"
                            title={row.api_url}
                          >
                            {row.api_url.replace(/^https?:\/\//, "")}
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              navigator.clipboard.writeText(row.api_url!)
                            }
                            className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-sky-500 transition-colors"
                            title="Copiar URL"
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <rect x="9" y="9" width="13" height="13" rx="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                    {row.login_email && (
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">📧 Login</span>
                        <span className="font-medium text-foreground/90">
                          {row.login_email}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      </CollapsibleSection>

      {isModalAppOpen && (
        <AppIntegracaoModal
          integration={editingApp}
          onCloseAction={() => {
            setIsModalAppOpen(false);
            setEditingApp(null);
          }}
          onSuccessAction={() => {
            setIsModalAppOpen(false);
            setEditingApp(null);
            addToast("success", "Salvo", "Integração salva.");
            fetchData();
          }}
          onErrorAction={(msg) => addToast("error", "Erro", msg)}
        />
      )}
      {isModalPartnerOpen && (
        <ApiIntegracaoModal
          integration={editingPartner}
          onCloseAction={() => {
            setIsModalPartnerOpen(false);
            setEditingPartner(null);
          }}
          onSuccessAction={() => {
            setIsModalPartnerOpen(false);
            setEditingPartner(null);
            addToast("success", "Salvo", "Parceiro salvo.");
            fetchData();
          }}
          onErrorAction={(msg) => addToast("error", "Erro", msg)}
        />
      )}
      {catalogModalFor && (
        <AppativaCatalogModal
          integrationId={catalogModalFor}
          creditUnitPrice={
            partnerList.find((p) => p.id === catalogModalFor)?.credit_unit_price ??
            null
          }
          onCloseAction={() => setCatalogModalFor(null)}
          onErrorAction={(msg) => addToast("error", "Erro", msg)}
        />
      )}
      {recargaAppativaFor && (
        <RecargaAppativaModal
          partnerId={recargaAppativaFor.id}
          partnerLabel={recargaAppativaFor.label}
          onClose={() => setRecargaAppativaFor(null)}
          onSuccess={() => {
            setRecargaAppativaFor(null);
            addToast(
              "success",
              "Recarga registrada",
              "Despesa lançada no Financeiro Pessoal e saldo sincronizado.",
            );
            fetchData();
          }}
          onError={(msg) => addToast("error", "Erro", msg)}
        />
      )}
      {ConfirmUI}

      <div className="h-24 md:h-20" />

      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}

// ✅ Cabeçalho colapsável — mesmo padrão de renderAppGroup em
// gerenciador/aplicativo/page.tsx (label + contador + seta que gira).
function CollapsibleSection({
  icon,
  label,
  count,
  collapsed,
  onToggle,
  children,
}: {
  icon: string;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div
        className="flex items-center justify-between cursor-pointer border-b border-border pb-2 group select-none transition-colors hover:border-emerald-500/50"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-foreground/90 uppercase tracking-wider">
            {icon} {label}
          </h2>
          <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm">
            {count}
          </span>
        </div>
        <button
          className="text-muted-foreground group-hover:text-emerald-500 transition-colors p-1"
          title={collapsed ? "Expandir" : "Minimizar"}
          type="button"
        >
          <svg
            className={`w-4 h-4 transition-transform duration-300 ${collapsed ? "" : "rotate-180"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      {!collapsed && (
        <div className="animate-in slide-in-from-top-2 duration-300">
          {children}
        </div>
      )}
    </div>
  );
}

function IconActionBtn({
  children,
  title,
  tone,
  onClick,
}: {
  children: ReactNode;
  title: string;
  tone: "blue" | "green" | "amber" | "purple" | "red";
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const colors = {
    blue: "text-sky-500 bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/20",
    green:
      "text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20",
    amber:
      "text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20",
    purple:
      "text-purple-500 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20",
    red: "text-rose-500 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20",
  };

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={title}
      className={`p-1.5 rounded-lg border transition-all ${colors[tone]}`}
      type="button"
    >
      {children}
    </button>
  );
}

function IconTrash() {
  return <Trash2 className="w-4 h-4" />;
}
function IconSync() {
  return <RefreshCcw className="w-4 h-4" />;
}
// ✅ Mesmo ícone de "Renovar"/recarga usado em cliente/page.tsx,
// cliente/[id]/page.tsx, gerenciador/servidor/page.tsx e revendedor/
// page.tsx (achado 26/08/2026, pedido do Márcio: consistência entre abas).
function IconMoney() {
  return <CreditCard className="w-4 h-4" />;
}
function IconEdit() {
  return <Pencil className="w-4 h-4" />;
}
function IconPause() {
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
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}
function IconPlay() {
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
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}
