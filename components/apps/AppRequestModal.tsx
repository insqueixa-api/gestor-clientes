"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { extractDateOnly, CHECK_VALIDITY_HANDLERS, resolveIntegrationTypeByName } from "@/lib/apps/panel";
import { getIntegrationHandler } from "@/lib/integrations";
import { dispatchClouddyAction } from "@/lib/apps/clouddy-extension";
import type { AppFieldConfig, IntegrationHandler } from "@/lib/apps/types";
import type { ConfirmDialogProps } from "@/components/ui/ConfirmDialog";

type ToastFn = (type: "success" | "error" | "warning", title: string, message?: string) => void;
type ConfirmFn = (options: Omit<ConfirmDialogProps, "open" | "onConfirm" | "onCancel" | "loading">) => Promise<boolean>;

type LoadedData = {
  clientId: string;
  clientName: string;
  serverUsername: string;
  serverName: string;
  clientM3uUrl: string;
  appName: string;
  fieldValues: Record<string, string>;
  fieldsConfig: AppFieldConfig[];
  integrationType: string;
  handler: IntegrationHandler | null;
  panelUrl: string;
};

// Mesmo molde do card de app em novo_cliente.tsx: campos dinâmicos (não fixos
// em MAC/Device Key — um app como o ClouDDy usa email+senha), com botão de
// copiar, e as mesmas ações (extensão do Chrome pro ClouDDy, API pros
// demais) — não um resumo genérico à parte.
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
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    async function resolvePanelUrl(integrationType: string) {
      if (!integrationType) return "";
      const { data: integ } = await supabaseBrowser
        .from("app_integrations")
        .select("api_url")
        .eq("app_name", integrationType)
        .maybeSingle();
      return integ?.api_url || (integrationType === "CLOUDDY" ? "https://console.clouddy.online" : "");
    }

    function resolveHandler(integrationType: string, appName: string) {
      let type = integrationType;
      let handler = type ? getIntegrationHandler(type) : null;
      if (!handler) {
        const fallback = resolveIntegrationTypeByName(appName);
        handler = fallback ? getIntegrationHandler(fallback) : null;
        if (handler) type = fallback;
      }
      return { handler: handler as IntegrationHandler | null, type };
    }

    async function load() {
      setLoading(true);

      if (!clientAppId) {
        // Linha client_apps já não existe mais — usa o snapshot salvo no
        // próprio pedido. Sem client_app_id não tem como buscar
        // apps.fields_config por FK, então busca pelo nome (mesmo padrão de
        // app_integrations.app_name em lib/apps/panel.ts).
        const { data: row } = await supabaseBrowser
          .from("client_app_requests")
          .select("fields_snapshot, app_name, client_id, clients(display_name, server_username, m3u_url, servers(name))")
          .eq("id", requestId)
          .maybeSingle();
        if (!row) {
          setLoading(false);
          return;
        }
        const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
        const server = client?.servers ? (Array.isArray(client.servers) ? client.servers[0] : client.servers) : null;

        const { data: appRow } = await supabaseBrowser
          .from("apps")
          .select("fields_config, integration_type")
          .eq("name", row.app_name || "")
          .maybeSingle();

        const appName = row.app_name || "Aplicativo";
        const { handler, type } = resolveHandler(String(appRow?.integration_type || "").trim().toUpperCase(), appName);

        setData({
          clientId: row.client_id,
          clientName: client?.display_name || "Cliente",
          serverUsername: client?.server_username || "",
          serverName: server?.name || "",
          clientM3uUrl: client?.m3u_url || "",
          appName,
          fieldValues: row.fields_snapshot || {},
          fieldsConfig: Array.isArray(appRow?.fields_config) ? appRow.fields_config : [],
          integrationType: type,
          handler,
          panelUrl: await resolvePanelUrl(type),
        });
        setLoading(false);
        return;
      }

      const { data: row } = await supabaseBrowser
        .from("client_apps")
        .select("client_id, field_values, clients(display_name, server_username, m3u_url, servers(name)), apps(name, fields_config, integration_type)")
        .eq("id", clientAppId)
        .maybeSingle();

      if (!row) {
        setLoading(false);
        return;
      }

      const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
      const server = client?.servers ? (Array.isArray(client.servers) ? client.servers[0] : client.servers) : null;
      const app = Array.isArray(row.apps) ? row.apps[0] : row.apps;
      const appName = app?.name || "Aplicativo";
      const { handler, type } = resolveHandler(String(app?.integration_type || "").trim().toUpperCase(), appName);

      setData({
        clientId: row.client_id,
        clientName: client?.display_name || "Cliente",
        serverUsername: client?.server_username || "",
        serverName: server?.name || "",
        clientM3uUrl: client?.m3u_url || "",
        appName,
        fieldValues: row.field_values || {},
        fieldsConfig: Array.isArray(app?.fields_config) ? app.fields_config : [],
        integrationType: type,
        handler,
        panelUrl: await resolvePanelUrl(type),
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

  function fieldKeyOf(f: AppFieldConfig) {
    return String(f.id || f.label || "").trim();
  }

  function getClouddyCreds() {
    if (!data) return { email: "", password: "" };
    const emailField = data.fieldsConfig.find((f) => String(f.type || "").toLowerCase() === "email");
    const passField = data.fieldsConfig.find((f) => String(f.type || "").toLowerCase() === "password");
    return {
      email: emailField ? data.fieldValues[fieldKeyOf(emailField)] || "" : "",
      password: passField ? data.fieldValues[fieldKeyOf(passField)] || "" : "",
    };
  }

  function copyField(key: string, value: string) {
    navigator.clipboard?.writeText(value);
    setCopiedField(key);
    setTimeout(() => setCopiedField((k) => (k === key ? null : k)), 2000);
  }

  async function persistFieldValue(fieldKey: string, value: string) {
    setData((prev) => (prev ? { ...prev, fieldValues: { ...prev.fieldValues, [fieldKey]: value } } : prev));
    if (!clientAppId) return; // rascunho (snapshot) — nada pra persistir
    const { data: current } = await supabaseBrowser.from("client_apps").select("field_values").eq("id", clientAppId).maybeSingle();
    const dbVals = current?.field_values || {};
    await supabaseBrowser.from("client_apps").update({ field_values: { ...dbVals, [fieldKey]: value } }).eq("id", clientAppId);
  }

  // ===== Ações — apps com API própria (a maioria) =====
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

  function openPanel() {
    if (!data?.panelUrl) {
      addToast("warning", "Sem URL", "Nenhum link configurado para esta integração.");
      return;
    }
    window.open(data.panelUrl, "_blank");
  }

  // ===== Ações — ClouDDy (via extensão do Chrome, igual novo_cliente.tsx) =====
  async function handleClouddyConfigure() {
    if (!data) return;
    const { email, password } = getClouddyCreds();
    if (!email || !password) {
      addToast("error", "Email/senha obrigatórios", "Preencha o email e a senha do ClouDDy antes de configurar.");
      return;
    }
    if (!data.clientM3uUrl) {
      addToast("error", "Sem link M3U", "Esse cliente ainda não tem um link M3U salvo.");
      return;
    }
    setBusy(true);
    try {
      const result = await dispatchClouddyAction("CLOUDDY_CONFIGURE", { email, password, m3uUrl: data.clientM3uUrl });
      if (result.ok) {
        if (result.expireDate) {
          const dateField = data.fieldsConfig.find((f) => String(f.type || "").toLowerCase() === "date");
          if (dateField) await persistFieldValue(fieldKeyOf(dateField), result.expireDate);
        }
        addToast("success", "ClouDDy configurado", result.expireDate ? `TV + VOD atualizados. Vencimento: ${String(result.expireDate).split("-").reverse().join("/")}` : "TV + VOD atualizados.");
      } else {
        addToast("error", "Falha ao configurar", result.error || "Não foi possível configurar o ClouDDy.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleClouddyCheck() {
    if (!data) return;
    const { email, password } = getClouddyCreds();
    if (!email || !password) {
      addToast("error", "Email/senha obrigatórios", "Preencha o email e a senha do ClouDDy antes de verificar.");
      return;
    }
    setBusy(true);
    try {
      const result = await dispatchClouddyAction("CLOUDDY_CHECK", { email, password });
      if (result.ok && result.expireDate) {
        const dateField = data.fieldsConfig.find((f) => String(f.type || "").toLowerCase() === "date");
        if (dateField) await persistFieldValue(fieldKeyOf(dateField), result.expireDate);
        addToast("success", "Vencimento verificado", `ClouDDy: ${String(result.expireDate).split("-").reverse().join("/")}`);
      } else if (result.ok) {
        addToast("warning", "Sem vencimento", "Não foi possível localizar o vencimento.");
      } else {
        addToast("error", "Não foi possível verificar", result.error || "Falha desconhecida.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleClouddyDelete() {
    const { email, password } = getClouddyCreds();
    if (!email || !password) {
      addToast("error", "Email/senha obrigatórios", "Preencha o email e a senha do ClouDDy antes de remover.");
      return;
    }
    setBusy(true);
    try {
      const result = await dispatchClouddyAction("CLOUDDY_DELETE", { email, password });
      if (result.ok) addToast("success", "ClouDDy removido", "TV + VOD removidos.");
      else addToast("error", "Falha ao remover", result.error || "Não foi possível remover no ClouDDy.");
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
        // linha client_apps de verdade. Pra ClouDDy (sem rota de API), essa
        // chamada só volta "sem integração automática" — o admin já deve ter
        // removido via extensão pelos botões acima antes de concluir.
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

  const isClouddy = data?.integrationType === "CLOUDDY";
  const hasApiIntegration = !!data?.handler?.useApi;
  const canCheck = hasApiIntegration && data ? CHECK_VALIDITY_HANDLERS.has(data.handler!.actionPrefix) : false;

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-3">{action === "removal" ? "Pedido de exclusão" : "Pedido de configuração"}</h3>
        {loading || !data ? (
          <div className="py-8 text-center text-muted-foreground">Carregando...</div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Nome do cliente:</span><span className="font-medium">{data.clientName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Servidor:</span><span className="font-medium">{data.serverUsername}{data.serverName ? ` (${data.serverName})` : ""}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Aplicativo:</span><span className="font-medium">{data.appName}</span></div>

            {/* Campos dinâmicos — o que o app realmente tem (MAC/Device Key
                pros apps comuns, email/senha pro ClouDDy, etc.), não um
                resumo fixo. */}
            <div className="space-y-2 pt-1">
              {data.fieldsConfig.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Este app não tem campos configurados.</p>
              )}
              {data.fieldsConfig.map((f) => {
                const key = fieldKeyOf(f);
                const type = String(f.type || "").toLowerCase();
                const raw = data.fieldValues[key] || "";
                const isPassword = type === "password";
                const display = type === "date" ? (extractDateOnly(raw) ? extractDateOnly(raw)!.split("-").reverse().join("/") : raw || "—") : raw || "—";
                const revealed = showPassword[key];
                return (
                  <div key={key} className="flex items-center justify-between gap-2 bg-muted/40 border border-border rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{f.label || type}</p>
                      <p className="font-medium truncate">
                        {isPassword && !revealed && raw ? "•".repeat(Math.min(raw.length, 10)) : display}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isPassword && raw && (
                        <button
                          type="button"
                          onClick={() => setShowPassword((p) => ({ ...p, [key]: !p[key] }))}
                          className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-1"
                          title={revealed ? "Ocultar" : "Mostrar"}
                        >
                          {revealed ? "🙈" : "👁️"}
                        </button>
                      )}
                      {raw && (
                        <button
                          type="button"
                          onClick={() => copyField(key, raw)}
                          className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-1"
                          title="Copiar"
                        >
                          {copiedField === key ? "✅" : "📋"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {clientAppId && isClouddy && (
              <div className="pt-2 border-t border-border">
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleClouddyConfigure}
                    className="h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-bold transition-colors"
                    title="Configura TV + VOD com o M3U do cliente e pega o vencimento"
                  >
                    Configurar
                  </button>
                  <div className="h-10 rounded-lg border border-border overflow-hidden flex divide-x divide-border">
                    <button type="button" onClick={openPanel} className="flex-1 bg-transparent text-muted-foreground hover:bg-muted transition-colors text-xs" title="Abrir painel no navegador">
                      🔗
                    </button>
                    <button type="button" disabled={busy} onClick={handleClouddyCheck} className="flex-1 bg-transparent text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-60 transition-colors text-xs" title="Verificar vencimento (sem mexer em TV/VOD)">
                      ✓
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleClouddyDelete}
                    className="h-10 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-xs font-bold transition-colors"
                    title="Remove TV + VOD"
                  >
                    Remover
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Cada clique abre uma aba de verdade no seu Chrome, loga com o email/senha desse cliente, faz a ação e fecha a sessão. Se aparecer o captcha do Cloudflare, resolve manualmente na aba — o resto continua sozinho.
                </p>
              </div>
            )}

            {clientAppId && !isClouddy && hasApiIntegration && (
              <div className="pt-2 border-t border-border">
                <div className={`grid gap-2 ${data.panelUrl || canCheck ? "grid-cols-2" : "grid-cols-1"}`}>
                  <button disabled={busy} onClick={handleConfigure} className="h-10 px-3 bg-emerald-500/10 text-emerald-500 rounded-lg border border-emerald-500/20 disabled:opacity-50 text-xs font-bold">
                    Configurar
                  </button>
                  {canCheck ? (
                    <div className="h-10 rounded-lg border border-border overflow-hidden flex divide-x divide-border">
                      <button type="button" onClick={openPanel} className="flex-1 bg-transparent text-muted-foreground hover:bg-muted transition-colors text-xs" title="Abrir painel no navegador">
                        🔗
                      </button>
                      <button disabled={busy} onClick={handleCheck} className="flex-1 bg-transparent text-sky-500 hover:bg-sky-500/10 disabled:opacity-50 transition-colors text-xs" title="Verificar validade">
                        Verificar
                      </button>
                    </div>
                  ) : (
                    data.panelUrl && (
                      <button type="button" onClick={openPanel} className="h-10 px-3 bg-transparent border border-border text-muted-foreground hover:bg-muted rounded-lg text-xs font-bold">
                        Abrir painel
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            {clientAppId && !isClouddy && !hasApiIntegration && (
              <p className="text-xs text-muted-foreground italic pt-1">Sem integração automática disponível para este aplicativo — resolva manualmente antes de concluir.</p>
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
