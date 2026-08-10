"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  CHECK_VALIDITY_HANDLERS,
  resolveIntegrationTypeByName,
  buildM3uUrlFromDns,
  buildM3uUrlSecondary,
} from "@/lib/apps/panel";
import { getIntegrationHandler } from "@/lib/integrations";
import { dispatchClouddyAction } from "@/lib/apps/clouddy-extension";
import type { AppFieldConfig, IntegrationHandler } from "@/lib/apps/types";
import type { ConfirmDialogProps } from "@/components/ui/ConfirmDialog";
import type { ReconfigureMode } from "@/components/apps/ReconfigureModeModal";
import AppIntegrationActions from "@/components/apps/AppIntegrationActions";
import AppInstanceFields from "@/components/apps/AppInstanceFields";

type ToastFn = (
  type: "success" | "error" | "warning",
  title: string,
  message?: string,
) => void;
type ConfirmFn = (
  options: Omit<
    ConfirmDialogProps,
    "open" | "onConfirm" | "onCancel" | "loading"
  >,
) => Promise<boolean>;

type LoadedData = {
  clientId: string;
  clientName: string;
  serverUsername: string;
  serverPassword: string;
  serverName: string;
  serverDns: string[];
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
  paymentLogId,
  clientAppId,
  tenantId,
  action,
  onClose,
  onResolved,
  addToast,
  confirm,
}: {
  // "setup"/"removal" vêm de um pedido em client_app_requests (requestId).
  // "renewal" vem de um pagamento avulso de licença de app pendente de
  // confirmação manual (paymentLogId) — client_app_id sempre presente
  // nesse caso (a Auditoria só oferece essa ação quando existe).
  requestId?: string;
  paymentLogId?: string;
  clientAppId: string | null;
  tenantId: string;
  action: "setup" | "removal" | "renewal";
  onClose: () => void;
  onResolved: () => void;
  addToast: ToastFn;
  confirm: ConfirmFn;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LoadedData | null>(null);
  const [busy, setBusy] = useState(false);

  // ✅ Mensagem genérica ao concluir renovação (pedido do Márcio, 04/08/2026)
  // — só faz sentido pra action="renewal". Toggle vem sempre ligado (o
  // admin desliga se não quiser mandar), template pré-selecionado pelo
  // nome ("Renovação de Aplicativo") assim que os modelos carregam.
  const [sendRenewalMsg, setSendRenewalMsg] = useState(true);
  const [templates, setTemplates] = useState<
    {
      id: string;
      name: string;
      content: string;
      image_url: string | null;
      category: string | null;
    }[]
  >([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [messageContent, setMessageContent] = useState("");

  useEffect(() => {
    if (action !== "renewal") return;
    (async () => {
      const { data: tmplData } = await supabaseBrowser
        .from("message_templates")
        .select("id, name, content, image_url, category")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true });
      if (!tmplData) return;
      setTemplates(tmplData as any);
      const defaultTpl = tmplData.find((t: any) =>
        t.name.toLowerCase().includes("renovação de aplicativo"),
      );
      if (defaultTpl) {
        setSelectedTemplateId(defaultTpl.id);
        setMessageContent(defaultTpl.content);
      }
    })();
  }, [action, tenantId]);

  useEffect(() => {
    async function resolvePanelUrl(integrationType: string) {
      if (!integrationType) return "";
      const { data: integ } = await supabaseBrowser
        .from("app_integrations")
        .select("api_url")
        .eq("app_name", integrationType)
        .maybeSingle();
      return (
        integ?.api_url ||
        (integrationType === "CLOUDDY" ? "https://console.clouddy.online" : "")
      );
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
          .select(
            "fields_snapshot, app_name, client_id, clients(display_name, server_username, server_password, m3u_url, servers(name, dns))",
          )
          .eq("id", requestId)
          .maybeSingle();
        if (!row) {
          setLoading(false);
          return;
        }
        const client = Array.isArray(row.clients)
          ? row.clients[0]
          : row.clients;
        const server = client?.servers
          ? Array.isArray(client.servers)
            ? client.servers[0]
            : client.servers
          : null;

        const { data: appRow } = await supabaseBrowser
          .from("apps")
          .select("fields_config, integration_type")
          .eq("name", row.app_name || "")
          .maybeSingle();

        const appName = row.app_name || "Aplicativo";
        const { handler, type } = resolveHandler(
          String(appRow?.integration_type || "")
            .trim()
            .toUpperCase(),
          appName,
        );

        setData({
          clientId: row.client_id,
          clientName: client?.display_name || "Cliente",
          serverUsername: client?.server_username || "",
          serverPassword: client?.server_password || "",
          serverName: server?.name || "",
          serverDns: Array.isArray(server?.dns) ? server.dns : [],
          clientM3uUrl: client?.m3u_url || "",
          appName,
          fieldValues: row.fields_snapshot || {},
          fieldsConfig: Array.isArray(appRow?.fields_config)
            ? appRow.fields_config
            : [],
          integrationType: type,
          handler,
          panelUrl: await resolvePanelUrl(type),
        });
        setLoading(false);
        return;
      }

      const { data: row } = await supabaseBrowser
        .from("client_apps")
        .select(
          "client_id, field_values, clients(display_name, server_username, server_password, m3u_url, servers(name, dns)), apps(name, fields_config, integration_type)",
        )
        .eq("id", clientAppId)
        .maybeSingle();

      if (!row) {
        setLoading(false);
        return;
      }

      const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
      const server = client?.servers
        ? Array.isArray(client.servers)
          ? client.servers[0]
          : client.servers
        : null;
      const app = Array.isArray(row.apps) ? row.apps[0] : row.apps;
      const appName = app?.name || "Aplicativo";
      const { handler, type } = resolveHandler(
        String(app?.integration_type || "")
          .trim()
          .toUpperCase(),
        appName,
      );

      setData({
        clientId: row.client_id,
        clientName: client?.display_name || "Cliente",
        serverUsername: client?.server_username || "",
        serverPassword: client?.server_password || "",
        serverName: server?.name || "",
        serverDns: Array.isArray(server?.dns) ? server.dns : [],
        clientM3uUrl: client?.m3u_url || "",
        appName,
        fieldValues: row.field_values || {},
        fieldsConfig: Array.isArray(app?.fields_config)
          ? app.fields_config
          : [],
        integrationType: type,
        handler,
        panelUrl: await resolvePanelUrl(type),
      });
      setLoading(false);
    }
    load();
  }, [clientAppId, requestId, paymentLogId]);

  // Fetcher puro — não mexe em `busy`, quem chama controla o próprio estado
  // de carregamento (senão duas chamadas em sequência, ex: remover + marcar
  // pedido como concluído, se atropelam no finally uma da outra).
  async function apiCall(path: string, body: any) {
    const { data: sess } = await supabaseBrowser.auth.getSession();
    const token = sess.session?.access_token;
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
    const emailField = data.fieldsConfig.find(
      (f) => String(f.type || "").toLowerCase() === "email",
    );
    const passField = data.fieldsConfig.find(
      (f) => String(f.type || "").toLowerCase() === "password",
    );
    return {
      email: emailField ? data.fieldValues[fieldKeyOf(emailField)] || "" : "",
      password: passField ? data.fieldValues[fieldKeyOf(passField)] || "" : "",
    };
  }

  function copyField(label: string, value: string) {
    navigator.clipboard?.writeText(value);
    addToast("success", "Copiado!", `${label} copiado com sucesso.`);
  }

  async function persistFieldValue(fieldKey: string, value: string) {
    setData((prev) =>
      prev
        ? { ...prev, fieldValues: { ...prev.fieldValues, [fieldKey]: value } }
        : prev,
    );
    if (!clientAppId) return; // rascunho (snapshot) — nada pra persistir
    const { data: current } = await supabaseBrowser
      .from("client_apps")
      .select("field_values")
      .eq("id", clientAppId)
      .maybeSingle();
    const dbVals = current?.field_values || {};
    await supabaseBrowser
      .from("client_apps")
      .update({ field_values: { ...dbVals, [fieldKey]: value } })
      .eq("id", clientAppId);
  }

  // ===== Ações — apps com API própria (a maioria) =====
  async function handleConfigure(mode: ReconfigureMode) {
    if (!clientAppId) return;
    setBusy(true);
    try {
      const result = await apiCall("/api/admin/apps/configure", {
        tenant_id: tenantId,
        client_app_id: clientAppId,
        mode,
      });
      addToast(
        "success",
        "Configurado",
        result.message || "Tentativa de configuração enviada.",
      );
    } catch (e: any) {
      addToast("error", "Erro ao configurar", e?.message || "Falha");
    } finally {
      setBusy(false);
    }
  }

  // "Remover m3u" — mesmo botão do card em novo_cliente.tsx: só desconfigura
  // no painel do parceiro (keep_row: true), NÃO apaga a linha client_apps.
  // Dá pro admin controle manual total (configurar OU remover, sem depender
  // de "Configurar" sempre deletar-e-criar) — diferente do portal, que só
  // oferece "Reconfigurar".
  async function handleRemove() {
    if (!clientAppId || !data) return;
    const ok = await confirm({
      title: `Remover do ${data.appName}?`,
      subtitle:
        "Isso apagará o MAC/m3u do painel oficial. O app continua no cadastro do cliente pra reconfigurar depois.",
      tone: "rose",
      confirmText: "Sim, remover",
      cancelText: "Cancelar",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await apiCall("/api/admin/apps/remove", {
        tenant_id: tenantId,
        client_app_id: clientAppId,
        keep_row: true,
      });
      addToast("success", "Removido!", "Configuração apagada do painel.");
    } catch (e: any) {
      addToast("error", "Não removido", e?.message || "Falha ao remover.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCheck() {
    if (!clientAppId) return;
    setBusy(true);
    try {
      const result = await apiCall("/api/admin/apps/check-validity", {
        tenant_id: tenantId,
        client_app_id: clientAppId,
      });
      addToast(
        "success",
        "Validade",
        result.expireDate
          ? `Vencimento: ${String(result.expireDate).split("T")[0].split("-").reverse().join("/")}`
          : "Sem vencimento",
      );
    } catch (e: any) {
      addToast("error", "Erro ao verificar", e?.message || "Falha");
    } finally {
      setBusy(false);
    }
  }

  function openPanel() {
    if (!data?.panelUrl) {
      addToast(
        "warning",
        "Sem URL",
        "Nenhum link configurado para esta integração.",
      );
      return;
    }
    window.open(data.panelUrl, "_blank");
  }

  // ===== Ações — ClouDDy (via extensão do Chrome, igual novo_cliente.tsx) =====
  // Mesmo fluxo Principal/Secundária das automações via API — "Secundária"
  // sempre sorteia outra DNS (buildM3uUrlSecondary), mesmo que já tenha um
  // m3u salvo, e persiste no cliente igual o servidor faz pros outros apps.
  async function handleClouddyConfigure(mode: ReconfigureMode) {
    if (!data) return;
    const { email, password } = getClouddyCreds();
    if (!email || !password) {
      addToast(
        "error",
        "Email/senha obrigatórios",
        "Preencha o email e a senha do ClouDDy antes de configurar.",
      );
      return;
    }
    let m3uToSend = mode === "secundaria" ? "" : data.clientM3uUrl.trim();
    if (!m3uToSend) {
      m3uToSend =
        mode === "secundaria"
          ? buildM3uUrlSecondary(
              data.serverDns,
              data.serverUsername,
              data.serverPassword,
              data.serverName,
            )
          : buildM3uUrlFromDns(
              data.serverDns,
              data.serverUsername,
              data.serverPassword,
            );
    }
    if (!m3uToSend) {
      addToast(
        "error",
        "Sem link M3U",
        "Não foi possível gerar o link M3U. Verifique o DNS do servidor.",
      );
      return;
    }
    if (mode === "secundaria") {
      await supabaseBrowser
        .from("clients")
        .update({ m3u_url: m3uToSend })
        .eq("id", data.clientId);
      setData((prev) => (prev ? { ...prev, clientM3uUrl: m3uToSend } : prev));
    }
    setBusy(true);
    try {
      const result = await dispatchClouddyAction("CLOUDDY_CONFIGURE", {
        email,
        password,
        m3uUrl: m3uToSend,
      });
      if (result.ok) {
        if (result.expireDate) {
          const dateField = data.fieldsConfig.find(
            (f) => String(f.type || "").toLowerCase() === "date",
          );
          if (dateField)
            await persistFieldValue(fieldKeyOf(dateField), result.expireDate);
        }
        addToast(
          "success",
          "ClouDDy configurado",
          result.expireDate
            ? `TV + VOD atualizados. Vencimento: ${String(result.expireDate).split("-").reverse().join("/")}`
            : "TV + VOD atualizados.",
        );
      } else {
        addToast(
          "error",
          "Falha ao configurar",
          result.error || "Não foi possível configurar o ClouDDy.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleClouddyCheck() {
    if (!data) return;
    const { email, password } = getClouddyCreds();
    if (!email || !password) {
      addToast(
        "error",
        "Email/senha obrigatórios",
        "Preencha o email e a senha do ClouDDy antes de verificar.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await dispatchClouddyAction("CLOUDDY_CHECK", {
        email,
        password,
      });
      if (result.ok && result.expireDate) {
        const dateField = data.fieldsConfig.find(
          (f) => String(f.type || "").toLowerCase() === "date",
        );
        if (dateField)
          await persistFieldValue(fieldKeyOf(dateField), result.expireDate);
        addToast(
          "success",
          "Vencimento verificado",
          `ClouDDy: ${String(result.expireDate).split("-").reverse().join("/")}`,
        );
      } else if (result.ok) {
        addToast(
          "warning",
          "Sem vencimento",
          "Não foi possível localizar o vencimento.",
        );
      } else {
        addToast(
          "error",
          "Não foi possível verificar",
          result.error || "Falha desconhecida.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleClouddyDelete() {
    const { email, password } = getClouddyCreds();
    if (!email || !password) {
      addToast(
        "error",
        "Email/senha obrigatórios",
        "Preencha o email e a senha do ClouDDy antes de remover.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await dispatchClouddyAction("CLOUDDY_DELETE", {
        email,
        password,
      });
      if (result.ok)
        addToast("success", "ClouDDy removido", "TV + VOD removidos.");
      else
        addToast(
          "error",
          "Falha ao remover",
          result.error || "Não foi possível remover no ClouDDy.",
        );
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
  //   - "renewal": não mexe em client_app_requests (não existe pra esse
  //     caso) — marca o payment_log como manual_done. O vencimento em si já
  //     foi atualizado pelos botões Configurar/Verificar acima.
  async function handleResolve() {
    const isRemoval = action === "removal";
    const isRenewal = action === "renewal";
    const ok = await confirm({
      title: isRemoval
        ? "Concluir exclusão"
        : isRenewal
          ? "Concluir renovação"
          : "Concluir configuração",
      subtitle: isRemoval
        ? `Você já removeu (ou vai remover agora) "${data?.appName}" do painel do parceiro? Isso vai apagar o app da conta de ${data?.clientName} agora.`
        : isRenewal
          ? `Você já pagou/renovou a licença de "${data?.appName}" pra ${data?.clientName}? Isso vai marcar o pagamento como concluído.`
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
        await apiCall("/api/admin/apps/remove", {
          tenant_id: tenantId,
          client_app_id: clientAppId,
        });
      }

      if (isRenewal) {
        const { error } = await supabaseBrowser.rpc(
          "update_fulfillment_status",
          {
            p_log_id: paymentLogId,
            p_tenant_id: tenantId,
            p_status: "manual_done",
          },
        );
        if (error) throw error;

        // ✅ Mensagem genérica opcional — mesmo padrão da renovação manual
        // de assinatura (recarga_cliente.tsx): sorteia entre o template e
        // suas variantes, envia, valida a resposta antes de considerar
        // enviado, e grava o status/resolve a notificação de falha no
        // mesmo payment_log da renovação.
        if (sendRenewalMsg && messageContent && messageContent.trim()) {
          try {
            const { data: session } = await supabaseBrowser.auth.getSession();
            const token = session.session?.access_token;

            let imageUrlToSend: string | null = null;
            let finalMessage = messageContent;
            if (selectedTemplateId) {
              const tpl = templates.find((t) => t.id === selectedTemplateId);
              if (tpl?.image_url) imageUrlToSend = tpl.image_url;

              const { data: variants } = await supabaseBrowser
                .from("message_template_variants")
                .select("content")
                .eq("tenant_id", tenantId)
                .eq("template_id", selectedTemplateId);
              const pool = [
                tpl?.content,
                ...(variants || []).map((v: any) => v.content),
              ].filter((c): c is string => !!c && String(c).trim().length > 0);
              if (pool.length > 0)
                finalMessage = pool[Math.floor(Math.random() * pool.length)];
            }

            const res = await fetch("/api/whatsapp/envio_agora", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                tenant_id: tenantId,
                client_id: data?.clientId,
                message: finalMessage,
                message_template_id: selectedTemplateId || null,
                image_url: imageUrlToSend,
              }),
            });
            if (!res.ok) throw new Error("API retornou erro");

            await supabaseBrowser.rpc("update_whatsapp_status", {
              p_log_id: paymentLogId,
              p_tenant_id: tenantId,
              p_status: "sent",
            });
            try {
              await supabaseBrowser.rpc("resolve_notification", {
                p_tenant_id: tenantId,
                p_type: "whatsapp_falha",
                p_source_id: paymentLogId,
              });
            } catch {}
          } catch (e: any) {
            // ✅ Sem isso, uma falha real de envio ficava indistinguível de
            // "nunca tentou" — a coluna Mensagem WA da Auditoria mostrava
            // "Aguardando" pra sempre em vez de "Erro" (mesmo tratamento
            // já usado na renovação manual de assinatura).
            try {
              await supabaseBrowser.rpc("update_whatsapp_status", {
                p_log_id: paymentLogId,
                p_tenant_id: tenantId,
                p_status: "error",
              });
            } catch {}
            addToast(
              "warning",
              "Renovação concluída, WhatsApp falhou",
              e?.message || "Mensagem não enviada.",
            );
          }
        }
      } else {
        const { data: userData } = await supabaseBrowser.auth.getUser();
        const { error } = await supabaseBrowser
          .from("client_app_requests")
          .update({
            status: "done",
            completed_at: new Date().toISOString(),
            completed_by: userData?.user?.id || null,
          })
          .eq("id", requestId);
        if (error) throw error;
      }

      try {
        await supabaseBrowser.rpc("resolve_notification", {
          p_tenant_id: tenantId,
          p_type: isRenewal
            ? "manual_pending"
            : isRemoval
              ? "app_removal_pending"
              : "app_setup_pending",
          p_source_id: isRenewal ? paymentLogId : requestId,
        });
      } catch {
        // não bloqueia a conclusão por causa da notificação
      }

      addToast(
        "success",
        "Concluído",
        isRemoval
          ? `"${data?.appName}" foi excluído.`
          : isRenewal
            ? `Renovação de "${data?.appName}" concluída.`
            : `"${data?.appName}" marcado como configurado.`,
      );
      onResolved();
    } catch (e: any) {
      addToast("error", "Erro ao concluir", e?.message);
    } finally {
      setBusy(false);
    }
  }

  // "Cancelar renovação" — só existe pra action="renewal": encerra a
  // pendência sem alterar o vencimento (ex: cobrança duplicada). Mesmo
  // comportamento do AppRenewalModal original: instantâneo, sem confirm().
  async function handleCancelRenewal() {
    setBusy(true);
    try {
      const { error } = await supabaseBrowser.rpc("update_fulfillment_status", {
        p_log_id: paymentLogId,
        p_tenant_id: tenantId,
        p_status: "manual_cancelled",
      });
      if (error) throw error;
      addToast(
        "success",
        "Cancelado",
        "Renovação cancelada — vencimento não foi alterado.",
      );
      onResolved();
    } catch (e: any) {
      addToast("error", "Erro ao cancelar", e?.message);
    } finally {
      setBusy(false);
    }
  }

  const isClouddy = data?.integrationType === "CLOUDDY";
  const hasApiIntegration = !!data?.handler?.useApi;
  const canCheck =
    hasApiIntegration && data
      ? CHECK_VALIDITY_HANDLERS.has(data.handler!.actionPrefix)
      : false;

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg" zIndex="z-[100000]">
      <div className="p-6 overflow-y-auto min-h-0 custom-scrollbar">
        <h3 className="text-lg font-bold mb-3">
          {action === "removal"
            ? "Pedido de exclusão"
            : action === "renewal"
              ? "Concluir renovação de licença"
              : "Pedido de configuração"}
        </h3>
        {loading || !data ? (
          <div className="py-8 text-center text-muted-foreground">
            Carregando...
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Nome do cliente:</span>
              <span className="font-medium">{data.clientName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Servidor:</span>
              <span className="font-medium">
                {data.serverUsername}
                {data.serverName ? ` (${data.serverName})` : ""}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Aplicativo:</span>
              <span className="font-medium">{data.appName}</span>
            </div>

            {/* Campos do app — mesmo componente do card de aplicativos do
                editar cliente: editável (dá pra corrigir um MAC errado ou
                limpar um campo direto daqui) e com botão de copiar. */}
            <div className="pt-1">
              <AppInstanceFields
                fieldsConfig={data.fieldsConfig}
                values={data.fieldValues}
                onFieldChange={(key, value) => persistFieldValue(key, value)}
                onCopy={copyField}
              />
            </div>

            {clientAppId && (isClouddy || hasApiIntegration) && (
              <div className="pt-2 border-t border-border">
                <AppIntegrationActions
                  isClouddy={isClouddy}
                  hasApiIntegration={hasApiIntegration}
                  appLabel={data.appName}
                  panelUrl={data.panelUrl}
                  canCheckVencimento={canCheck}
                  loading={busy}
                  onOpenPanel={openPanel}
                  onConfigure={handleConfigure}
                  onCheck={handleCheck}
                  onRemove={handleRemove}
                  onClouddyConfigure={handleClouddyConfigure}
                  onClouddyCheck={handleClouddyCheck}
                  onClouddyDelete={handleClouddyDelete}
                />
              </div>
            )}

            {clientAppId && !isClouddy && !hasApiIntegration && (
              <p className="text-xs text-muted-foreground italic pt-1">
                Sem integração automática disponível para este aplicativo —
                resolva manualmente antes de concluir.
              </p>
            )}

            {/* ✅ Mensagem genérica ao concluir (pedido do Márcio, 04/08/2026)
                — toggle sempre ligado por padrão, template pré-selecionado
                pelo nome. Tudo numa linha só. Mesmo padrão visual do Switch
                usado em novo_cliente.tsx/recarga_cliente.tsx (w-12 h-7 +
                thumb w-5 h-5) — esse componente é local a cada arquivo, sem
                versão compartilhada, então replica aqui pra não destoar. */}
            {action === "renewal" && (
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <div
                  onClick={() => setSendRenewalMsg((v) => !v)}
                  className="h-10 px-3 rounded-lg border border-border bg-muted/40 cursor-pointer hover:bg-muted transition-colors flex items-center gap-2 shrink-0"
                >
                  <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                    Enviar mensagem
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSendRenewalMsg((v) => !v);
                    }}
                    className={`relative w-12 h-7 rounded-full transition-colors border shrink-0 ${
                      sendRenewalMsg
                        ? "bg-emerald-600 border-emerald-600"
                        : "bg-muted border-border"
                    }`}
                    aria-pressed={sendRenewalMsg}
                  >
                    <span
                      className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-card transition-transform ${
                        sendRenewalMsg ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {sendRenewalMsg && (
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedTemplateId(id);
                      const tpl = templates.find((t) => t.id === id);
                      setMessageContent(tpl?.content || "");
                    }}
                    className="flex-1 min-w-0 h-10 px-2.5 bg-muted border border-border rounded-lg text-xs text-foreground outline-none focus:border-emerald-500/50"
                  >
                    <option value="">-- Personalizado --</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-3">
              <button
                disabled={busy}
                onClick={handleResolve}
                className={`flex-1 px-4 py-2 rounded-lg text-white disabled:opacity-50 flex items-center justify-center gap-1.5 ${action === "removal" ? "bg-rose-600" : "bg-emerald-600"}`}
              >
                {busy && <Loader2 className="w-4 h-4 shrink-0 animate-spin" />}
                {action === "removal"
                  ? "Concluir & Excluir"
                  : action === "renewal"
                    ? "Salvar"
                    : "Concluir"}
              </button>
              {action === "renewal" && (
                <button
                  disabled={busy}
                  onClick={handleCancelRenewal}
                  className="flex-1 px-4 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {busy && (
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  )}
                  Cancelar renovação
                </button>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-full text-xs text-muted-foreground hover:text-foreground"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
