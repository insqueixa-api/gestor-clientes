import { describe, expect, it } from "vitest";
import { pickPlaylistsToDelete, setPlaylistDeleteExactOnly } from "./playlist-match";

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

// ✅ 06/10/2026: Configurar/Reconfigurar apagam SÓ o nome exato — nunca a
// mais parecida, nunca todas as listas do aparelho (o Remover segue a regra
// acima).
describe("pickPlaylistsToDelete — só nome exato (Configurar/Reconfigurar)", () => {
  const exact = (names: string[], wanted: string) =>
    pickPlaylistsToDelete(names.map((name) => ({ name })), wanted, (p) => p.name, { exactOnly: true });

  it("apaga a própria lista (mesmo nome)", () => {
    const r = exact(["Insqueixa_NaTV", "Lista do Joao"], "Insqueixa_NaTV");
    expect(r.matches.map((p) => p.name)).toEqual(["Insqueixa_NaTV"]);
  });

  it("aparelho com listas de outros: não apaga nenhuma", () => {
    const r = exact(["Lista do Joao", "Elite - InsqueixaElite", "Fast"], "Insqueixa_NaTV");
    expect(r.mode).toBe("none");
    expect(r.matches).toEqual([]);
  });

  it("não apaga a 'mais parecida' (outro servidor do mesmo usuário)", () => {
    expect(exact(["Insqueixa_Fast", "Insqueixa"], "Insqueixa_NaTV").matches).toEqual([]);
  });

  it("principal e secundária convivem: configurar uma não apaga a outra", () => {
    expect(exact(["Insqueixa_NaTV"], "Insqueixa_NaTV_2").matches).toEqual([]);
    expect(exact(["Insqueixa_NaTV_2"], "Insqueixa_NaTV").matches).toEqual([]);
  });
});

// O modo é ligado pela ROTA (body.exact_only) e tem que valer depois das
// esperas de rede da própria requisição — sem vazar pra requisições
// simultâneas (uma "Remover" ao mesmo tempo segue a regra antiga).
describe("setPlaylistDeleteExactOnly — vale por requisição", () => {
  const lists = ["Lista do Joao", "Fast"].map((name) => ({ name }));
  const pickLater = async (wait: number) => {
    await new Promise((r) => setTimeout(r, wait));
    return pickPlaylistsToDelete(lists, "Insqueixa_NaTV", (p) => p.name).mode;
  };

  it("continua valendo depois de await e não vaza pra outra requisição", async () => {
    const configurar = (async () => {
      setPlaylistDeleteExactOnly(true);
      return pickLater(20);
    })();
    const remover = (async () => {
      setPlaylistDeleteExactOnly(false);
      return pickLater(10);
    })();
    const semFlag = (async () => pickLater(5))();
    expect(await configurar).toBe("none"); // só exato: não apaga nada
    expect(await remover).toBe("all"); // regra do Remover (03/10/2026)
    expect(await semFlag).toBe("all");
  });
});
