// lib/apps/field-types.ts
// Fonte única dos tipos de campo do catálogo de apps (apps.fields_config) —
// antes duplicado em app/admin/gerenciador/aplicativo/page.tsx,
// app/admin/cliente/novo_cliente.tsx e app/api/client-portal/apps/list/route.ts.

export type AppFieldType =
  | "date"
  | "mac"
  | "device_key"
  | "email"
  | "password"
  | "url"
  | "obs";

export const ALL_FIELD_TYPES: AppFieldType[] = [
  "date",
  "mac",
  "device_key",
  "email",
  "password",
  "url",
  "obs",
];

export const APP_FIELD_LABELS: Record<AppFieldType, string> = {
  date: "Vencimento",
  mac: "Device ID (MAC)",
  device_key: "Device Key",
  email: "E-mail",
  password: "Senha",
  url: "URL",
  // ✅ "Ambiente" em vez de "Obs" (25/07/2026, pedido do Márcio) — fonte
  // única, então isso já reflete no admin (novo_cliente.tsx e no
  // construtor de campos do app manager) e no portal (que antes só
  // renomeava isso localmente pra "Ambiente" nas rotas do Bloco 3).
  obs: "Ambiente",
};

export const FIELD_ICONS: Record<AppFieldType, string> = {
  date: "📅",
  mac: "🔌",
  device_key: "🔑",
  email: "✉️",
  password: "🔒",
  url: "🔗",
  obs: "📝",
};

// Campos que o cliente nunca deve ver nem editar pelo portal. Vazio de
// propósito (pedido do Marcio, 25/07/2026): "password" aqui é o
// usuário/senha que o PRÓPRIO cliente precisa digitar em players que pedem
// login manual (IPTV Smarters, XCIPTV etc.) — sem mostrar, o cliente não
// consegue configurar o app sozinho. Diferente do link M3U (removido do
// portal): aquilo era uma URL pronta pra compartilhar/vazar; isso aqui é
// uma credencial que o cliente já é dono e precisa ler pra digitar em algum
// lugar. Segredos de verdade (PIN de integração do parceiro,
// app_integrations.pin) nunca passam por client_apps.field_values — moram
// numa tabela separada, nunca alcançam essas rotas.
export const HIDDEN_CLIENT_FIELD_TYPES: AppFieldType[] = [];

// Tipos de campo que representam credencial/identificador que o cliente
// pode ter digitado errado (ao contrário de "date"/"obs", que não entram
// numa checagem de login no painel do parceiro).
const CREDENTIAL_FIELD_TYPES: AppFieldType[] = ["mac", "device_key", "email", "password"];

// ✅ Pedido do Márcio, 05/08/2026: quando "Configurar"/"Verificar validade"
// falha no painel do parceiro (ex: MAC ou Device Key errados), o cliente no
// portal só via uma mensagem genérica sem dizer qual campo checar. Isso
// resolve os nomes REAIS (label customizado do app, se tiver — ver
// APP_FIELD_LABELS acima) dos campos de credencial desse app, pra montar
// uma mensagem tipo "confira Device ID (MAC), Device Key". Nunca usa o
// texto cru que o parceiro devolveu (em inglês, formato instável por
// parceiro) — só os nomes dos campos que o PRÓPRIO catálogo já conhece.
export function describeCredentialFields(fieldsConfig: unknown): string {
  const config = Array.isArray(fieldsConfig) ? fieldsConfig : [];
  const labels = config
    .filter((f: any) => f && CREDENTIAL_FIELD_TYPES.includes(f.type as AppFieldType))
    .map((f: any) => String(f.label || "").trim() || APP_FIELD_LABELS[f.type as AppFieldType] || "");
  return [...new Set(labels.filter(Boolean))].join(", ");
}

// MAC: mantém formatação XX:XX:XX:XX:XX:XX, aceita o alfabeto inteiro,
// mas guarda só 12 hex (6 bytes) — mesma lógica usada no admin.
export function normalizeMacInput(raw: string) {
  const s = String(raw ?? "").toUpperCase();
  const hex = s.replace(/[^0-9A-Z]/g, "");
  const trimmed = hex.slice(0, 12);
  const pairs = trimmed.match(/.{1,2}/g) || [];
  return pairs.join(":");
}
