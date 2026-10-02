import { describe, expect, it } from "vitest";
import { baseHostOf, rotatePrincipalM3u, rotateSecondaryM3u } from "./m3u-lists";

const NATV = ["https://rj98.eu", "https://rw26.eu", "https://nc18.org", "https://ib05.eu", "http://oi26.top"];
const ELITE = ["http://bbr.asia", "http://chinaz.asia", "http://bbr.asia"];
const ONE = ["http://psbox.top"];
const many = (fn: () => string) => Array.from({ length: 200 }, fn);

describe("lista M3U principal/secundária", () => {
  it("baseHostOf ignora esquema e espelho rN.", () => {
    expect(baseHostOf("http://r2.rj98.eu/get.php?x=1")).toBe("rj98.eu");
    expect(baseHostOf("https://rj98.eu/get.php")).toBe("rj98.eu");
    expect(baseHostOf("")).toBe("");
  });

  it("principal do NaTV sempre https e nunca repete o domínio atual", () => {
    const cur = "https://rj98.eu/get.php?username=a&password=b&type=m3u_plus&output=ts";
    for (const u of many(() => rotatePrincipalM3u({ dnsList: NATV, username: "a", password: "b", serverName: "NaTV", currentPrincipal: cur }))) {
      expect(u.startsWith("https://")).toBe(true);
      expect(baseHostOf(u)).not.toBe("rj98.eu");
    }
  });

  it("secundária do NaTV é http://r2. ou r3.", () => {
    for (const u of many(() => rotateSecondaryM3u({ dnsList: NATV, username: "a", password: "b", serverName: "NaTV" }))) {
      expect(u).toMatch(/^http:\/\/r[23]\.[a-z0-9.]+\/get\.php\?username=a&password=b/);
    }
  });

  it("secundária dos outros nunca usa o domínio da principal", () => {
    const principal = "http://bbr.asia/get.php?username=a&password=b";
    for (const u of many(() => rotateSecondaryM3u({ dnsList: ELITE, username: "a", password: "b", serverName: "Elite", currentPrincipal: principal }))) {
      expect(baseHostOf(u)).toBe("chinaz.asia");
    }
  });

  it("servidor com 1 domínio só: usa ele mesmo", () => {
    const u = rotateSecondaryM3u({ dnsList: ONE, username: "a", password: "b", serverName: "Fast", currentPrincipal: "http://psbox.top/x" });
    expect(baseHostOf(u)).toBe("psbox.top");
  });

  it("sem usuário ou sem DNS não monta nada", () => {
    expect(rotatePrincipalM3u({ dnsList: [], username: "a", password: "b" })).toBe("");
    expect(rotateSecondaryM3u({ dnsList: NATV, username: "", password: "b", serverName: "NaTV" })).toBe("");
  });

  it("senha com caractere especial vai codificada", () => {
    const u = rotatePrincipalM3u({ dnsList: ONE, username: "a b", password: "x&y" });
    expect(u).toContain("username=a%20b&password=x%26y");
  });
});
