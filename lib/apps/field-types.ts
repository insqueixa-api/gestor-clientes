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

// Campos que o cliente nunca deve ver nem editar pelo portal — só senha
// mesmo; "obs" é observação normal do app, o cliente pode ver e editar.
export const HIDDEN_CLIENT_FIELD_TYPES: AppFieldType[] = ["password"];

// MAC: mantém formatação XX:XX:XX:XX:XX:XX, aceita o alfabeto inteiro,
// mas guarda só 12 hex (6 bytes) — mesma lógica usada no admin.
export function normalizeMacInput(raw: string) {
  const s = String(raw ?? "").toUpperCase();
  const hex = s.replace(/[^0-9A-Z]/g, "");
  const trimmed = hex.slice(0, 12);
  const pairs = trimmed.match(/.{1,2}/g) || [];
  return pairs.join(":");
}
