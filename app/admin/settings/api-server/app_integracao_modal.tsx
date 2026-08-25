"use client";
// app/admin/settings/api-server/app_integracao_modal.tsx
import { Loader2 } from "lucide-react";

import { useEffect, useState } from "react";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/hooks/useConfirm";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";

function normalizeApiUrl(url: string) {
  if (!url) return "";
  let s = url.trim().replace(/\/+$/, "");
  if (s && !s.startsWith("http")) {
    s = "https://" + s;
  }
  return s;
}

type AppIntegration = {
  id: string;
  tenant_id: string;
  app_name: string;
  label: string;
  login_email: string | null;
  login_password: string | null;
  api_url: string | null;
  pin?: string | null; // ✅ NOVO: Adicionado tipagem do PIN
  is_active: boolean;
  created_at: string;
};

export default function AppIntegracaoModal({
  integration,
  onCloseAction,
  onSuccessAction,
  onErrorAction,
}: {
  integration?: AppIntegration | null;
  onCloseAction: () => void;
  onSuccessAction: () => void;
  onErrorAction: (msg: string) => void;
}) {
  const tenantId = useTenantId();
  const isEdit = !!integration?.id;

  const [appName, setAppName] = useState(
    integration?.app_name ?? "GERENCIAAPP",
  );
  const [label, setLabel] = useState(integration?.label ?? "");
  const [loginEmail, setLoginEmail] = useState(integration?.login_email ?? "");
  const [loginPassword, setLoginPassword] = useState(
    integration?.login_password ?? "",
  );
  const [apiUrl, setApiUrl] = useState(integration?.api_url ?? "");
  const [pin, setPin] = useState(integration?.pin ?? ""); // ✅ Estado do PIN
  const [isActive, setIsActive] = useState(integration?.is_active ?? true);

  const [saving, setSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const { confirm, ConfirmUI } = useConfirm();

  // ✅ Controle conjunto para Apps que exigem PIN
  const isDuplecast = appName === "DUPLECAST";
  const isIboSol = appName === "IBOSOL";
  const isIboPro = appName === "IBOPRO";
  const isQuickPlayer = appName === "QUICKPLAYER";
  const isMessiTv = appName === "MESSITV";
  const isBobPlayer = appName === "BOBPLAYER";
  const isIboPlayer = appName === "IBOPLAYER";
  const isIptvDuplex = appName === "IPTVDUPLEX";
  const isIptvPlayerio = appName === "IPTVPLAYERIO";
  const isDuplexTv = appName === "DUPLEXTV";
  const isClouddy = appName === "CLOUDDY";
  const isNinjaPlayer = appName === "NINJAPLAYER";
  const isAppativa = appName === "APPATIVA";
  const needsPin =
    isDuplecast ||
    isIboPro ||
    isQuickPlayer ||
    isMessiTv ||
    isBobPlayer ||
    isIboPlayer ||
    isIptvDuplex ||
    isIptvPlayerio; // DUPLEXTV/CLOUDDY/NINJAPLAYER/IBOSOL ficam de fora — não usam PIN
  const noCredentials =
    isIboPro ||
    isQuickPlayer ||
    isMessiTv ||
    isBobPlayer ||
    isIboPlayer ||
    isIptvDuplex ||
    isIptvPlayerio ||
    isDuplexTv ||
    isClouddy ||
    isNinjaPlayer ||
    isAppativa; // ✅ NINJAPLAYER: login é por mac+device_key POR CLIENTE
  // (client_apps.field_values), não um login/senha compartilhado pelo
  // tenant — mesma razão do CLOUDDY logo acima.
  // (client_apps.field_values), não um só compartilhado pelo tenant —
  // mostrar os campos aqui confundiria (pareceria que fazem algo, mas a
  // rota nunca lê daqui). O que a rota REALMENTE usa daqui é api_url +
  // is_active (kill-switch).
  // ✅ APPATIVA (24/08/2026): autentica por API key (não usuário/senha nem
  // PIN) — a chave já está guardada como variável de ambiente (APPATIVA na
  // Vercel/.env.local), igual TELEIN_API_KEY/TMDB_API_KEY, nunca por
  // tenant nesta tabela. Este cadastro aqui é só label+URL+kill-switch,
  // mesmo papel que já tem pros outros apps "noCredentials".

  useEffect(() => {
    if (integration) {
      setAppName(integration.app_name ?? "GERENCIAAPP");
      setLabel(integration.label ?? "");
      setLoginEmail(integration.login_email ?? "");
      setLoginPassword(integration.login_password ?? "");
      setApiUrl(integration.api_url ?? "");
      setPin(integration.pin ?? "");
      setIsActive(integration.is_active ?? true);
    }
  }, [integration]);

  // ✅ Validação dinâmica — noCredentials e needsPin são independentes desde
  // o DUPLEXTV (27/07/2026): sem email/senha E sem PIN (só MAC), diferente
  // de todos os apps anteriores onde os dois sempre coincidiam.
  const canSave =
    label.trim() &&
    apiUrl.trim() &&
    (noCredentials || (loginEmail.trim() && loginPassword.trim())) &&
    (!needsPin || pin.trim());

  async function handleUploadExtension(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ok = await confirm({
      title: "Atualizar Extensão?",
      subtitle: `Deseja fazer o upload de "${file.name}"? Isso atualizará a versão atual para todos.`,
      confirmText: "Sim, Atualizar",
      cancelText: "Cancelar",
    });

    if (!ok) {
      e.target.value = "";
      return;
    }

    try {
      setIsUploading(true);
      const { error } = await supabaseBrowser.storage
        .from("extensions")
        .upload("unigestor-extensao.zip", file, {
          upsert: true,
          cacheControl: "3600",
        });

      if (error) throw error;
      onSuccessAction();
    } catch (err: any) {
      onErrorAction(err.message || "Erro ao fazer upload.");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  }

  async function handleSave() {
    if (!canSave) return;
    try {
      setSaving(true);
      if (!tenantId) throw new Error("Tenant não encontrado.");

      const payload = {
        tenant_id: tenantId,
        app_name: appName,
        label: label.trim(),
        login_email: noCredentials ? null : loginEmail.trim(),
        login_password: noCredentials ? null : loginPassword.trim(),
        api_url: normalizeApiUrl(apiUrl),
        pin: needsPin ? pin.trim() : null, // ✅ Salva o PIN para os apps que precisam
        is_active: isActive,
      };

      if (isEdit) {
        const { error } = await supabaseBrowser
          .from("app_integrations")
          .update(payload)
          .eq("id", integration!.id)
          .eq("tenant_id", tenantId);
        if (error) throw error;
      } else {
        const { error } = await supabaseBrowser
          .from("app_integrations")
          .insert(payload);
        if (error) throw error;
      }

      onSuccessAction();
    } catch (e: any) {
      onErrorAction(e?.message ?? "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onCloseAction} maxWidth="max-w-3xl">
      <ModalHeader onClose={onCloseAction}>
        <h2 className="text-lg font-medium text-foreground tracking-tight">
          {isEdit ? "Editar Integração" : "Nova Integração"}
        </h2>
        <p className="text-xs text-foreground/70 mt-0.5">
          Configure as credenciais para o robô atuar no painel.
        </p>
      </ModalHeader>

        <ModalBody className="p-6 space-y-5">
          {/* Upload Master Simplificado - Agora sempre visível */}
          <div className="flex items-center justify-between p-4 bg-sky-500/10 border border-sky-500/30 rounded-xl">
            <div>
              <h3 className="text-xs font-medium text-sky-500">
                Atualizar Robô (Extensão)
              </h3>
              <p className="text-[10px] text-sky-500/80 mt-0.5">
                Substitua o arquivo .zip na nuvem.
              </p>
            </div>
            <label className="cursor-pointer bg-sky-600 hover:bg-sky-500 text-white gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight transition-colors shadow-sm whitespace-nowrap">
              {isUploading ? "A enviar..." : "Selecionar .zip"}
              <input
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handleUploadExtension}
                disabled={isUploading}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Aplicativo */}
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                Aplicativo
              </label>
              <select
                value={appName}
                onChange={(e) => {
                  setAppName(e.target.value);
                  setLoginEmail("");
                  setLoginPassword("");
                  setPin("");
                  setApiUrl("");
                }}
                className="w-full h-11 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-emerald-500/50 focus:bg-card transition-colors cursor-pointer"
              >
                <option value="GERENCIAAPP">
                  GerenciaApp (IBO Revenda, etc)
                </option>
                <option value="DUPLECAST">DupleCast</option>
                {/* ✅ IBOSOL voltou (02/08/2026, pedido do Márcio) — dessa vez
                    com escopo bem menor que antes: só pra checar o vencimento
                    real do Duplex TV (que não tem status próprio, ver
                    app/api/integrations/apps/duplextv/route.ts), via extensão
                    do Chrome (lib/apps/ibosol-extension.ts) — não cria/apaga
                    nada, não é mais a família de apps de antes. */}
                <option value="IBOSOL">IBO Sol (só checagem Duplex TV)</option>
                <option value="IBOPRO">IBO Pro Player</option>
                <option value="QUICKPLAYER">
                  Quick Player / Quick Player Pro
                </option>
                <option value="MESSITV">MessiTV</option>
                <option value="BOBPLAYER">BOB Player</option>
                <option value="IBOPLAYER">IBO Player</option>
                <option value="IPTVDUPLEX">IPTV Duplex Play</option>
                <option value="IPTVPLAYERIO">IPTV Playerio</option>
                <option value="DUPLEXTV">Duplex TV</option>
                <option value="CLOUDDY">ClouDDy</option>
                <option value="NINJAPLAYER">Ninja Player</option>
                <option value="APPATIVA">Appativa (Ative App Mídias)</option>
              </select>
            </div>

            {/* Nome da Integração */}
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                Nome de identificação
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={
                  appName === "DUPLECAST"
                    ? 'Ex: "DupleCast"'
                    : appName === "IBOSOL"
                      ? 'Ex: "IBO Sol"'
                      : appName === "IBOPRO"
                        ? 'Ex: "IBO Pro Player"'
                        : isQuickPlayer
                          ? 'Ex: "Quick Player"'
                          : isMessiTv
                            ? 'Ex: "MessiTV"'
                            : isBobPlayer
                              ? 'Ex: "BOB Player"'
                              : isIboPlayer
                                ? 'Ex: "IBO Player"'
                                : isIptvDuplex
                                  ? 'Ex: "IPTV Duplex Play"'
                                  : isIptvPlayerio
                                    ? 'Ex: "IPTV Playerio"'
                                    : isDuplexTv
                                      ? 'Ex: "Duplex TV"'
                                      : isClouddy
                                        ? 'Ex: "ClouDDy"'
                                        : isNinjaPlayer
                                          ? 'Ex: "Ninja Player"'
                                          : isAppativa
                                            ? 'Ex: "Appativa"'
                                            : 'Ex: "Nome do aplicativo"'
                }
                className="w-full h-11 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-emerald-500/50 focus:bg-card transition-colors"
              />
            </div>

            {/* URL da API */}
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                Link do Painel
              </label>
              <input
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder={
                  isDuplecast
                    ? "Ex: https://duplecast.com/client"
                    : isIboSol
                      ? "Ex: https://ibosol.com"
                      : isIboPro
                        ? "Ex: https://iboproapp.com"
                        : isQuickPlayer
                          ? "Ex: https://api.quickplayer.app"
                          : isMessiTv
                            ? "Ex: https://messitvplayer.com"
                            : isBobPlayer
                              ? "Ex: https://www.bobplayer.com"
                              : isIboPlayer
                                ? "Ex: https://iboplayer.com"
                                : isIptvDuplex
                                  ? "Ex: https://iptvduplex.com"
                                  : isIptvPlayerio
                                    ? "Ex: https://iptvplayer.io"
                                    : isDuplexTv
                                      ? "Ex: https://duplex24.com"
                                      : isClouddy
                                        ? "Ex: https://console.clouddy.online"
                                        : isNinjaPlayer
                                          ? "Ex: https://meta-player.app"
                                          : isAppativa
                                            ? "Ex: https://appativa.store"
                                            : "Ex: https://gerenciaapp.top"
                }
                type="url"
                className="w-full h-11 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-emerald-500/50 focus:bg-card transition-colors font-mono text-xs"
              />
            </div>

            {isAppativa && (
              <div className="sm:col-span-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-[11px] text-amber-600">
                🔑 Chave de API já cadastrada como variável de ambiente
                (<code className="font-mono">APPATIVA</code>, na Vercel e no
                .env.local) — nunca fica salva aqui no banco. Integração
                ainda sem código (previsto pra 25/08/2026).
              </div>
            )}

            {/* Email de Login */}
            {!noCredentials && (
              <div className={needsPin ? "sm:col-span-1" : "sm:col-span-2"}>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                  E-mail / Usuário
                </label>
                <input
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder={
                    needsPin ? "Usuário ou E-mail" : "seuemail@exemplo.com"
                  }
                  type="text"
                  autoCapitalize="none"
                  className="w-full h-11 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-emerald-500/50 focus:bg-card transition-colors"
                />
              </div>
            )}

            {/* Senha */}
            {!noCredentials && (
              <div className={needsPin ? "sm:col-span-1" : "sm:col-span-2"}>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Senha
                </label>
                <input
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Senha de acesso"
                  type="text"
                  className="w-full h-11 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-emerald-500/50 focus:bg-card transition-colors"
                />
              </div>
            )}

            {/* PIN (Exclusivo para Apps que Exigem) animado */}
            {needsPin && (
              <div className="sm:col-span-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="block text-[10px] font-medium text-emerald-500 mb-1.5 uppercase tracking-wider">
                  PIN Padrão (Criação de Teste)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    🔒
                  </span>
                  <input
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} // Apenas números
                    placeholder="Ex: 123456"
                    type="text"
                    maxLength={6}
                    className="w-full h-11 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-10 text-sm text-foreground outline-none focus:border-emerald-500 focus:bg-card transition-colors font-mono tracking-widest"
                  />
                </div>
                <p className="text-[10px] text-foreground/70 mt-1.5 ml-1">
                  Usado automaticamente na geração das playlists.
                </p>
              </div>
            )}

            {/* Status */}
            <div className="sm:col-span-2 mt-2">
              <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-transparent">
                <div>
                  <div className="text-sm font-medium text-foreground/90">
                    Integração Ativa
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    Se desativar, não será acionada nos clientes.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsActive((v) => !v)}
                  className={`relative w-12 h-6 rounded-full transition-colors border ${
                    isActive
                      ? "bg-emerald-500 border-emerald-500"
                      : "bg-foreground/20 border-foreground/20"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card transition-transform ${isActive ? "translate-x-6" : "translate-x-0"}`}
                  />
                </button>
              </div>
            </div>
          </div>
        </ModalBody>

        <ModalFooter>
          <button
            onClick={onCloseAction}
            className="h-10 px-5 rounded-xl text-muted-foreground text-sm font-medium hover:bg-muted transition-colors"
            type="button"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className={`h-10 px-6 rounded-xl text-sm font-medium transition-all transform active:scale-95 flex items-center gap-2 ${
              canSave
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20"
                : "bg-muted text-muted-foreground cursor-not-allowed opacity-70"
            }`}
            type="button"
            disabled={!canSave || saving}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? "Salvando..." : "Salvar Integração"}
          </button>
        </ModalFooter>
      {ConfirmUI}
    </Modal>
  );
}
