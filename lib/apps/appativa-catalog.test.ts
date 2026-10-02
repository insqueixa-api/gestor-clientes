import { describe, expect, it } from "vitest";
import {
  catalogItemFromApi,
  devicesFromAppativa,
  effectiveDevices,
  effectiveIcon,
  effectiveTier,
  periodFromAppativa,
  tierFromAppativa,
} from "./appativa-catalog";

const raw = {
  id: "1704893631925x176586575932592640",
  uuid: "50b5a68e",
  aplicativos: "BLESSED PLAYER",
  valor: 0.9,
  logo_do_app: "//cdn.exemplo/logo.png",
  avaliacao: "4.5",
  plano: "VIT",
  samsung_link: "https://x",
  roku_link: "https://y",
  apple_link: null,
  codigo_downloader: "9602872",
  mac_e_key: true,
};

describe("catálogo AtivaApp", () => {
  it("converte o item da API", () => {
    const it = catalogItemFromApi(raw);
    expect(it.nome).toBe("BLESSED PLAYER");
    expect(it.logo).toBe("https://cdn.exemplo/logo.png");
    expect(it.avaliacao).toBe(4.5);
    expect(it.mac_e_key).toBe(true);
    expect(it.downloader_code).toBe("9602872");
  });

  it("aparelhos pelos links + Downloader", () => {
    const d = devicesFromAppativa(catalogItemFromApi(raw));
    expect(d.sort()).toEqual(["ANDROID_TV", "FIRE_TV", "ROKU", "SAMSUNG_LG"].sort());
    expect(devicesFromAppativa(catalogItemFromApi({ id: "x" }))).toEqual([]);
  });

  it("estrelas automáticas: 4.5 → 4, sem nota → null", () => {
    expect(tierFromAppativa({ avaliacao: 4.5 })).toBe(4);
    expect(tierFromAppativa({ avaliacao: 5 })).toBe(5);
    expect(tierFromAppativa({ avaliacao: null })).toBeNull();
  });

  it("período", () => {
    expect(periodFromAppativa("ANUAL")).toBe("annual");
    expect(periodFromAppativa("VIT")).toBe("lifetime");
    expect(periodFromAppativa(null)).toBeNull();
  });

  it("override do Márcio sempre vale por cima da AtivaApp", () => {
    const catalog = [catalogItemFromApi(raw)];
    const semNada = { appativa_app_id: raw.id };
    expect(effectiveIcon(semNada, catalog)).toBe("https://cdn.exemplo/logo.png");
    expect(effectiveTier(semNada, catalog)).toEqual({ value: 4, auto: true });
    expect(effectiveDevices(semNada, catalog).auto).toBe(true);

    const comOverride = {
      appativa_app_id: raw.id,
      icon_url: "https://r2/minha.png",
      tier: 2,
      device_types: ["IOS" as const],
    };
    expect(effectiveIcon(comOverride, catalog)).toBe("https://r2/minha.png");
    expect(effectiveTier(comOverride, catalog)).toEqual({ value: 2, auto: false });
    expect(effectiveDevices(comOverride, catalog)).toEqual({ value: ["IOS"], auto: false });
  });

  it("app sem vínculo com a AtivaApp não inventa nada", () => {
    expect(effectiveIcon({}, [])).toBeNull();
    expect(effectiveTier({}, []).value).toBeNull();
  });
});
