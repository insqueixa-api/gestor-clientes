// lib/apps/appativa-catalog.ts
//
// Catálogo da Appativa ("AtivaApp") — formato único usado pela rota de
// sincronização (app/api/integrations/appativa/list-apps), pela página de
// aplicativos e pelo modal de edição. Criado 02/10/2026 (refactor de apps,
// docs/apps-refactor/PLANO.md, fase 2).
//
// Antes o cache guardava só id/uuid/nome/valor; a API devolve ~60 campos.
// Aqui ficam os que o UniGestor usa: logo, avaliação, classe, descrição,
// plano, link do app, campos pedidos (MAC/Key/Device ID), links por
// plataforma e código Downloader.
//
// Regra de override (pedido do Márcio): o que vem da AtivaApp é o PADRÃO;
// o que ele preenche à mão sempre vale por cima. As funções `effective*`
// abaixo aplicam isso — usar sempre elas, nunca a coluna crua.
import type { DeviceType } from "@/lib/apps/device-types";

export type AppativaLinks = {
  androidtv?: string | null;
  samsung?: string | null;
  lg?: string | null;
  roku?: string | null;
  microsoft?: string | null;
  apple?: string | null;
};

export type AppativaCatalogItem = {
  /** valor que a Appativa espera em app_uuid de ativação (NÃO o uuid) */
  id: string;
  uuid: string;
  nome: string;
  /** custo em créditos */
  valor: number;
  logo?: string | null;
  /** nota da Appativa (ex: 4.5, 5) — preenchida em poucos apps */
  avaliacao?: number | null;
  /** "A" | "B" | null */
  classe?: string | null;
  descricao?: string | null;
  /** "ANUAL" | "VIT" */
  plano?: string | null;
  link_app?: string | null;
  mac_e_key?: boolean;
  is_device_id?: boolean;
  deletado?: boolean;
  modulo?: string | null;
  links?: AppativaLinks;
  downloader_code?: string | null;
};

/** Snapshot gravado em apps.appativa_meta (persistido pro portal usar depois). */
export type AppativaMeta = AppativaCatalogItem & { synced_at: string };

const str = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/** Item cru da API (/api/listar-aplicativos) → formato do UniGestor. */
export function catalogItemFromApi(it: any): AppativaCatalogItem {
  const rating = Number(it?.avaliacao);
  const logo = str(it?.logo_do_app);
  return {
    id: String(it?.id ?? ""),
    uuid: String(it?.uuid ?? ""),
    nome: String(it?.aplicativos ?? ""),
    valor: Number(it?.valor ?? 0),
    logo: logo && logo.startsWith("//") ? `https:${logo}` : logo,
    avaliacao: Number.isFinite(rating) && rating > 0 ? rating : null,
    classe: str(it?.classe),
    descricao: str(it?.descricao),
    plano: str(it?.plano),
    link_app: str(it?.link_app),
    mac_e_key: it?.mac_e_key === true,
    is_device_id: it?.is_device_id === true,
    deletado: it?.deletado === true,
    modulo: str(it?.modulo),
    links: {
      androidtv: str(it?.androidtv_link),
      samsung: str(it?.samsung_link),
      lg: str(it?.lg_link),
      roku: str(it?.roku_link),
      microsoft: str(it?.microsoft_link),
      apple: str(it?.apple_link),
    },
    downloader_code: str(it?.codigo_downloader),
  };
}

/**
 * Aparelhos que a AtivaApp indica (pelos links de cada loja + código
 * Downloader, que é como se instala em Fire TV/Android TV). Sem nenhum
 * link → lista vazia (não é "compatível com tudo").
 */
export function devicesFromAppativa(item: Partial<AppativaCatalogItem> | null | undefined): DeviceType[] {
  if (!item) return [];
  const l = item.links || {};
  const out = new Set<DeviceType>();
  if (l.samsung || l.lg) out.add("SAMSUNG_LG");
  if (l.roku) out.add("ROKU");
  if (l.androidtv) out.add("ANDROID_TV");
  if (item.downloader_code) {
    out.add("ANDROID_TV");
    out.add("FIRE_TV");
  }
  if (l.apple) out.add("IOS");
  if (l.microsoft) {
    out.add("COMPUTADOR");
    out.add("XBOX");
  }
  return [...out];
}

/** Estrelas automáticas a partir da nota da AtivaApp (4.5 → 4, conservador). */
export function tierFromAppativa(item: Partial<AppativaCatalogItem> | null | undefined): number | null {
  const r = Number(item?.avaliacao);
  if (!Number.isFinite(r) || r <= 0) return null;
  return Math.max(1, Math.min(5, Math.floor(r)));
}

export function periodFromAppativa(plano: string | null | undefined): "annual" | "lifetime" | null {
  const p = String(plano || "").toUpperCase();
  if (p.startsWith("ANU")) return "annual";
  if (p.startsWith("VIT")) return "lifetime";
  return null;
}

type AppLike = {
  icon_url?: string | null;
  tier?: number | null;
  device_types?: string[] | null;
  appativa_app_id?: string | null;
  appativa_meta?: AppativaMeta | null;
};

/** Item da AtivaApp desse app: o snapshot salvo, senão o do catálogo em cache. */
export function appativaItemFor(
  app: AppLike,
  catalog?: AppativaCatalogItem[] | null,
): AppativaCatalogItem | null {
  if (!app.appativa_app_id) return null;
  const fromCatalog = catalog?.find((c) => c.id === app.appativa_app_id) || null;
  return fromCatalog || app.appativa_meta || null;
}

/** Logo: a do UniGestor (R2) vale; sem ela, a da AtivaApp. */
export function effectiveIcon(app: AppLike, catalog?: AppativaCatalogItem[] | null): string | null {
  return app.icon_url || appativaItemFor(app, catalog)?.logo || null;
}

/** Estrelas: as do Márcio valem; sem elas, a nota da AtivaApp. */
export function effectiveTier(
  app: AppLike,
  catalog?: AppativaCatalogItem[] | null,
): { value: number | null; auto: boolean } {
  if (app.tier) return { value: app.tier, auto: false };
  const auto = tierFromAppativa(appativaItemFor(app, catalog));
  return { value: auto, auto: auto != null };
}

/** Aparelhos: os marcados à mão valem; sem nenhum, os que a AtivaApp indica. */
export function effectiveDevices(
  app: AppLike,
  catalog?: AppativaCatalogItem[] | null,
): { value: string[]; auto: boolean } {
  if (app.device_types?.length) return { value: app.device_types, auto: false };
  const auto = devicesFromAppativa(appativaItemFor(app, catalog));
  return { value: auto, auto: auto.length > 0 };
}
