// lib/apps/device-types.ts
// Fonte única de apps.device_types/technology — antes só existia em
// app/admin/gerenciador/aplicativo/page.tsx; agora também usado no portal
// (Bloco 3, sub-aba "Novo dispositivo").

export type Technology = "IPTV" | "P2P";

export type DeviceType =
  | "SAMSUNG_LG"
  | "ANDROID_TVBOX"
  | "IOS"
  | "COMPUTADOR"
  | "FIRE_TV"
  | "ROKU";

export const ALL_DEVICE_TYPES: DeviceType[] = [
  "SAMSUNG_LG",
  "ANDROID_TVBOX",
  "IOS",
  "COMPUTADOR",
  "FIRE_TV",
  "ROKU",
];

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  SAMSUNG_LG: "Samsung / LG",
  ANDROID_TVBOX: "Android / TV Box",
  IOS: "iPhone / iOS",
  COMPUTADOR: "Computador",
  FIRE_TV: "Fire TV Stick",
  ROKU: "Roku",
};
