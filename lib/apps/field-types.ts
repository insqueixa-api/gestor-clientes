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
  obs: "Obs",
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

// MAC: mantém formatação XX:XX:XX:XX:XX:XX, aceita o alfabeto inteiro,
// mas guarda só 12 hex (6 bytes) — mesma lógica usada no admin.
export function normalizeMacInput(raw: string) {
  const s = String(raw ?? "").toUpperCase();
  const hex = s.replace(/[^0-9A-Z]/g, "");
  const trimmed = hex.slice(0, 12);
  const pairs = trimmed.match(/.{1,2}/g) || [];
  return pairs.join(":");
}
