"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";

export type IntegrationProvider = "NATV" | "FAST";


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

// ✅ agora preenche no edit
const [apiToken, setApiToken] = useState("");
const [apiSecret, setApiSecret] = useState("");

const [isActive, setIsActive] = useState<boolean>(integration?.is_active ?? true);

const [saving, setSaving] = useState(false);
const [loadingEdit, setLoadingEdit] = useState(false);

useEffect(() => {
  let alive = true;

  async function loadEditSecrets() {
    if (!isEdit || !integration?.id) return;

    try {
      setLoadingEdit(true);

      const { data, error } = await supabaseBrowser
        .from("server_integrations")
        .select("api_token, api_secret, provider, integration_name, is_active")
        .eq("id", integration.id)
        .single();

      if (error) throw error;
      if (!alive) return;

      // mantém provider coerente com o registro
      const p = String(data?.provider || "NATV").toUpperCase() as IntegrationProvider;
      setProvider(p);

      setIntegrationName(data?.integration_name ?? "");
      setIsActive(Boolean(data?.is_active ?? true));

      setApiToken(data?.api_token ?? "");
      setApiSecret(data?.api_secret ?? "");
    } catch (e) {
      // não trava o modal
      console.error(e);
    } finally {
      if (alive) setLoadingEdit(false);
    }
  }

  loadEditSecrets();

  return () => {
    alive = false;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isEdit, integration?.id]);

  const canSave = useMemo(() => {
    if (!provider) return false;
    if (!integrationName.trim()) return false;

// ✅ token sempre obrigatório (criar/editar)
if (!apiToken.trim()) return false;

// ✅ FAST exige secret sempre
if (provider === "FAST" && !apiSecret.trim()) return false;

return true;

    }, [provider, integrationName, apiToken, apiSecret, isEdit]);


  async function handleSave() {
    if (!canSave) return;

    try {
      setSaving(true);
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("Tenant não encontrado.");

      if (!isEdit) {
        // ✅ INSERT
const payload: any = {
  tenant_id: tenantId,
  provider,
  integration_name: integrationName.trim(),
  api_token: apiToken.trim(),
  is_active: isActive,
};

if (provider === "FAST") {
  payload.api_secret = apiSecret.trim();
} else {
  payload.api_secret = null; // garante limpeza se trocar provider
}

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
  api_token: apiToken.trim(), // ✅ agora sempre salva o valor visível
};

if (provider === "FAST") {
  patch.api_secret = apiSecret.trim();
} else {
  patch.api_secret = null; // ✅ se mudou pra NATV, zera secret
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
  ? "Atualize os dados da integração (token/secret ficam visíveis para facilitar manutenção)."
  : "Cadastre a integração para automatizações e consulta de saldo."}

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
              onChange={(e) => {
  const next = e.target.value as IntegrationProvider;
  setProvider(next);
  if (next !== "FAST") setApiSecret("");
}}

              className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="NATV">NaTV</option>
                <option value="FAST">Fast</option>

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

          <div className="space-y-3">
  <div>
    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
      Token / Chave API
    </label>
    <input
      value={apiToken}
      onChange={(e) => setApiToken(e.target.value)}
      placeholder={provider === "NATV" ? "Bearer token (sem 'Bearer ')" : "Token do Fast"}
      className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
      disabled={loadingEdit}
    />
  </div>

  {provider === "FAST" && (
    <div>
      <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
        Secret Key
      </label>
      <input
        value={apiSecret}
        onChange={(e) => setApiSecret(e.target.value)}
        placeholder="Secret Key do Fast"
        className="w-full h-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
        disabled={loadingEdit}
      />
      <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1">
        Obrigatório para autenticação do Fast.
      </p>
    </div>
  )}

  <p className="text-[11px] text-slate-500 dark:text-white/40">
    {loadingEdit ? "Carregando dados da integração..." : "Esse valor fica visível para facilitar manutenção."}
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
