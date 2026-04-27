"use client";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// ─── TYPES ────────────────────────────────────────────────────────────────────

// ✅ Atualizado: Separados os fallbacks internacionais
type GatewayType = "mercadopago" | "stripe" | "pix_manual" | "transfer_manual_eur" | "transfer_manual_usd";

interface PaymentGateway {
  id: string;
  tenant_id: string;
  name: string;
  type: GatewayType;
  currency: string[];
  priority: number;
  is_active: boolean;
  is_online: boolean;
  is_manual_fallback: boolean;
  config: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface GatewayMeta {
  type: GatewayType;
  label: string;
  description: string;
  currencies: string[];
  is_online: boolean;
  icon: string;
  color: string;
  fields: FieldDef[];
}

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "textarea";
  placeholder?: string;
  options?: { value: string; label: string }[];
  hint?: string;
  required?: boolean;
}

// ─── GATEWAY METADATA ─────────────────────────────────────────────────────────

const GATEWAY_META: GatewayMeta[] = [
  {
    type: "mercadopago",
    label: "Mercado Pago",
    description: "PIX automático via API. Gateway principal para BRL.",
    currencies: ["BRL"],
    is_online: true,
    icon: "💳",
    color: "from-blue-500 to-cyan-500",
    fields: [
      {
        key: "access_token",
        label: "Access Token",
        type: "password",
        placeholder: "APP_USR-...",
        hint: "Encontre em: Mercado Pago → Credenciais → Credenciais de produção",
        required: true,
      },
      {
        key: "webhook_secret",
        label: "Webhook Secret",
        type: "password",
        placeholder: "Chave secreta para validar webhooks",
        hint: "Opcional — adicione uma chave aleatória para maior segurança",
      },
    ],
  },
  
  
 {
    type: "stripe",
    label: "Stripe",
    description: "Cartão de crédito/débito internacional via API.",
    currencies: ["EUR", "USD"],
    is_online: true,
    icon: "💳",
    color: "from-indigo-500 to-violet-500",
    fields: [
      {
        key: "publishable_key",
        label: "Chave Publicável",
        type: "text",
        placeholder: "pk_test_... ou pk_live_...",
        hint: "Stripe Dashboard → Desenvolvedores → Chaves de API → Chave publicável",
        required: true,
      },
      {
        key: "secret_key",
        label: "Chave Secreta",
        type: "password",
        placeholder: "sk_test_... ou sk_live_...",
        hint: "Stripe Dashboard → Desenvolvedores → Chaves de API → Chave secreta",
        required: true,
      },
{
        key: "webhook_secret",
        label: "Webhook Secret",
        type: "password",
        placeholder: "whsec_...",
        hint: "Gerado ao cadastrar o endpoint do webhook no Stripe Dashboard",
        required: false,
      },
      {
        key: "beneficiary_name",
        label: "Nome do Favorecido",
        type: "text",
        placeholder: "Ex: João Silva",
        hint: "Exibido ao cliente no checkout para gerar confiança",
        required: false,
      },
      {
        key: "institution",
        label: "Instituição",
        type: "text",
        placeholder: "Ex: Stripe Payments",
        hint: "Nome da instituição financeira exibido ao cliente",
        required: false,
      },
    ],
  },
  {
    type: "pix_manual",
    label: "PIX Manual",
    description: "Chave PIX direta.",
    currencies: ["BRL"],
    is_online: false,
    icon: "📱",
    color: "from-violet-500 to-purple-500",
    fields: [
      {
        key: "beneficiary_name",
        label: "Nome do Favorecido",
        type: "text",
        placeholder: "Ex: João Silva",
        required: true,
      },
      {
        key: "institution",
        label: "Instituição (Banco)",
        type: "text",
        placeholder: "Ex: Nubank, Mercado Pago...",
        required: true,
      },
      {
        key: "pix_key_type",
        label: "Tipo da Chave",
        type: "select",
        options: [
          { value: "CPF", label: "CPF" },
          { value: "CNPJ", label: "CNPJ" },
          { value: "E-mail", label: "E-mail" },
          { value: "Telefone", label: "Telefone" },
          { value: "Aleatória", label: "Chave Aleatória" },
        ],
        required: true,
      },
      {
        key: "pix_key",
        label: "Chave PIX",
        type: "text",
        placeholder: "Digite a chave...",
        required: true,
      }
    ],
  },
  {
    type: "transfer_manual_eur",
    label: "Transferência Internacional (EUR)",
    description: "Dados bancários para recebimento em Euros.",
    currencies: ["EUR"],
    is_online: false,
    icon: "💶",
    color: "from-blue-600 to-indigo-600",
    fields: [
      {
        key: "beneficiary_name",
        label: "Nome do Favorecido",
        type: "text",
        placeholder: "Ex: João Silva",
        required: true,
      },
{
        key: "bank_name",
        label: "Nome do Banco",
        type: "text",
        placeholder: "Ex: Revolut, N26, Bunq...",
        required: true,
      },
      {
        key: "iban",
        label: "IBAN",
        type: "text",
        placeholder: "Ex: BE04 9056 6529 6331",
        required: true,
      },
      {
        key: "swift_bic",
        label: "Swift/BIC",
        type: "text",
        placeholder: "Ex: TRWIBEB1XXX",
        required: true,
      },
{
        key: "bank_address",
        label: "Endereço do Banco (Opcional)",
        type: "textarea",
        placeholder: "Ex: Rue du Trône 100, 3rd floor, Brussels...",
        required: false,
      }
    ],
  },
  
{
    type: "transfer_manual_usd",
    label: "Transferência Internacional (USD)",
    description: "Dados bancários para recebimento em Dólares.",
    currencies: ["USD"],
    is_online: false,
    icon: "💵",
    color: "from-blue-600 to-indigo-600",
    fields: [
      {
        key: "beneficiary_name",
        label: "Nome",
        type: "text",
        placeholder: "Ex: João Silva",
        required: true,
      },
{
        key: "bank_name",
        label: "Nome do Banco",
        type: "text",
        placeholder: "Ex: Revolut, Mercury, Nomad...",
        required: true,
      },
      {
        key: "account_number",
        label: "Número da conta",
        type: "text",
        placeholder: "Ex: 832905626259166",
        required: true,
      },
{
        key: "account_type",
        label: "Tipo da conta (Opcional)",
        type: "text",
        placeholder: "Ex: Checking, Savings...",
        required: false,
      },
      {
        key: "routing_number",
        label: "Routing number (Opcional)",
        type: "text",
        placeholder: "Ex: 084009519",
        required: false,
      },
      {
        key: "swift_bic",
        label: "Swift/BIC",
        type: "text",
        placeholder: "Ex: TRWIUS35XXX",
        required: true,
      },
{
        key: "bank_address",
        label: "Endereço do Banco (Opcional)",
        type: "textarea",
        placeholder: "Ex: 108 W 13th St, Wilmington, DE...",
        required: false,
      }
    ],
  },
];

const PRIORITY_LABELS: Record<number, string> = {
  1: "Principal",
  2: "Secundário",
};

// ─── HELP CONTENT ─────────────────────────────────────────────────────────────

const GATEWAY_HELP: Record<string, {
  title: string;
  link: string;
  linkLabel: string;
  steps: string[];
  warnings?: string[];
}> = {
  mercadopago: {
    title: "Como configurar o Mercado Pago",
    link: "https://www.mercadopago.com.br/developers/pt/docs",
    linkLabel: "Acessar documentação do Mercado Pago →",
    steps: [
      "Acesse https://mercadopago.com.br e crie ou acesse sua conta (PF ou PJ)",
      "Acesse o painel de desenvolvedores em https://mercadopago.com.br/developers/pt/docs",
      "No menu lateral esquerdo, clique em Credenciais",
      "Selecione sua aplicação existente ou clique em + Nova aplicação para criar uma",
      "Dentro da aplicação, clique na aba Produção (não use as credenciais de teste)",
      "Copie o Access Token — começa com APP_USR-... e é uma string longa",
      "Cole o Access Token no campo correspondente aqui no UniGestor em Pagamentos → Mercado Pago",
      "Para o Webhook: no menu lateral, clique em Webhooks → Configurar notificações",
      "Em URL de produção, cole: https://unigestor.net.br/api/webhooks/mercadopago",
      "Marque o evento Pagamentos (payment) na lista de eventos e clique em Salvar",
      "Recomendado: configure também uma Chave Secreta no campo Webhook Secret do UniGestor para maior segurança",
    ],
    warnings: [
      "⚠️ Use sempre as credenciais de Produção — as credenciais de teste não processam pagamentos reais",
      "⚠️ O Access Token é sensível — nunca compartilhe com ninguém",
    ],
  },
  
  stripe: {
    title: "Como configurar o Stripe",
    link: "https://stripe.com",
    linkLabel: "Criar conta no Stripe →",
    steps: [
      "Acesse https://stripe.com e crie sua conta empresarial — clique em 'Start now'",
      "Preencha nome, e-mail e senha. Em seguida complete o cadastro com dados do CNPJ (MEI é aceito)",
      "Finalize a ativação da conta: preencha todos os dados de KYC (endereço, dados bancários PJ) em https://dashboard.stripe.com/settings/account — sem isso as chaves live não funcionam",
      "Acesse https://dashboard.stripe.com/apikeys para obter suas chaves",
      "Copie a Chave publicável (começa com pk_live_...) e a Chave secreta (começa com sk_live_...)",
      "Cole ambas nos campos correspondentes aqui no UniGestor em Pagamentos → Editar Stripe",
      "Para o Webhook: acesse https://dashboard.stripe.com/webhooks e clique em + Adicionar destino",
      "Cole a URL: https://unigestor.net.br/api/webhooks/stripe",
      "Em 'Selecionar eventos', busque e marque: payment_intent.succeeded — depois clique em Criar",
      "Após criar, clique no webhook criado e copie o Segredo da assinatura (whsec_...) — cole no campo Webhook Secret no UniGestor",
      "Para Apple Pay / Google Pay: acesse https://dashboard.stripe.com/settings/payment_method_domains e adicione seu domínio",
    ],
    warnings: [
      "⚠️ Obrigatório CNPJ para conta de produção (MEI é aceito)",
      "⚠️ Use pk_live_ e sk_live_ — as chaves pk_test_ são apenas para testes e não processam pagamentos reais",
      "⚠️ Chaves de teste e produção são diferentes — não misture os ambientes",
      "⚠️ Sem completar o KYC da conta, os pagamentos serão bloqueados pelo Stripe",
    ],
  },
};

function renderStepWithLinks(text: string) {
  const urlRegex = /https?:\/\/[^\s,)]+/g;
  const parts: (string | React.ReactElement)[] = [];
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    const href = url.startsWith("http") ? url : `https://${url}`;
    parts.push(
      <a
        key={match.index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-600 dark:text-emerald-400 font-medium underline underline-offset-2 hover:text-emerald-700 break-all"
      >
        {url}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function HelpModal({ type, onClose }: { type: string; onClose: () => void }) {
  const help = GATEWAY_HELP[type];
  if (!help) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 rounded-t-xl flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800 dark:text-white">📖 {help.title}</h2>
            <a
              href={help.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-600 dark:text-emerald-400 font-bold hover:underline mt-0.5 inline-block"
            >
              {help.linkLabel}
            </a>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
          >
            <IconX />
          </button>
        </div>

        {/* Steps */}
        <div className="p-5 overflow-y-auto space-y-4">
          <ol className="space-y-3">
            {help.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="text-sm text-slate-700 dark:text-white/80 leading-relaxed">
                  {renderStepWithLinks(step)}
                </span>
              </li>
            ))}
          </ol>

          {help.warnings && help.warnings.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-white/10">
              {help.warnings.map((w, i) => (
                <p key={i} className="text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-3 py-2">
                  {w}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 rounded-b-xl">
          <button
            onClick={onClose}
            className="w-full h-9 rounded-lg bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-white font-bold text-sm hover:bg-slate-300 dark:hover:bg-white/20 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── UI (padrão Admin) ────────────────────────────────────────────────────────
function Label({ children }: { children: ReactNode }) {
  return (
    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
      {children}
    </label>
  );
}

function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full px-3 py-2.5 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors resize-none ${className}`}
    />
  );
}
// ─── MODAL ────────────────────────────────────────────────────────────────────

function GatewayModal({
  gateway,
  onClose,
  onSave,
  addToast,
}: {
  gateway: PaymentGateway | null;
  onClose: () => void;
  onSave: () => void;
  addToast: (type: "success" | "error", title: string, message?: string) => void;
}) {
  const isEdit = !!gateway;

  const [selectedType, setSelectedType] = useState<GatewayType | null>(gateway?.type ?? null);
  const [form, setForm] = useState<Record<string, string>>(gateway?.config ?? {});
  const [priority, setPriority] = useState(gateway?.priority ?? 1);
  const [isActive, setIsActive] = useState(gateway?.is_active ?? true);
  const [isManualFallback, setIsManualFallback] = useState(gateway?.is_manual_fallback ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const meta = GATEWAY_META.find((m) => m.type === selectedType);
  const [helpType, setHelpType] = useState<string | null>(null);

  async function handleSave() {
    if (!selectedType || !meta) return;

    const missingFields = meta.fields
      .filter((f) => f.required && !String(form[f.key] ?? "").trim())
      .map((f) => f.label);

    if (missingFields.length > 0) {
      setError(`Campos obrigatórios: ${missingFields.join(", ")}`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("Sessão inválida. Atualize a página.");

      const supabase = supabaseBrowser;

      const isFallbackType = selectedType === "pix_manual" || selectedType === "transfer_manual_eur" || selectedType === "transfer_manual_usd";
// stripe nunca é fallback — já coberto pois não entra nessa condição

      const basePayload = {
        name: meta.label,
        type: selectedType,
        currency: meta.currencies,
        priority,
        is_active: isActive,
        is_online: meta.is_online,
        is_manual_fallback: isFallbackType ? isManualFallback : false,
        config: form,
        updated_at: new Date().toISOString(),
      };

      if (isEdit && gateway) {
        const { error: err } = await supabase
          .from("payment_gateways")
          .update(basePayload)
          .eq("id", gateway.id)
          .eq("tenant_id", tenantId);

        if (err) throw err;
      } else {
        const { error: err } = await supabase
          .from("payment_gateways")
          .insert({
            tenant_id: tenantId,
            ...basePayload,
            created_at: new Date().toISOString(),
          });

        if (err) throw err;
      }

      onSave();
      addToast("success", isEdit ? "Integração atualizada" : "Integração criada", `${meta.label} configurado com sucesso.`);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER MODAL */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5 rounded-t-xl">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">
              {isEdit ? "Editar Integração" : "Nova Integração de Pagamento"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-white/60 mt-0.5">
              {isEdit ? "Atualize as configurações da integração" : "Configure uma nova forma de recebimento"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
          >
            <IconX />
          </button>
        </div>

        {/* BODY */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Seletor de tipo (só na criação) */}
          {!isEdit && (
            <div className="space-y-3">
              <Label>Tipo de Integração</Label>

              {helpType && (
                <HelpModal type={helpType} onClose={() => setHelpType(null)} />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {GATEWAY_META.map((m) => {
                  const selected = selectedType === m.type;
                  const hasHelp = !!GATEWAY_HELP[m.type];
                  return (
                    <div key={m.type} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedType(m.type);
                          setForm({});
                          setError(null);
                        }}
                        className={`w-full p-4 rounded-xl border text-left transition-all ${
                          selected
                            ? "border-emerald-500/40 bg-emerald-50/70 dark:bg-emerald-500/10"
                            : "border-slate-200 dark:border-white/10 bg-white dark:bg-[#161b22] hover:bg-slate-50 dark:hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-xl shrink-0">
                            {m.icon}
                          </div>
                          <div className="min-w-0 pr-6">
                            <div className="font-bold text-slate-800 dark:text-white text-sm">
                              {m.label}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-white/60 mt-0.5 leading-tight">
                              {m.description}
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {m.currencies.map((c) => (
                                <span
                                  key={c}
                                  className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/70 border border-slate-200 dark:border-white/10"
                                >
                                  {c}
                                </span>
                              ))}
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                  m.is_online
                                    ? "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20"
                                    : "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20"
                                }`}
                              >
                                {m.is_online ? "Online" : "Manual"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>

                      {/* Botão de ajuda */}
                      {hasHelp && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setHelpType(m.type);
                          }}
                          className="absolute top-3 right-3 w-6 h-6 rounded-full bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-white/50 hover:bg-blue-100 dark:hover:bg-blue-500/20 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center justify-center text-xs font-bold"
                          title="Como obter as credenciais"
                        >
                          ?
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Conteúdo do tipo selecionado */}
          {meta && (
            <>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 flex items-center justify-center text-xl">
                    {meta.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 dark:text-white">{meta.label}</div>
                    <div className="text-xs text-slate-500 dark:text-white/60 truncate">{meta.description}</div>
                  </div>

                  <div className="ml-auto flex gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        meta.is_online
                          ? "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20"
                          : "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20"
                      }`}
                    >
                      {meta.is_online ? "Online" : "Manual"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Fields */}
              <div className="space-y-4">
                {meta.fields.map((field) => (
                  <div key={field.key}>
                    <Label>
                      {field.label} {field.required && <span className="text-rose-500">*</span>}
                    </Label>

                    {field.type === "select" ? (
                      <Select
                        value={form[field.key] || ""}
                        onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      >
                        <option value="">Selecione...</option>
                        {field.options?.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </Select>
                    ) : field.type === "textarea" ? (
                      <Textarea
                        rows={3}
                        value={form[field.key] || ""}
                        onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                      />
                    ) : (
                      <div className="relative">
                        <Input
                          type={field.type === "password" && !showSecrets[field.key] ? "password" : "text"}
                          value={form[field.key] || ""}
                          onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                          placeholder={field.placeholder}
                          className={field.type === "password" ? "pr-10" : ""}
                        />
                        {field.type === "password" && (
                          <button
                            type="button"
                            onClick={() =>
                              setShowSecrets((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
                            }
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white text-xs"
                            title={showSecrets[field.key] ? "Ocultar" : "Mostrar"}
                          >
                            {showSecrets[field.key] ? "🙈" : "👁️"}
                          </button>
                        )}
                      </div>
                    )}

                    {field.hint && (
                      <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1">{field.hint}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Extras */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-white/10">
                <div>
                  <Label>Prioridade</Label>
                  <Select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                    <option value={1}>1 — Principal</option>
                    <option value={2}>2 — Fallback</option>
                  </Select>
                </div>

                <div>
                  <Label>Status</Label>
                  <button
                    type="button"
                    onClick={() => setIsActive(!isActive)}
                    className={`w-full h-10 px-3 rounded-lg border text-sm font-bold transition-colors ${
                      isActive
                        ? "border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 text-slate-600 dark:text-white/60"
                    }`}
                  >
                    {isActive ? "✅ Ativo" : "⭕ Inativo"}
                  </button>
                </div>
              </div>

              {/* Fallback Manual */}
              {(selectedType === "pix_manual" || selectedType === "transfer_manual_eur" || selectedType === "transfer_manual_usd") && (
                <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-violet-700 dark:text-violet-300">
                        Usar como Fallback
                      </p>
                      <p className="text-xs text-violet-600/80 dark:text-violet-300/70 mt-0.5">
                        Exibir ao cliente quando todos os gateways online falharem
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsManualFallback(!isManualFallback)}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        isManualFallback ? "bg-violet-600" : "bg-slate-300 dark:bg-white/20"
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          isManualFallback ? "left-7" : "left-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm">
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* FOOTER MODAL */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-end gap-2 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-sm font-bold transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !selectedType}
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {saving ? "Salvando..." : isEdit ? "Salvar Alterações" : "Criar Integração"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CARD DO GATEWAY ──────────────────────────────────────────────────────────

function GatewayCard({
  gateway,
  onEdit,
  onDelete,
  onToggle,
  isDeleting,
}: {
  gateway: PaymentGateway;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  isDeleting?: boolean;
}) {
  const meta = GATEWAY_META.find((m) => m.type === gateway.type);
  if (!meta) return null;

  const priorityLabel = PRIORITY_LABELS[gateway.priority] || `P${gateway.priority}`;

  return (
    <div
      className={`bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-sm overflow-hidden transition-opacity ${
        gateway.is_active ? "" : "opacity-70"
      }`}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 flex items-center justify-center text-xl shrink-0">
            {meta.icon}
          </div>

          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 dark:text-white text-sm truncate">
              {gateway.name}
            </h3>

            <div className="flex flex-wrap gap-1.5 mt-1">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-black/20 text-slate-600 dark:text-white/70 border border-slate-200 dark:border-white/10">
                {priorityLabel}
              </span>

              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                  gateway.is_online
                    ? "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20"
                    : "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20"
                }`}
              >
                {gateway.is_online ? "Automático" : "Manual"}
              </span>
            </div>
          </div>
        </div>

        {/* Toggle ativo/inativo */}
        <button
          onClick={onToggle}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            gateway.is_active ? "bg-emerald-600" : "bg-slate-300 dark:bg-white/20"
          }`}
          title={gateway.is_active ? "Desativar" : "Ativar"}
        >
          <span
            className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              gateway.is_active ? "left-6" : "left-1"
            }`}
          />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Moedas */}
        <div className="flex flex-wrap gap-1.5">
          {gateway.currency.map((c) => (
            <span
              key={c}
              className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/70 border border-slate-200 dark:border-white/10"
            >
              {c}
            </span>
          ))}
        </div>

        {/* Campos configurados (mascara secrets) */}
        <div className="space-y-1.5">
          {meta.fields.slice(0, 2).map((field) => {
            const val = gateway.config?.[field.key];
            if (!val) return null;

            const raw = String(val);
            const isSecret = field.type === "password";
            const masked = isSecret ? `${raw.slice(0, 6)}${"•".repeat(10)}` : raw;

            return (
              <div key={field.key} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-400 dark:text-white/40 font-medium truncate">
                  {field.label}:
                </span>
                <span className="text-slate-600 dark:text-white/70 font-mono truncate max-w-[55%]">
                  {masked}
                </span>
              </div>
            );
          })}
        </div>

        {/* Ações */}
        <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
          <button
            onClick={onEdit}
            className="flex-1 h-9 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 text-slate-700 dark:text-white/70 text-xs font-bold hover:bg-slate-100 dark:hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
          >
            <IconEdit />
            Editar
          </button>

          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="h-9 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300 text-xs font-bold hover:bg-rose-500/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            title="Excluir"
          >
            {isDeleting ? "..." : <IconTrash />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function PagamentosPage() {
  const [gateways, setGateways] = useState<PaymentGateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null); // ✅ Controle de Acesso
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGateway, setEditingGateway] = useState<PaymentGateway | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

    // --- TOAST + CONFIRM (padrão do admin) ---
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSeq = useRef(1);

  const removeToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const addToast = (type: "success" | "error", title: string, message?: string) => {
    const id = Date.now() * 1000 + (toastSeq.current++ % 1000);
    const durationMs = 5000;
    setToasts((prev) => [...prev, { id, type, title, message, durationMs }]);
    setTimeout(() => removeToast(id), durationMs);
  };

  const { confirm: confirmDialog, ConfirmUI } = useConfirm();

  const fetchGateways = useCallback(async () => {
    try {
      const tenantId = await getCurrentTenantId();
      
      if (tenantId) {
        // ✅ VERIFICAÇÃO DE ACESSO (MÓDULOS)
        const { data: tenantRow } = await supabaseBrowser
          .from("tenants")
          .select("active_modules")
          .eq("id", tenantId)
          .maybeSingle();

        const mods = tenantRow?.active_modules || [];
        const hasAuthorizedModule = mods.includes("iptv") || mods.includes("saas");

        if (!hasAuthorizedModule) {
          setHasAccess(false);
          setLoading(false); // Libera a tela para mostrar o bloqueio
          return; // 🛑 Interrompe totalmente o carregamento
        }
        
        setHasAccess(true);
      }

      if (!tenantId) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabaseBrowser
        .from("payment_gateways")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw error;
      setGateways((data as PaymentGateway[]) || []);
    } catch (err: any) {
      addToast("error", "Erro ao carregar gateways", err?.message ?? "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGateways();
  }, [fetchGateways]);

  async function handleToggle(gateway: PaymentGateway) {
    try {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) {
        addToast("error", "Tenant inválido", "Não foi possível identificar o tenant atual.");
        return;
      }

      const { error } = await supabaseBrowser
        .from("payment_gateways")
        .update({ is_active: !gateway.is_active, updated_at: new Date().toISOString() })
        .eq("id", gateway.id)
        .eq("tenant_id", tenantId);

      if (error) throw error;

      setGateways((prev) =>
        prev.map((g) => (g.id === gateway.id ? { ...g, is_active: !g.is_active } : g))
      );
    } catch (err: any) {
      addToast("error", "Erro ao atualizar status", err?.message ?? "Erro inesperado.");
    }
  }

  async function handleDelete(gateway: PaymentGateway) {
    const ok = await confirmDialog({
      tone: "rose",
      title: "Excluir integração de pagamento?",
      subtitle: `Você está prestes a excluir "${gateway.name}".`,
      details: ["Essa ação não pode ser desfeita."],
      confirmText: "Excluir",
      cancelText: "Voltar",
    });

    if (!ok) return;

    try {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) {
        addToast("error", "Tenant inválido", "Não foi possível identificar o tenant atual.");
        return;
      }

      setDeleting(gateway.id);

      const { error } = await supabaseBrowser
        .from("payment_gateways")
        .delete()
        .eq("id", gateway.id)
        .eq("tenant_id", tenantId);

      if (error) throw error;

      setGateways((prev) => prev.filter((g) => g.id !== gateway.id));
      addToast("success", "Removido", "Integração excluída com sucesso.");
    } catch (err: any) {
      addToast("error", "Erro ao excluir", err?.message ?? "Erro inesperado.");
    } finally {
      setDeleting(null);
    }
  }

  // Agrupar por moeda
  const brlGateways = gateways.filter((g) => g.currency.includes("BRL"));
  const intlGateways = gateways.filter(
    (g) => g.currency.includes("USD") || g.currency.includes("EUR") || g.currency.includes("INTL")
  );

  // ✅ PROTEÇÃO CONTRA VAZAMENTO (TELA PISCANDO)
  if (hasAccess === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-[#0f141a]">
        <div className="text-slate-400 dark:text-white/40 animate-pulse font-bold tracking-tight">Verificando permissões...</div>
      </div>
    );
  }

  // ✅ TELA DE BLOQUEIO PARA QUEM NÃO TEM ACESSO
  if (hasAccess === false) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center p-6 animate-in fade-in duration-500">
        <div className="w-20 h-20 bg-rose-50 dark:bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center mb-6">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight mb-2">
          Acesso Restrito
        </h1>
        <p className="text-slate-500 dark:text-white/60 max-w-md mx-auto">
          Você não tem autorização para acessar esta página. Entre em contato com o administrador da sua conta para mais informações.
        </p>
      </div>
    );
  }

    return (
  <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">
    
    {/* HEADER (padrão Clientes/Trials) */}
    <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
  <div className="min-w-0">
    <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate text-slate-800 dark:text-white">
      Pagamentos
    </h1>
  </div>

  <div className="flex items-center gap-2 justify-end shrink-0">
    <button
      onClick={() => {
        setEditingGateway(null);
        setModalOpen(true);
      }}
      className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
    >
      <span className="text-base leading-none">+</span>
      Nova Integração
    </button>
  </div>
</div>

    {/* CONTEÚDO */}
    <div className="px-3 sm:px-0 space-y-6 pt-3 sm:pt-4">

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : gateways.length === 0 ? (
          <div className="bg-white dark:bg-[#161b22] border border-dashed border-slate-300 dark:border-white/10 rounded-xl p-10 text-center mx-0">
            <div className="text-5xl mb-3">💳</div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">
              Nenhuma integração configurada
            </h3>
            <p className="text-slate-500 dark:text-white/60 text-sm mb-6">
              Configure ao menos um gateway para habilitar renovações na Área do Cliente.
            </p>
            <button
              onClick={() => {
                setEditingGateway(null);
                setModalOpen(true);
              }}
              className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 transition-all"
            >
              + Criar primeira integração
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* BRL */}
            {brlGateways.length > 0 && (
              <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible -mx-3 sm:mx-0">
                <div className="px-3 sm:px-5 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-800 dark:text-white">Gateways BRL</h2>
                    <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-2 py-0.5 rounded">
                      {brlGateways.length}
                    </span>
                  </div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-white/50">
                    BRL
                  </span>
                </div>

                <div className="p-3 sm:p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {brlGateways.map((g) => (
<GatewayCard
  key={g.id}
  gateway={g}
  isDeleting={deleting === g.id}
  onEdit={() => {
    setEditingGateway(g);
    setModalOpen(true);
  }}
  onDelete={() => handleDelete(g)}
  onToggle={() => handleToggle(g)}
/>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Internacionais */}
            {intlGateways.length > 0 && (
              <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible -mx-3 sm:mx-0">
                <div className="px-3 sm:px-5 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-800 dark:text-white">Gateways Internacionais</h2>
                    <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-2 py-0.5 rounded">
                      {intlGateways.length}
                    </span>
                  </div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-white/50">
                    USD/EUR
                  </span>
                </div>

                <div className="p-3 sm:p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {intlGateways.map((g) => (
<GatewayCard
  key={g.id}
  gateway={g}
  isDeleting={deleting === g.id}
  onEdit={() => {
    setEditingGateway(g);
    setModalOpen(true);
  }}
  onDelete={() => handleDelete(g)}
  onToggle={() => handleToggle(g)}
/>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* espaço fixo pra não cortar popups */}
            <div className="h-24 md:h-20" />
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <GatewayModal
          gateway={editingGateway}
          onClose={() => {
            setModalOpen(false);
            setEditingGateway(null);
          }}
          onSave={fetchGateways}
          addToast={addToast}
        />
      )}

      {/* Confirmação e Toasts */}
      {ConfirmUI}
      <ToastNotifications toasts={toasts} removeToast={removeToast} />
    </div>
  );
}

function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>; }
function IconEdit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>; }
function IconTrash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>; }
