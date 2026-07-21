"use client";
// app/admin/settings/api-server/app_integracao_modal.tsx
import { Loader2 } from "lucide-react";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/hooks/useConfirm";

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
  const needsPin =
    isDuplecast ||
    isIboSol ||
    isIboPro ||
    isQuickPlayer;
  const noCredentials =
    isIboSol || isIboPro || isQuickPlayer; // Apps que não usam email/senha (login é por MAC+Device Key, por aparelho)

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

  // ✅ Validação dinâmica ocultando e-mail e senha para IBO Sol
  const canSave = noCredentials
    ? label.trim() && apiUrl.trim() && pin.trim()
    : needsPin
      ? label.trim() &&
        loginEmail.trim() &&
        loginPassword.trim() &&
        apiUrl.trim() &&
        pin.trim()
      : label.trim() &&
        loginEmail.trim() &&
        loginPassword.trim() &&
        apiUrl.trim();

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
      const tenantId = await getCurrentTenantId();
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

  const modal = (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center px-3">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onCloseAction}
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[90vh]">
        {/* Header Elegante */}
        <div className="px-6 py-5 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-medium text-foreground tracking-tight">
              {isEdit ? "Editar Integração" : "Nova Integração"}
            </h2>
            <p className="text-xs text-foreground/70 mt-0.5">
              Configure as credenciais para o robô atuar no painel.
            </p>
          </div>
          <button
            onClick={onCloseAction}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground transition-colors"
            type="button"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body com Grid */}
        <div className="p-6 overflow-y-auto custom-scrollbar space-y-5">
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
                <option value="IBOSOL">IBO Sol</option>
                <option value="IBOPRO">IBO Pro Player</option>
                <option value="QUICKPLAYER">Quick Player / Quick Player Pro</option>
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
                      ? "Ex: https://activation.iboplayer.com"
                      : isIboPro
                        ? "Ex: https://iboproapp.com"
                        : isQuickPlayer
                          ? "Ex: https://api.quickplayer.app"
                          : "Ex: https://gerenciaapp.top"
                }
                type="url"
                className="w-full h-11 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-emerald-500/50 focus:bg-card transition-colors font-mono text-xs"
              />
            </div>

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
        </div>

        {/* Footer Elegante */}
        <div className="px-6 py-4 border-t border-border bg-transparent flex items-center justify-end gap-3 shrink-0">
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
        </div>
      </div>
      {ConfirmUI}
    </div>
  );

  return createPortal(modal, document.body);
}
