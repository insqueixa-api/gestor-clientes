// app/admin/gerenciador/pagamento/shared.tsx
// Tipos, metadados de gateways e helpers usados tanto pela página principal
// (page.tsx: GatewayCard/PagamentosPage) quanto pelos modais extraídos pra
// next/dynamic (15/08/2026): GatewayModal, HelpModal.
import { X } from "lucide-react";

// ─── TYPES ────────────────────────────────────────────────────────────────────

// ✅ Atualizado: Separados os fallbacks internacionais
export type GatewayType =
  | "mercadopago"
  | "stripe"
  | "fastpay"
  | "fastflow"
  | "depix"
  | "pix_manual"
  | "transfer_manual_eur"
  | "transfer_manual_usd";

export interface PaymentGateway {
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

export interface GatewayMeta {
  type: GatewayType;
  label: string;
  description: string;
  currencies: string[];
  is_online: boolean;
  icon: string;
  color: string;
  fields: FieldDef[];
}

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "textarea";
  placeholder?: string;
  options?: { value: string; label: string }[];
  hint?: string;
  required?: boolean;
}

// ─── GATEWAY METADATA ─────────────────────────────────────────────────────────

export const GATEWAY_META: GatewayMeta[] = [
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
  // ✅ 04/09/2026, pedido do Márcio: FastDePix oferece 3 provedores de
  // liquidação PIX pela MESMA API REST (https://fastdepix.space/api/v1/) —
  // o provedor usado depende do tipo da chave gerada no painel deles
  // (campo "Tipo de integração": fastpay, fastflow ou depix), não de um
  // endpoint diferente. Por isso viram 3 GatewayType separados aqui — cada
  // um com sua própria chave — mas toda a lógica de chamada da API é
  // compartilhada (ver lib/fastdepix.ts).
  {
    type: "fastpay",
    label: "FastPay",
    description: "PIX custodial via FastDePix — sem CPF até R$3.000, com CPF até R$5.000/TX.",
    currencies: ["BRL"],
    is_online: true,
    icon: "⚡",
    color: "from-amber-500 to-orange-500",
    fields: [
      {
        key: "api_key",
        label: "Chave API",
        type: "password",
        placeholder: "fdpx_...",
        hint: "FastDePix → Dashboard → Chaves API → Criar Nova Chave API (Tipo de integração: FastPay)",
        required: true,
      },
    ],
  },
  {
    type: "fastflow",
    label: "FastFlow",
    description: "PIX custodial via FastDePix — com ou sem CPF até R$5.000.",
    currencies: ["BRL"],
    is_online: true,
    icon: "🌊",
    color: "from-teal-500 to-cyan-500",
    fields: [
      {
        key: "api_key",
        label: "Chave API",
        type: "password",
        placeholder: "fdpx_...",
        hint: "FastDePix → Dashboard → Chaves API → Criar Nova Chave API (Tipo de integração: FastFlow)",
        required: true,
      },
    ],
  },
  {
    type: "depix",
    label: "DePix",
    description: "Liquidação via DePix / Liquid Network — exige CPF/CNPJ do pagador em toda cobrança.",
    currencies: ["BRL"],
    is_online: true,
    icon: "🔗",
    color: "from-slate-500 to-zinc-600",
    fields: [
      {
        key: "api_key",
        label: "Chave API",
        type: "password",
        placeholder: "fdpx_...",
        hint: "FastDePix → Dashboard → Chaves API → Criar Nova Chave API (Tipo de integração: DePix)",
        required: true,
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
      },
    ],
  },
  {
    type: "transfer_manual_eur",
    label: "Transferência Bancária (EUR)",
    description:
      "Dados bancários para recebimento em Euros (Local e Internacional).",
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
      // --- SEÇÃO: DADOS LOCAIS ---
      {
        key: "iban_local",
        label: "IBAN (Transferência Local)",
        type: "text",
        placeholder: "Ex: LT04 9056 6529 6331",
        hint: "Para transferências dentro da zona SEPA",
        required: false, // Pode ser que a pessoa só tenha internacional
      },
      {
        key: "bic_local",
        label: "BIC (Transferência Local)",
        type: "text",
        placeholder: "Ex: REVOLT21",
        required: false,
      },
      // --- SEÇÃO: DADOS INTERNACIONAIS ---
      {
        key: "account_number_intl",
        label: "Número da Conta (Internacional)",
        type: "text",
        placeholder: "Ex: 12345678",
        hint: "Para transferências SWIFT de fora da zona SEPA",
        required: false,
      },
      {
        key: "bic_intl",
        label: "SWIFT / BIC (Internacional)",
        type: "text",
        placeholder: "Ex: REVOLT21",
        required: false,
      },
      {
        key: "bank_address",
        label: "Endereço do Banco (Opcional)",
        type: "textarea",
        placeholder: "Ex: Rue du Trône 100, Brussels...",
        required: false,
      },
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
      },
    ],
  },
];

export const PRIORITY_LABELS: Record<number, string> = {
  1: "Principal",
  2: "Secundário",
};

// ✅ 05/09/2026, pedido do Márcio: com FastPay/FastFlow/DePix somados ao
// que já existia, dá pra ter 3-4+ gateways online na mesma moeda — o mapa
// fixo (só 1/2) não escalava. Rótulo por extenso até o 3º, depois "Nª
// opção" (ordinal em português trava feio a partir do 4º).
export function priorityLabel(p: number): string {
  if (p === 1) return "Principal";
  if (p === 2) return "Secundário";
  if (p === 3) return "Terciário";
  return `${p}ª opção`;
}

// Teto de opções oferecido no seletor de Prioridade do modal — generoso o
// bastante pra qualquer cenário realista sem virar uma lista infinita.
export const MAX_PRIORITY = 6;

// ─── HELP CONTENT ─────────────────────────────────────────────────────────────

export const GATEWAY_HELP: Record<
  string,
  {
    title: string;
    link: string;
    linkLabel: string;
    steps: string[];
    warnings?: string[];
  }
> = {
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
  fastpay: {
    title: "Como configurar o FastPay (FastDePix)",
    link: "https://fastdepix.space/api/docs.php",
    linkLabel: "Acessar documentação da API FastDePix →",
    steps: [
      "Acesse seu Dashboard de Parceiro em fastdepix.space",
      "Navegue até Gerenciar Chaves API",
      "Clique em Criar Nova Chave API",
      "Em Tipo de integração, selecione FastPay",
      "Copie a chave gerada (formato fdpx_...) — só aparece uma vez",
      "Cole a chave no campo Chave API aqui no UniGestor e clique em Salvar",
      "O UniGestor cadastra o webhook automaticamente ao salvar — não precisa fazer isso manualmente no painel FastDePix",
    ],
    warnings: [
      "⚠️ A chave API expira em 1 ano — renove antes do vencimento",
      "⚠️ Sem CPF/CNPJ do pagador: cobrança até R$3.000 (R$5.000 com CPF) — sem limite diário",
    ],
  },
  fastflow: {
    title: "Como configurar o FastFlow (FastDePix)",
    link: "https://fastdepix.space/api/docs.php",
    linkLabel: "Acessar documentação da API FastDePix →",
    steps: [
      "Acesse seu Dashboard de Parceiro em fastdepix.space",
      "Navegue até Gerenciar Chaves API",
      "Clique em Criar Nova Chave API",
      "Em Tipo de integração, selecione FastFlow",
      "Copie a chave gerada (formato fdpx_...) — só aparece uma vez",
      "Cole a chave no campo Chave API aqui no UniGestor e clique em Salvar",
      "O UniGestor cadastra o webhook automaticamente ao salvar — não precisa fazer isso manualmente no painel FastDePix",
    ],
    warnings: [
      "⚠️ A chave API expira em 1 ano — renove antes do vencimento",
      "⚠️ Com ou sem CPF: cobrança até R$5.000 por transação",
    ],
  },
  depix: {
    title: "Como configurar o DePix (FastDePix)",
    link: "https://fastdepix.space/api/docs.php",
    linkLabel: "Acessar documentação da API FastDePix →",
    steps: [
      "Acesse seu Dashboard de Parceiro em fastdepix.space",
      "Navegue até Gerenciar Chaves API",
      "Clique em Criar Nova Chave API",
      "Em Tipo de integração, selecione DePix",
      "Copie a chave gerada (formato fdpx_...) — só aparece uma vez",
      "Cole a chave no campo Chave API aqui no UniGestor e clique em Salvar",
      "O UniGestor cadastra o webhook automaticamente ao salvar — não precisa fazer isso manualmente no painel FastDePix",
    ],
    warnings: [
      "⚠️ A API DePix EXIGE CPF/CNPJ do pagador em toda cobrança — o Portal do Cliente ainda não coleta esse dado no checkout de renovação, então esse gateway fica configurado mas SEM gerar cobrança de verdade até essa etapa existir (ver docs/fiscal/nota-fiscal-reforma-tributaria-2027.md — o mesmo campo CPF/CNPJ do projeto de nota fiscal resolve isso)",
      "⚠️ Limite: R$10 a R$5.000/dia por CPF (1º depósito/24h: até R$500)",
    ],
  },
};

export function renderStepWithLinks(text: string) {
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
        className="text-emerald-500 font-medium underline underline-offset-2 hover:text-emerald-500 break-all"
      >
        {url}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export function IconX() {
  return <X className="w-4 h-4" />;
}
