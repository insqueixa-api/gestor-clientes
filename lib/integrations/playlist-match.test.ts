import { describe, expect, it } from "vitest";
import { pickPlaylistsToDelete } from "./playlist-match";

const pick = (names: string[], wanted: string) =>
  pickPlaylistsToDelete(names.map((name) => ({ name })), wanted, (p) => p.name);

describe("pickPlaylistsToDelete", () => {
  it("nome exato apaga todas as cópias", () => {
    const r = pick(["Insqueixa_NaTV", "Outra", "insqueixa_natv"], "Insqueixa_NaTV");
    expect(r.mode).toBe("exact");
    expect(r.matches.map((p) => p.name)).toEqual(["Insqueixa_NaTV", "insqueixa_natv"]);
  });

  it("sem exato apaga o mais próximo (nome antigo = só o usuário)", () => {
    const r = pick(["Insqueixa", "Lista do João"], "Insqueixa_NaTV");
    expect(r.mode).toBe("closest");
    expect(r.matches.map((p) => p.name)).toEqual(["Insqueixa"]);
  });

  it("mesmo usuário em outro servidor conta como próximo", () => {
    expect(pick(["Insqueixa_Fast"], "Insqueixa_NaTV").matches.map((p) => p.name)).toEqual(["Insqueixa_Fast"]);
  });

  it("entre vários parecidos, escolhe o mais parecido", () => {
    const r = pick(["Insqueixa", "Insqueixa_NaTV2", "Insqueixa_Fast"], "Insqueixa_NaTV");
    expect(r.matches.map((p) => p.name)).toEqual(["Insqueixa_NaTV2"]);
  });

  it("nada parecido → apaga tudo do aparelho (pelo MAC)", () => {
    const r = pick(["Lista do João", "Outra"], "Insqueixa_NaTV");
    expect(r.mode).toBe("all");
    expect(r.matches.map((p) => p.name)).toEqual(["Lista do João", "Outra"]);
    expect(pick(["NaTV"], "Robson_NaTV").mode).toBe("closest"); // contido no nome
  });

  it("mais parecida com cópias repetidas → apaga todas as cópias dela", () => {
    const r = pick(["Insqueixa_Fast", "Insqueixa_Fast", "Lista do Joao"], "Insqueixa_NaTV");
    expect(r.mode).toBe("closest");
    expect(r.matches.map((p) => p.name)).toEqual(["Insqueixa_Fast", "Insqueixa_Fast"]);
  });

  it("usuário diferente com mesmo começo não é parecido (Insqueixa × InsqueixaElite)", () => {
    const r = pick(["InsqueixaElite_Elite", "Insqueixa_Fast"], "Insqueixa_NaTV");
    expect(r.matches.map((p) => p.name)).toEqual(["Insqueixa_Fast"]);
    expect(pick(["Anabela_NaTV"], "Ana_NaTV").mode).toBe("all");
  });

  it("aparelho sem listas → nada", () => {
    expect(pick([], "Insqueixa_NaTV").mode).toBe("none");
  });

  it("nome vazio não apaga nada", () => {
    expect(pick(["Insqueixa"], "").matches).toEqual([]);
  });
});
