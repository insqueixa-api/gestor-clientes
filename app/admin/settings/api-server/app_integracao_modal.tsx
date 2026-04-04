"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";

type AppIntegration = {
  id: string;
  tenant_id: string;
  app_name: string;
  label: string;
  login_email: string | null;
  login_password: string | null;
  api_url: string | null;
  is_active: boolean;
  created_at: string;
};

export default function AppIntegracaoModal({
  integration,
  onCloseAction,
  onSuccess,
  onError,
}: {
  integration?: AppIntegration | null;
  onCloseAction: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const isEdit = !!integration?.id;

  const [appName, setAppName]         = useState(integration?.app_name ?? "GERENCIAAPP");
  const [label, setLabel]             = useState(integration?.label ?? "");
  const [loginEmail, setLoginEmail]   = useState(integration?.login_email ?? "");
  const [loginPassword, setLoginPassword] = useState(integration?.login_password ?? "");
  const [isActive, setIsActive]       = useState(integration?.is_active ?? true);
  const [saving, setSaving]           = useState(false);

  useEffect(() => {
    if (integration) {
      setAppName(integration.app_name ?? "GERENCIAAPP");
      setLabel(integration.label ?? "");
      setLoginEmail(integration.login_email ?? "");
      setLoginPassword(integration.login_password ?? "");
      setIsActive(integration.is_active ?? true);
    }
  }, [integration]);

  const canSave = label.trim() && loginEmail.trim() && loginPassword.trim();

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

      onSuccess();
    } catch (e: any) {
      onError(e?.message ?? "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center px-3">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCloseAction} />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161b22] shadow-xl overflow-hidden">

        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white tracking-tight">
              {isEdit ? "Editar Integração" : "Nova Integração de Aplicativo"}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-white/50 mt-1">
              Credenciais usadas para automação no painel do aplicativo.
            </p>
          </div>
          <button
            onClick={onCloseAction}
            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 text-xs font-bold hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
            type="button"
          >
            Fechar
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">

          {/* Aplicativo */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
              Aplicativo
            </label>
            <select
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="GERENCIAAPP">GerenciaApp</option>
            </select>
          </div>

          {/* Label */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
              Nome da integração
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder='Ex: "Meu GerenciaApp"'
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1">
              Só para identificar na lista.
            </p>
          </div>

          {/* Email */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
              E-mail de login
            </label>
            <input
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="seuemail@exemplo.com"
              type="email"
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>

          {/* Senha */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
              Senha
            </label>
            <input
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Senha do painel"
              type="text"
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1">
              Fica visível para facilitar manutenção.
            </p>
          </div>

          {/* Status */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-700 dark:text-white">Integração ativa</div>
              <div className="text-[11px] text-slate-500 dark:text-white/40">
                Se desativar, não será usada nas automações.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              className={`h-9 px-3 rounded-lg text-xs font-bold border transition-colors ${
                isActive
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
              }`}
            >
              {isActive ? "Ativa" : "Inativa"}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex items-center justify-end gap-2">
          <button
            onClick={onCloseAction}
            className="h-10 px-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 text-xs font-bold hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
            type="button"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className={`h-10 px-4 rounded-xl text-xs font-bold text-white transition-colors ${
              canSave
                ? "bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/20"
                : "bg-slate-300 dark:bg-white/10 cursor-not-allowed"
            }`}
            type="button"
            disabled={!canSave || saving}
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>

      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
