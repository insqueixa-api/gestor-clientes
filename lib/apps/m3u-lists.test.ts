import { describe, expect, it } from "vitest";
import { baseHostOf, rotatePrincipalM3u, rotateSecondaryM3u } from "./m3u-lists";

const NATV = ["https://rj98.eu", "https://rw26.eu", "https://nc18.org", "https://ib05.eu", "http://oi26.top"];
const ELITE = ["http://bbr.asia", "http://chinaz.asia", "http://bbr.asia"];
const ONE = ["http://psbox.top"];
const many = (fn: () => string) => Array.from({ length: 200 }, fn);
const base = (u: string) => u.split("/get.php")[0];

describe("lista M3U principal/secundária", () => {
  it("baseHostOf ignora esquema e espelho rN.", () => {
    expect(baseHostOf("http://r2.rj98.eu/get.php?x=1")).toBe("rj98.eu");
    expect(baseHostOf("https://rj98.eu/get.php")).toBe("rj98.eu");
    expect(baseHostOf("")).toBe("");
  });

  it("principal do NaTV é sempre a DNS 1, nos 3 formatos, sem repetir o atual", () => {
    const cur = "https://rj98.eu/get.php?username=a&password=b&type=m3u_plus&output=ts";
    const seen = new Set<string>();
    for (const u of many(() => rotatePrincipalM3u({ dnsList: NATV, username: "a", password: "b", serverName: "NaTV", currentPrincipal: cur }))) {
      expect(baseHostOf(u)).toBe("rj98.eu");
      expect(base(u)).not.toBe("https://rj98.eu");
      seen.add(base(u));
    }
    expect([...seen].sort()).toEqual(["http://r2.rj98.eu", "http://r3.rj98.eu"]);
  });

  it("principal dos outros servidores é sempre a DNS 1", () => {
    for (const u of many(() => rotatePrincipalM3u({ dnsList: ELITE, username: "a", password: "b", serverName: "Elite", currentPrincipal: "http://bbr.asia/x" }))) {
      expect(base(u)).toBe("http://bbr.asia");
    }
  });

  it("secundária do NaTV nunca usa a DNS 1 e varia os 3 formatos", () => {
    const formats = new Set<string>();
    for (const u of many(() => rotateSecondaryM3u({ dnsList: NATV, username: "a", password: "b", serverName: "NaTV" }))) {
      expect(baseHostOf(u)).not.toBe("rj98.eu");
      expect(u).toMatch(/^(https:\/\/|http:\/\/r[23]\.)[a-z0-9.]+\/get\.php\?username=a&password=b/);
      formats.add(u.startsWith("https://") ? "https" : u.slice(7, 9));
    }
    expect([...formats].sort()).toEqual(["https", "r2", "r3"]);
  });

  it("secundária dos outros nunca usa a DNS 1 e não repete a atual", () => {
    for (const u of many(() => rotateSecondaryM3u({ dnsList: ELITE, username: "a", password: "b", serverName: "Elite", currentPrincipal: "http://bbr.asia/x" }))) {
      expect(baseHostOf(u)).toBe("chinaz.asia");
    }
    const cur = "https://rw26.eu/get.php?username=a&password=b";
    for (const u of many(() => rotateSecondaryM3u({ dnsList: NATV, username: "a", password: "b", serverName: "NaTV", currentSecondary: cur }))) {
      expect(base(u)).not.toBe("https://rw26.eu");
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
