"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { extractFieldByType } from "@/lib/apps/panel";
import type { AppFieldConfig } from "@/lib/apps/types";
import type { ConfirmDialogProps } from "@/components/ui/ConfirmDialog";

type ToastFn = (type: "success" | "error" | "warning", title: string, message?: string) => void;
type ConfirmFn = (options: Omit<ConfirmDialogProps, "open" | "onConfirm" | "onCancel" | "loading">) => Promise<boolean>;

type LoadedData = {
  clientName: string;
  serverUsername: string;
  serverName: string;
  appName: string;
  fields: Record<string, string>;
  fieldsConfig: AppFieldConfig[];
  hasIntegration: boolean;
};

export default function AppRequestModal({
  requestId,
  clientAppId,
  tenantId,
  action,
  onClose,
  onResolved,
  addToast,
  confirm,
}: {
  requestId: string;
  clientAppId: string | null;
  tenantId: string;
  action: "setup" | "removal";
  onClose: () => void;
  onResolved: () => void;
  addToast: ToastFn;
  confirm: ConfirmFn;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LoadedData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      if (!clientAppId) {
        // Linha client_apps já não existe mais — usa o snapshot salvo no
        // próprio pedido. Sem client_app_id não tem como buscar
        // apps.fields_config por FK, então busca pelo nome (mesmo padrão de
        // app_integrations.app_name em lib/apps/panel.ts).
        const { data: row } = await supabaseBrowser
          .from("client_app_requests")
          .select("fields_snapshot, app_name, clients(display_name, server_username, servers(name))")
          .eq("id", requestId)
          .maybeSingle();
        if (!row) {
          setLoading(false);
          return;
        }
        const vals = row.fields_snapshot || {};
        const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
        const server = client?.servers ? (Array.isArray(client.servers) ? client.servers[0] : client.servers) : null;

        const { data: appRow } = await supabaseBrowser
          .from("apps")
          .select("fields_config, integration_type")
          .eq("name", row.app_name || "")
          .maybeSingle();

        setData({
          clientName: client?.display_name || "Cliente",
          serverUsername: client?.server_username || "",
          serverName: server?.name || "",
          appName: row.app_name || "Aplicativo",
          fields: vals,
          fieldsConfig: Array.isArray(appRow?.fields_config) ? appRow.fields_config : [],
          hasIntegration: !!appRow?.integration_type,
        });
        setLoading(false);
        return;
      }

      const { data: row } = await supabaseBrowser
        .from("client_apps")
        .select("field_values, clients(display_name, server_username, servers(name)), apps(name, fields_config, integration_type)")
        .eq("id", clientAppId)
        .maybeSingle();

      if (!row) {
        setLoading(false);
        return;
      }

      const vals = row.field_values || {};
      const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
      const server = client?.servers ? (Array.isArray(client.servers) ? client.servers[0] : client.servers) : null;
      const app = Array.isArray(row.apps) ? row.apps[0] : row.apps;
      setData({
        clientName: client?.display_name || "Cliente",
        serverUsername: client?.server_username || "",
        serverName: server?.name || "",
        appName: app?.name || "Aplicativo",
        fields: vals,
        fieldsConfig: Array.isArray(app?.fields_config) ? app.fields_config : [],
        hasIntegration: !!app?.integration_type,
      });
      setLoading(false);
    }
    load();
  }, [clientAppId, requestId]);

  // Fetcher puro — não mexe em `busy`, quem chama controla o próprio estado
  // de carregamento (senão duas chamadas em sequência, ex: remover + marcar
  // pedido como concluído, se atropelam no finally uma da outra).
  async function apiCall(path: string, body: any) {
    const { data: sess } = await supabaseBrowser.auth.getSession();
    const token = sess.session?.access_token;
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) throw new Error(json?.error || "Erro na requisição");
    return json;
  }

  async function handleConfigure() {
    if (!clientAppId) return;
    setBusy(true);
    try {
      const result = await apiCall("/api/admin/apps/configure", { tenant_id: tenantId, client_app_id: clientAppId, mode: "principal" });
      addToast("success", "Configurado", result.message || "Tentativa de configuração enviada.");
    } catch (e: any) {
      addToast("error", "Erro ao configurar", e?.message || "Falha");
    } finally {
      setBusy(false);
    }
  }

  async function handleCheck() {
    if (!clientAppId) return;
    setBusy(true);
    try {
      const result = await apiCall("/api/admin/apps/check-validity", { tenant_id: tenantId, client_app_id: clientAppId });
      addToast("success", "Validade", result.expireDate ? `Vencimento: ${String(result.expireDate).split("T")[0].split("-").reverse().join("/")}` : "Sem vencimento");
    } catch (e: any) {
      addToast("error", "Erro ao verificar", e?.message || "Falha");
    } finally {
      setBusy(false);
    }
  }

  // Único botão de conclusão — o que ele faz depende do tipo de pedido:
  //   - "removal": exclusão de verdade é aqui, sempre (via /api/admin/apps/
  //     remove — tenta o parceiro e depois apaga client_apps). Nunca sem
  //     confirmação: é destrutivo.
  //   - "setup": nunca apaga nada, só marca o pedido como resolvido — apagar
  //     o app que acabou de ser configurado não faz sentido nenhum aqui.
  async function handleResolve() {
    const isRemoval = action === "removal";
    const ok = await confirm({
      title: isRemoval ? "Concluir exclusão" : "Concluir configuração",
      subtitle: isRemoval
        ? `Você já removeu (ou vai remover agora) "${data?.appName}" do painel do parceiro? Isso vai apagar o app da conta de ${data?.clientName} agora.`
        : `Você já configurou "${data?.appName}" pra ${data?.clientName}?`,
      tone: isRemoval ? "rose" : "emerald",
      icon: isRemoval ? "🗑️" : "✅",
      confirmText: "Sim, Concluir",
      cancelText: "Voltar",
    });
    if (!ok) return;

    setBusy(true);
    try {
      if (isRemoval && clientAppId) {
        // Mesma rota/função compartilhada com o portal e o resto do admin —
        // tenta desconfigurar no painel do parceiro (best-effort) e apaga a
        // linha client_apps de verdade.
        await apiCall("/api/admin/apps/remove", { tenant_id: tenantId, client_app_id: clientAppId });
      }

      const { data: userData } = await supabaseBrowser.auth.getUser();
      const { error } = await supabaseBrowser
        .from("client_app_requests")
        .update({ status: "done", completed_at: new Date().toISOString(), completed_by: userData?.user?.id || null })
        .eq("id", requestId);
      if (error) throw error;

      try {
        await supabaseBrowser.rpc("resolve_notification", {
          p_tenant_id: tenantId,
          p_type: isRemoval ? "app_removal_pending" : "app_setup_pending",
          p_source_id: requestId,
        });
      } catch {
        // não bloqueia a conclusão por causa da notificação
      }

      addToast("success", "Concluído", isRemoval ? `"${data?.appName}" foi excluído.` : `"${data?.appName}" marcado como configurado.`);
      onResolved();
    } catch (e: any) {
      addToast("error", "Erro ao concluir", e?.message);
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  const macValue = data ? extractFieldByType(data.fieldsConfig, data.fields, "mac") : "";
  const deviceKeyValue = data ? extractFieldByType(data.fieldsConfig, data.fields, "device_key") : "";

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl p-6">
        <h3 className="text-lg font-bold mb-3">{action === "removal" ? "Pedido de exclusão" : "Pedido de configuração"}</h3>
        {loading || !data ? (
          <div className="py-8 text-center text-muted-foreground">Carregando...</div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Nome do cliente:</span><span className="font-medium">{data.clientName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Servidor:</span><span className="font-medium">{data.serverUsername}{data.serverName ? ` (${data.serverName})` : ""}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Aplicativo:</span><span className="font-medium">{data.appName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Device ID:</span><span className="font-medium">{macValue || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Device Key:</span><span className="font-medium">{deviceKeyValue || "—"}</span></div>

            {clientAppId && (
              <div className="pt-2 border-t border-border">
                <div className="flex gap-2">
                  {data.hasIntegration && (
                    <button disabled={busy} onClick={handleConfigure} className="px-3 py-2 bg-emerald-500/10 text-emerald-500 rounded-lg border border-emerald-500/20 disabled:opacity-50">Configurar</button>
                  )}
                  <button disabled={busy} onClick={handleCheck} className="px-3 py-2 bg-sky-500/10 text-sky-500 rounded-lg border border-sky-500/20 disabled:opacity-50">Verificar validade</button>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-3">
              <button
                disabled={busy}
                onClick={handleResolve}
                className={`flex-1 px-4 py-2 rounded-lg text-white disabled:opacity-50 ${action === "removal" ? "bg-rose-600" : "bg-emerald-600"}`}
              >
                {action === "removal" ? "Concluir & Excluir" : "Concluir"}
              </button>
            </div>
            <button onClick={onClose} className="w-full text-xs text-muted-foreground hover:text-foreground">Fechar</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
