"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/app/admin/HookuseConfirm";

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

  const [appName, setAppName]         = useState(integration?.app_name ?? "GERENCIAAPP");
  const [label, setLabel]             = useState(integration?.label ?? "");
  const [loginEmail, setLoginEmail]   = useState(integration?.login_email ?? "");
  const [loginPassword, setLoginPassword] = useState(integration?.login_password ?? "");
  const [apiUrl, setApiUrl]           = useState(integration?.api_url ?? "");
  const [pin, setPin]                 = useState(integration?.pin ?? ""); // ✅ Estado do PIN
  const [isActive, setIsActive]       = useState(integration?.is_active ?? true);
  
  const [saving, setSaving]           = useState(false);
  const [userRole, setUserRole]       = useState(""); // ✅ Trocado userEmail por userRole
  const [isUploading, setIsUploading] = useState(false);
  
  const { confirm, ConfirmUI } = useConfirm(); 
  // ✅ Controle conjunto para Apps que exigem PIN
  const isDuplecast = appName === "DUPLECAST";
  const isIboSol    = appName === "IBOSOL";
  const needsPin    = isDuplecast || isIboSol;

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
    
    // ✅ Busca o nível de acesso real do usuário no banco
    supabaseBrowser.rpc("saas_my_role").then(({ data }) => {
        if (data) setUserRole(String(data).toUpperCase());
    });
  }, [integration]);

  // ✅ Validação dinâmica exigindo o PIN para Duplecast ou IBOSOL
  const canSave = needsPin 
    ? label.trim() && loginEmail.trim() && loginPassword.trim() && apiUrl.trim() && pin.trim()
    : label.trim() && loginEmail.trim() && loginPassword.trim() && apiUrl.trim();
  
  // ✅ Libera o upload apenas se a role dele for SUPERADMIN (A mesma regra do seu painel)
  const isMasterUser = userRole === "SUPERADMIN";

  async function handleUploadExtension(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ok = await confirm({
      title: "Atualizar Extensão?",
      subtitle: `Deseja fazer o upload de "${file.name}"? Isso atualizará a versão atual para todos.`,
      confirmText: "Sim, Atualizar",
      cancelText: "Cancelar"
    });

    if (!ok) {
      e.target.value = ""; 
      return;
    }

    try {
      setIsUploading(true);
      const { error } = await supabaseBrowser.storage
        .from("extensions")
        .upload("unigestor-extensao.zip", file, { upsert: true, cacheControl: "3600" });

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
        tenant_id:      tenantId,
        app_name:       appName,
        label:          label.trim(),
        login_email:    loginEmail.trim(),
        login_password: loginPassword.trim(),
        api_url:        normalizeApiUrl(apiUrl),
        pin:            needsPin ? pin.trim() : null, // ✅ Salva o PIN para os apps que precisam
        is_active:      isActive,
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
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" onClick={onCloseAction} />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161b22] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[90vh]">

        {/* Header Elegante */}
        <div className="px-6 py-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
              {isEdit ? "Editar Integração" : "Nova Integração"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">
              Configure as credenciais para o robô atuar no painel.
            </p>
          </div>
          <button
            onClick={onCloseAction}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 transition-colors"
            type="button"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body com Grid */}
        <div className="p-6 overflow-y-auto custom-scrollbar space-y-5">
          
          {/* Upload Master Simplificado */}
          {isMasterUser && (
            <div className="flex items-center justify-between p-4 bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 rounded-xl">
              <div>
                <h3 className="text-xs font-bold text-sky-800 dark:text-sky-300">Atualizar Robô (Extensão)</h3>
                <p className="text-[10px] text-sky-600 dark:text-sky-400 mt-0.5">Substitua o arquivo .zip na nuvem.</p>
              </div>
              <label className="cursor-pointer bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold px-3 py-2 rounded-lg transition-colors shadow-sm whitespace-nowrap">
                {isUploading ? "A enviar..." : "Selecionar .zip"}
                <input type="file" accept=".zip" className="hidden" onChange={handleUploadExtension} disabled={isUploading} />
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Aplicativo */}
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 dark:text-white/40 mb-1.5 uppercase tracking-wider">Aplicativo</label>
              <select
                value={appName}
                onChange={(e) => {
                  setAppName(e.target.value);
                  setLoginEmail(""); setLoginPassword(""); setPin(""); setApiUrl("");
                }}
                className="w-full h-11 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 focus:bg-white dark:focus:bg-black/40 transition-colors cursor-pointer"
              >
                <option value="GERENCIAAPP">GerenciaApp</option>
                <option value="DUPLECAST">Duplecast</option>
                <option value="IBOSOL">Família IBO SOL (BOB, Mac, Elite...)</option>
              </select>
            </div>

            {/* Nome da Integração */}
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 dark:text-white/40 mb-1.5 uppercase tracking-wider">Nome de identificação</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={needsPin ? 'Ex: "Meu Painel IBO/Duplecast"' : 'Ex: "Meu GerenciaApp"'}
                className="w-full h-11 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 focus:bg-white dark:focus:bg-black/40 transition-colors"
              />
            </div>

            {/* URL da API */}
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 dark:text-white/40 mb-1.5 uppercase tracking-wider">Link do Painel</label>
              <input
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder={isDuplecast ? "Ex: https://duplecast.com/client" : isIboSol ? "Ex: https://activation.iboplayer.com" : "Ex: https://gerenciaapp.top"}
                type="url"
                className="w-full h-11 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 focus:bg-white dark:focus:bg-black/40 transition-colors font-mono text-xs"
              />
            </div>

            {/* Email de Login */}
            <div className={needsPin ? "sm:col-span-1" : "sm:col-span-2"}>
              <label className="block text-[10px] font-bold text-slate-500 dark:text-white/40 mb-1.5 uppercase tracking-wider">E-mail / Usuário</label>
              <input
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder={needsPin ? "Usuário ou E-mail" : "seuemail@exemplo.com"}
                type="text"
                autoCapitalize="none"
                className="w-full h-11 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 focus:bg-white dark:focus:bg-black/40 transition-colors"
              />
            </div>

            {/* Senha */}
            <div className={needsPin ? "sm:col-span-1" : "sm:col-span-2"}>
              <label className="block text-[10px] font-bold text-slate-500 dark:text-white/40 mb-1.5 uppercase tracking-wider">Senha</label>
              <input
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Senha de acesso"
                type="text"
                className="w-full h-11 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 focus:bg-white dark:focus:bg-black/40 transition-colors"
              />
            </div>

            {/* PIN (Exclusivo para Apps que Exigem) animado */}
            {needsPin && (
              <div className="sm:col-span-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="block text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mb-1.5 uppercase tracking-wider">PIN Padrão (Criação de Teste)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔒</span>
                  <input
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} // Apenas números
                    placeholder="Ex: 123456"
                    type="text"
                    maxLength={6}
                    className="w-full h-11 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5 px-10 text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500 focus:bg-white dark:focus:bg-black/40 transition-colors font-mono tracking-widest"
                  />
                </div>
                <p className="text-[10px] text-slate-500 dark:text-white/40 mt-1.5 ml-1">Usado automaticamente na geração das playlists.</p>
              </div>
            )}

            {/* Status */}
            <div className="sm:col-span-2 mt-2">
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20">
                <div>
                  <div className="text-sm font-bold text-slate-700 dark:text-white">Integração Ativa</div>
                  <div className="text-[10px] text-slate-500 dark:text-white/40 mt-0.5">Se desativar, não será acionada nos clientes.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsActive((v) => !v)}
                  className={`relative w-12 h-6 rounded-full transition-colors border ${
                    isActive ? "bg-emerald-500 border-emerald-500" : "bg-slate-300 dark:bg-white/10 border-transparent"
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isActive ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* Footer Elegante */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onCloseAction}
            className="h-10 px-5 rounded-xl text-slate-600 dark:text-white/70 text-sm font-bold hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
            type="button"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className={`h-10 px-6 rounded-xl text-sm font-bold text-white transition-all transform active:scale-95 flex items-center gap-2 ${
              canSave
                ? "bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/20"
                : "bg-slate-300 dark:bg-white/10 cursor-not-allowed opacity-70"
            }`}
            type="button"
            disabled={!canSave || saving}
          >
            {saving && (
              <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {saving ? "Salvando..." : "Salvar Integração"}
          </button>
        </div>

      </div>
      {ConfirmUI}
    </div>
  );

  return createPortal(modal, document.body);
}