// lib/apps/device-types.ts
// Fonte única de apps.device_types/technology — antes só existia em
// app/admin/gerenciador/aplicativo/page.tsx; agora também usado no portal
// (Bloco 3, sub-aba "Novo dispositivo").

export type Technology = "IPTV" | "P2P";

export type DeviceType =
  | "SAMSUNG_LG"
  | "ANDROID_PHONE"
  | "ANDROID_TV"
  | "XBOX"
  | "IOS"
  | "COMPUTADOR"
  | "FIRE_TV"
  | "ROKU";

export const ALL_DEVICE_TYPES: DeviceType[] = [
  "SAMSUNG_LG",
  "ANDROID_PHONE",
  "ANDROID_TV",
  "XBOX",
  "IOS",
  "COMPUTADOR",
  "FIRE_TV",
  "ROKU",
];

// ✅ 06/09/2026, pedido do Márcio: "Android / TV Box" misturava celular e TV
// Box num checkbox só — virou 2 tipos independentes (ANDROID_PHONE ficou com
// a chave antiga, só renomeado; ANDROID_TV é novo). Migration de dados em
// docs/sql/apps_device_types_android_split.sql fez o Android TV nascer com
// os mesmos apps que já tinham o combinado antigo — não é regra fixa, é só
// o estado inicial, os dois toggles são independentes daqui pra frente.
export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  SAMSUNG_LG: "Samsung / LG",
  ANDROID_PHONE: "Celular Android",
  ANDROID_TV: "Android TV",
  XBOX: "Xbox",
  IOS: "iPhone / iOS",
  COMPUTADOR: "Computador",
  FIRE_TV: "Fire TV Stick",
  ROKU: "Roku",
};
