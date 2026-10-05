import { describe, expect, it } from "vitest";
import { adaptSetupText, pickCatalogDownload, type DownloadHint } from "./download-info";

const TEXT =
  "1. Instale o aplicativo pela **loja de aplicativos** do seu aparelho (no computador, use o link de download acima) e abra.\n2. Anote o MAC.";

describe("adaptSetupText", () => {
  it("mantém a frase do link quando o card de computador está em cima", () => {
    expect(adaptSetupText(TEXT, { kind: "pc", url: "https://x.com/app.exe" })).toBe(TEXT);
  });

  it("tira a frase quando não há card (ex: Xbox) ou o card não é de computador", () => {
    const esperado =
      "1. Instale o aplicativo pela **loja de aplicativos** do seu aparelho e abra.\n2. Anote o MAC.";
    expect(adaptSetupText(TEXT, null)).toBe(esperado);
    expect(adaptSetupText(TEXT, { kind: "downloader", code: "123" })).toBe(esperado);
  });

  it("texto sem a frase não muda", () => {
    expect(adaptSetupText("1. Abra o app.", null)).toBe("1. Abra o app.");
    expect(adaptSetupText(null, null)).toBeNull();
  });
});

describe("pickCatalogDownload", () => {
  const pc: DownloadHint = { kind: "pc", url: "https://x.com/app.exe" };
  const dl: DownloadHint = { kind: "downloader", code: "999" };

  it("usa o do aparelho escolhido", () => {
    expect(pickCatalogDownload({ COMPUTADOR: pc, XBOX: null }, "XBOX")).toBeNull();
    expect(pickCatalogDownload({ COMPUTADOR: pc, XBOX: null }, "COMPUTADOR")).toEqual(pc);
  });

  it("sem aparelho: só quando todos os aparelhos dão o mesmo download", () => {
    expect(pickCatalogDownload({ ANDROID_TV: dl, FIRE_TV: { ...dl } }, null)).toEqual(dl);
    expect(pickCatalogDownload({ COMPUTADOR: pc, ANDROID_TV: dl }, null)).toBeNull();
    expect(pickCatalogDownload({ ANDROID_TV: dl, ROKU: null }, null)).toBeNull();
    expect(pickCatalogDownload(undefined, null)).toBeNull();
  });
});
