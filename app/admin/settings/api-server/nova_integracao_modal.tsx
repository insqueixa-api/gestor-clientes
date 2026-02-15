"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";

export type IntegrationProvider = "NATV";

export type IntegrationEditPayload = {
  id: string;
  provider: IntegrationProvider | string;
  integration_name: string | null;
  is_active: boolean | null;
};

export default function NovaIntegracaoModal({
  integration,
  onClose,
  onSuccess,
  onError,
}: {
  integration?: IntegrationEditPayload | null;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const isEdit = !!integration?.id;

  const [provider, setProvider] = useState<IntegrationProvider>(
    (String(integration?.provider || "NATV").toUpperCase() as IntegrationProvider) || "NATV"
  );
  const [integrationName, setIntegrationName] = useState(integration?.integration_name ?? "");
  const [apiToken, setApiToken] = useState(""); // nunca preenchemos com token atual
  const [isActive, setIsActive] = useState<boolean>(integration?.is_active ?? true);

  const [saving, setSaving] = useState(false);

  const canSave = useMemo(() => {
    if (!provider) return false;
    if (!integrationName.trim()) return false;

    // ✅ criar: token obrigatório
    if (!isEdit && !apiToken.trim()) return false;

    // ✅ editar: token opcional
    return true;
  }, [provider, integrationName, apiToken, isEdit]);

  async function handleSave() {
    if (!canSave) return;

    try {
      setSaving(true);
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("Tenant não encontrado.");

      if (!isEdit) {
        // ✅ INSERT
        const payload = {
          tenant_id: tenantId,
          provider,
          integration_name: integrationName.trim(),
          api_token: apiToken.trim(),
          is_active: isActive,
        };

        const { error } = await supabaseBrowser.from("server_integrations").insert(payload);
        if (error) throw error;

        onSuccess();
        return;
      }

      // ✅ UPDATE
      const patch: any = {
        provider,
        integration_name: integrationName.trim(),
        is_active: isActive,
      };

      // só troca token se usuário digitou
      if (apiToken.trim()) {
        patch.api_token = apiToken.trim();
      }

      const { error } = await supabaseBrowser
        .from("server_integrations")
        .update(patch)
        .eq("id", integration!.id);

      if (error) throw error;

      onSuccess();
    } catch (e: any) {
      onError(e?.message ?? "Falha ao salvar integração.");
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center px-3">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161b22] shadow-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white tracking-tight truncate">
                {isEdit ? "Editar Integração" : "Nova Integração"}
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-white/50 mt-1">
                {isEdit
                  ? "Atualize os dados. Para trocar o token, cole um novo (o atual não é exibido)."
                  : "Cadastre um token de integração para automatizações e consulta de saldo."}
              </p>
            </div>
            <button
              onClick={onClose}
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 text-xs font-bold hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
              type="button"
            >
              Fechar
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
              Provedor
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as IntegrationProvider)}
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="NATV">NaTV</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
              Nome da integração
            </label>
            <input
              value={integrationName}
              onChange={(e) => setIntegrationName(e.target.value)}
              placeholder='Ex: "Revenda Principal"'
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1">
              Esse nome é só para você identificar na lista.
            </p>
          </div>

          {/* ✅ Status (ativa/inativa) */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-700 dark:text-white">Integração ativa</div>
              <div className="text-[11px] text-slate-500 dark:text-white/40">
                Se desativar, ela não deve ser usada pelo servidor.
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

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
              {isEdit ? "Novo Token (opcional)" : "Token / Chave API"}
            </label>
            <input
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={isEdit ? "Cole aqui o NOVO token (não exibimos o atual)" : "Bearer token (sem 'Bearer ')"} 
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1">
              {isEdit
                ? "Por segurança, o token atual não é exibido. Se não preencher, ele permanece igual."
                : "Depois a gente usa o botão Sync/Testar para preencher revenda e saldo automaticamente."}
            </p>
          </div>
        </div>

        <div className="p-5 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
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
