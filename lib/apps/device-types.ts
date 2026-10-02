// lib/apps/device-types.ts
// Fonte única de apps.device_types/technology — antes só existia em
// app/admin/gerenciador/aplicativo/page.tsx; agora também usado no portal
// (Bloco 3, sub-aba "Novo dispositivo").

export type Technology = "IPTV" | "P2P";

// ✅ 02/10/2026 (pedido do Márcio): Samsung e LG separados (o antigo
// SAMSUNG_LG virou os dois — docs/sql/app_device_types_e_split_samsung_lg.sql)
// e nomes com o sistema de cada um. Ordem = ordem de exibição.
export type DeviceType =
  | "SAMSUNG"
  | "LG"
  | "ROKU"
  | "ANDROID_TV"
  | "IOS"
  | "ANDROID_PHONE"
  | "COMPUTADOR"
  | "FIRE_TV"
  | "XBOX";

export const ALL_DEVICE_TYPES: DeviceType[] = [
  "SAMSUNG",
  "LG",
  "ROKU",
  "ANDROID_TV",
  "IOS",
  "ANDROID_PHONE",
  "COMPUTADOR",
  "FIRE_TV",
  "XBOX",
];

// ✅ 06/09/2026, pedido do Márcio: "Android / TV Box" misturava celular e TV
// Box num checkbox só — virou 2 tipos independentes (ANDROID_PHONE ficou com
// a chave antiga, só renomeado; ANDROID_TV é novo). Migration de dados em
// docs/sql/apps_device_types_android_split.sql.
export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  SAMSUNG: "Samsung (Tizen)",
  LG: "LG (WebOS)",
  ROKU: "Roku",
  ANDROID_TV: "Google TV (Android)",
  IOS: "iPhone (iOS)",
  ANDROID_PHONE: "Android (Celulares em geral)",
  COMPUTADOR: "Computador (Windows)",
  FIRE_TV: "Fire TV (Vega OS)",
  XBOX: "Xbox",
};

// Chaves antigas que ainda podem estar em apps.device_types mas não valem
// mais (o banco mantém até a limpeza pós-deploy). Nunca aparecem como opção.
export const LEGACY_DEVICE_KEYS = new Set(["SAMSUNG_LG"]);

// ✅ 02/10/2026 (pedido do Márcio): aparelhos novos cadastrados à mão no
// modal (ex: "PS5", "Mac", outra marca de TV) — salvos em apps.device_types
// pelo próprio nome, ao lado das chaves fixas acima (coluna é text[] sem
// restrição). Rótulo de qualquer valor: o fixo se for chave conhecida,
// senão o próprio texto.
export function deviceLabel(key: string): string {
  if (key === "SAMSUNG_LG") return "Samsung / LG";
  return (DEVICE_TYPE_LABELS as Record<string, string>)[key] ?? key;
}

export function isBuiltInDevice(key: string): key is DeviceType {
  return (ALL_DEVICE_TYPES as string[]).includes(key);
}

/** Aparelho cadastrado à mão (não é fixo nem chave antiga). */
export function isCustomDevice(key: string): boolean {
  return !!key && !isBuiltInDevice(key) && !LEGACY_DEVICE_KEYS.has(key);
}

/** Tira chaves antigas de uma lista de aparelhos. */
export function withoutLegacyDevices(list: string[] | null | undefined): string[] {
  return (list || []).filter((d) => !LEGACY_DEVICE_KEYS.has(d));
}
