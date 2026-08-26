"use client";
// app/admin/settings/api-server/api_integracao_modal.tsx
//
// "Parceiros" — terceira categoria de integração (24/08/2026, pedido do
// Márcio), separada de "aplicativo" (app_integrations, robô que configura
// app no dispositivo do cliente) e "servidor" (server_integrations, painel
// IPTV). Primeiro caso: Appativa (appativa.store) — parceiro de
// pagamento/licença de app, autentica por API key própria. A chave fica
// SEMPRE no banco (nunca em env var) porque pode rotacionar a qualquer
// momento do lado do parceiro — o código de integração (ainda não
// implementado) sempre busca a chave atual aqui na hora de usar.
import { Loader2 } from "lucide-react";

import { useEffect, useState } from "react";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";

function normalizeApiUrl(url: string) {
  if (!url) return "";
  let s = url.trim().replace(/\/+$/, "");
  if (s.toLowerCase().startsWith("javascript:")) return "";
  if (s && !s.startsWith("http")) {
    s = "https://" + s;
  }
  return s;
}

export type ApiIntegration = {
  id: string;
  tenant_id: string;
  provider: string;
  label: string;
  login_email: string | null;
  login_password: string | null;
  api_key: string | null;
  api_url: string | null;
  // ✅ Preço em R$ de 1 crédito do parceiro (achado 24/08/2026: o "valor"
  // que a API deles devolve por app é consumo de crédito, não preço em
  // R$ — esse campo converte um no outro). Editável manualmente porque
  // pode mudar conforme a faixa de compra de créditos.
  credit_unit_price: number | null;
  is_active: boolean;
  created_at: string;
};

export default function ApiIntegracaoModal({
  integration,
  onCloseAction,
  onSuccessAction,
  onErrorAction,
}: {
  integration?: ApiIntegration | null;
  onCloseAction: () => void;
  onSuccessAction: () => void;
  onErrorAction: (msg: string) => void;
}) {
  const tenantId = useTenantId();
  const isEdit = !!integration?.id;

  const [provider, setProvider] = useState(integration?.provider ?? "APPATIVA");
  const [label, setLabel] = useState(integration?.label ?? "");
  const [loginEmail, setLoginEmail] = useState(integration?.login_email ?? "");
  const [loginPassword, setLoginPassword] = useState(
    integration?.login_password ?? "",
  );
  const [apiKey, setApiKey] = useState(integration?.api_key ?? "");
  const [apiUrl, setApiUrl] = useState(integration?.api_url ?? "");
  const [creditUnitPrice, setCreditUnitPrice] = useState(
    integration?.credit_unit_price != null
      ? String(integration.credit_unit_price)
      : "",
  );
  const [isActive, setIsActive] = useState(integration?.is_active ?? true);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (integration) {
      setProvider(integration.provider ?? "APPATIVA");
      setLabel(integration.label ?? "");
      setLoginEmail(integration.login_email ?? "");
      setLoginPassword(integration.login_password ?? "");
      setApiKey(integration.api_key ?? "");
      setApiUrl(integration.api_url ?? "");
      // ✅ Sempre carrega o último preço salvo (pedido do Márcio) — só cai
      // pro placeholder vazio se a integração nunca teve um valor definido.
      setCreditUnitPrice(
        integration.credit_unit_price != null
          ? String(integration.credit_unit_price)
          : "",
      );
      setIsActive(integration.is_active ?? true);
    }
  }, [integration]);

  // ✅ Duplecast (achado 26/08/2026, pedido do Márcio: migrar da Appativa
  // pra cá — mais barato) não autentica por chave de API, é login de
  // revenda (e-mail/senha) resolvido pela VM (whatsapp-service, FlareSolverr
  // pro Cloudflare) — ver app/api/integrations/duplecast/sync-credits.
  const isDuplecast = provider === "DUPLECAST";
  const canSave = isDuplecast
    ? !!(label.trim() && loginEmail.trim() && loginPassword.trim())
    : !!(label.trim() && apiKey.trim());

  async function handleSave() {
    if (!canSave) return;
    try {
      setSaving(true);
      if (!tenantId) throw new Error("Tenant não encontrado.");

      const parsedCreditUnitPrice = creditUnitPrice.trim()
        ? Number(creditUnitPrice.replace(",", "."))
        : null;

      const payload = {
        tenant_id: tenantId,
        provider,
        label: label.trim(),
        login_email: loginEmail.trim() || null,
        login_password: loginPassword.trim() || null,
        api_key: apiKey.trim() || null,
        api_url: normalizeApiUrl(apiUrl) || null,
        credit_unit_price:
          parsedCreditUnitPrice != null && Number.isFinite(parsedCreditUnitPrice)
            ? parsedCreditUnitPrice
            : null,
        is_active: isActive,
      };

      if (isEdit) {
        const { error } = await supabaseBrowser
          .from("api_integrations")
          .update(payload)
          .eq("id", integration!.id)
          .eq("tenant_id", tenantId);
        if (error) throw error;
      } else {
        const { error } = await supabaseBrowser
          .from("api_integrations")
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
    <Modal onClose={onCloseAction} maxWidth="max-w-2xl">
      <ModalHeader onClose={onCloseAction}>
        <h2 className="text-lg font-medium text-foreground tracking-tight">
          {isEdit ? "Editar Parceiro" : "Novo Parceiro"}
        </h2>
        <p className="text-xs text-foreground/70 mt-0.5">
          Login e chave de API de parceiros externos (não são aplicativo nem
          servidor) — a chave fica guardada aqui, nunca em variável de
          ambiente, porque pode rotacionar a qualquer momento.
        </p>
      </ModalHeader>

      <ModalBody className="p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
              Parceiro
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full h-11 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-emerald-500/50 focus:bg-card transition-colors cursor-pointer"
            >
              <option value="APPATIVA">Appativa (Ative App Mídias)</option>
              <option value="DUPLECAST">Duplecast (login de revenda)</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
              Nome de identificação
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder='Ex: "Appativa"'
              className="w-full h-11 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-emerald-500/50 focus:bg-card transition-colors"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
              Link do painel
            </label>
            <input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="Ex: https://appativa.store"
              type="url"
              className="w-full h-11 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-emerald-500/50 focus:bg-card transition-colors font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
              E-mail / Usuário
            </label>
            <input
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="seuemail@exemplo.com"
              type="text"
              autoCapitalize="none"
              className="w-full h-11 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-emerald-500/50 focus:bg-card transition-colors"
            />
          </div>

          <div>
            <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
              Senha
            </label>
            <input
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Senha de acesso"
              type="password"
              className="w-full h-11 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-emerald-500/50 focus:bg-card transition-colors"
            />
          </div>

          {!isDuplecast && (
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-medium text-emerald-500 mb-1.5 uppercase tracking-wider">
                Chave de API
              </label>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Ex: ak_live_..."
                type="password"
                className="w-full h-11 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 text-sm text-foreground outline-none focus:border-emerald-500 focus:bg-card transition-colors font-mono text-xs"
              />
              <p className="text-[10px] text-foreground/70 mt-1.5 ml-1">
                Se o parceiro trocar a chave, atualize aqui — o código sempre
                usa a que estiver salva no momento.
              </p>
            </div>
          )}
          {isDuplecast && (
            <div className="sm:col-span-2 p-3 rounded-xl border border-sky-500/30 bg-sky-500/10 text-xs text-sky-700 dark:text-sky-400">
              ℹ️ Duplecast não usa chave de API — o e-mail/senha de revenda
              acima é usado pra logar via VM (que resolve o Cloudflare deles).
            </div>
          )}

          <div className="sm:col-span-2">
            <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
              Valor do crédito (R$)
            </label>
            <input
              value={creditUnitPrice}
              onChange={(e) => setCreditUnitPrice(e.target.value)}
              placeholder="Ex: 12,10"
              inputMode="decimal"
              className="w-full h-11 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-emerald-500/50 focus:bg-card transition-colors"
            />
            <p className="text-[10px] text-foreground/70 mt-1.5 ml-1">
              O que a API deles chama de "valor" por aplicativo é consumo de
              crédito, não preço em R$ — esse campo converte um no outro
              (créditos × este valor). Pode mudar conforme a faixa de compra;
              atualize aqui quando comprar créditos a um preço diferente.
            </p>
          </div>

          <div className="sm:col-span-2 mt-2">
            <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-transparent">
              <div>
                <div className="text-sm font-medium text-foreground/90">
                  Integração Ativa
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Se desativar, não será acionada.
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
          {saving ? "Salvando..." : "Salvar Parceiro"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
