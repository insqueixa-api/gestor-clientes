import { describe, expect, it } from "vitest";
import { applyWaLinePrefix, applyWaWrap, type WaEdit } from "./format";

function run(text: string, edit: WaEdit) {
  const out = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  return { out, sel: out.slice(edit.selStart, edit.selEnd) };
}

describe("applyWaWrap", () => {
  it("envolve a palavra selecionada", () => {
    const t = "olá mundo";
    expect(run(t, applyWaWrap(t, 4, 9, "bold")).out).toBe("olá *mundo*");
  });

  it("deixa os espaços da ponta fora dos símbolos", () => {
    const t = "pague  hoje  mesmo";
    expect(run(t, applyWaWrap(t, 5, 13, "bold")).out).toBe("pague  *hoje*  mesmo");
  });

  it("várias linhas: cada linha ganha os próprios símbolos, linha vazia fica", () => {
    const t = "linha um\n\nlinha dois";
    expect(run(t, applyWaWrap(t, 0, t.length, "italic")).out).toBe("_linha um_\n\n_linha dois_");
  });

  it("sem seleção insere o par com o cursor no meio", () => {
    const e = applyWaWrap("abc", 3, 3, "strike");
    expect(run("abc", e).out).toBe("abc~~");
    expect(e.selStart).toBe(4);
    expect(e.selEnd).toBe(4);
  });

  it("desfaz quando os símbolos estão logo fora da seleção", () => {
    const t = "olá *mundo*";
    const r = run(t, applyWaWrap(t, 5, 10, "bold"));
    expect(r.out).toBe("olá mundo");
    expect(r.sel).toBe("mundo");
  });

  it("desfaz quando a seleção inclui os símbolos", () => {
    const t = "olá *mundo*";
    expect(run(t, applyWaWrap(t, 4, 11, "bold")).out).toBe("olá mundo");
  });

  it("monoespaçado em bloco atravessa linhas", () => {
    const t = "a\nb";
    expect(run(t, applyWaWrap(t, 0, 3, "mono")).out).toBe("```a\nb```");
  });

  it("variável {nome} continua intacta dentro do negrito", () => {
    const t = "Oi {primeiro_nome}";
    expect(run(t, applyWaWrap(t, 3, t.length, "bold")).out).toBe("Oi *{primeiro_nome}*");
  });
});

describe("applyWaLinePrefix", () => {
  it("marcadores nas linhas selecionadas (expande pra linha inteira)", () => {
    const t = "um\ndois\ntrês";
    expect(run(t, applyWaLinePrefix(t, 1, 5, "bullet")).out).toBe("- um\n- dois\ntrês");
  });

  it("lista numerada pula linha vazia", () => {
    const t = "a\n\nb";
    expect(run(t, applyWaLinePrefix(t, 0, t.length, "numbered")).out).toBe("1. a\n\n2. b");
  });

  it("aplicar de novo remove", () => {
    const t = "- um\n- dois";
    expect(run(t, applyWaLinePrefix(t, 0, t.length, "bullet")).out).toBe("um\ndois");
    const n = "1. a\n2. b";
    expect(run(n, applyWaLinePrefix(n, 0, n.length, "numbered")).out).toBe("a\nb");
  });

  it("citação com o cursor parado no meio da linha", () => {
    const t = "primeira\nsegunda";
    expect(run(t, applyWaLinePrefix(t, 12, 12, "quote")).out).toBe("primeira\n> segunda");
  });
});
