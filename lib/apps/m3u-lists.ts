// lib/apps/m3u-lists.ts
//
// Lista M3U principal e secundária (02/10/2026, pedido do Márcio —
// docs/sql/m3u_principal_secundaria.sql). Fonte única das regras.
//
// ✅ 15/10/2026, regra nova do Márcio — DNS 1 = a primeira cadastrada no
// servidor (servers.dns[0]):
//   * PRINCIPAL (clients.m3u_url): SEMPRE a DNS 1. Rotacionar = trocar de
//     formato. NaTV: sorteia entre https://<dns1>, http://r2.<dns1> e
//     http://r3.<dns1>. Outros servidores: só tem um formato (o esquema
//     salvo na DNS), então a principal é sempre a mesma.
//   * SECUNDÁRIA (clients.m3u_url_secondary): sorteia entre TODAS as outras
//     DNS (nunca a DNS 1). NaTV: nos 3 formatos também. Servidor com 1 DNS
//     só: usa a DNS 1, evitando o formato que a principal está usando.
//   * "Configurar" usa a que está salva; "Reconfigurar" rotaciona e salva
//     (lib/apps/orchestration.ts).
//
// Funções puras (sem banco) — testadas em m3u-lists.test.ts.

export type M3uList = "principal" | "secundaria";

const NATV_MIRRORS = ["r2", "r3"];

export function isNaTvServer(serverName?: string | null): boolean {
  return String(serverName || "").trim().toUpperCase() === "NATV";
}

function splitDns(dns: string): { scheme: string; host: string } {
  const raw = String(dns || "").trim().replace(/\/+$/, "");
  const m = raw.match(/^(https?):\/\/(.+)$/i);
  if (m) return { scheme: m[1].toLowerCase(), host: m[2].replace(/\/.*$/, "").toLowerCase() };
  return { scheme: "http", host: raw.replace(/\/.*$/, "").toLowerCase() };
}

/** Domínio "base" de uma URL de lista (sem esquema, sem o espelho rN. do NaTV). */
export function baseHostOf(url: string | null | undefined): string {
  const m = String(url || "").trim().match(/^https?:\/\/([^/?#]+)/i);
  if (!m) return "";
  return m[1].toLowerCase().replace(/^r\d+\./, "");
}

function m3uPath(username: string, password: string): string {
  return `/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=ts`;
}

function uniqueHosts(dnsList: string[]): { scheme: string; host: string }[] {
  const seen = new Set<string>();
  const out: { scheme: string; host: string }[] = [];
  for (const d of dnsList || []) {
    const s = splitDns(d);
    if (!s.host || seen.has(s.host)) continue;
    seen.add(s.host);
    out.push(s);
  }
  return out;
}

function pick<T>(list: T[], random: () => number): T {
  return list[Math.floor(random() * list.length)];
}

/** Bases possíveis de uma DNS: NaTV nos 3 formatos; os outros, só o esquema salvo. */
function basesOf(h: { scheme: string; host: string }, natv: boolean): string[] {
  const host = h.host.replace(/^r\d+\./, "");
  if (!natv) return [`${h.scheme}://${h.host}`];
  return [`https://${host}`, ...NATV_MIRRORS.map((mirror) => `http://${mirror}.${host}`)];
}

/** Base (esquema + host) de uma URL salva, pra comparar com as opções. */
function baseOf(url: string | null | undefined): string {
  const m = String(url || "").trim().match(/^(https?):\/\/([^/?#]+)/i);
  return m ? `${m[1].toLowerCase()}://${m[2].toLowerCase()}` : "";
}

/** Sorteia uma opção diferente das "evitar" (se sobrar alguma). */
function pickFresh(options: string[], avoid: string[], random: () => number): string {
  const fresh = options.filter((o) => !avoid.includes(o));
  return pick(fresh.length ? fresh : options, random);
}

/**
 * Nova lista PRINCIPAL: sempre a DNS 1 do servidor. NaTV: sorteia o formato
 * (https / r2. / r3.), sem repetir o atual.
 */
export function rotatePrincipalM3u(params: {
  dnsList: string[];
  username: string;
  password: string;
  serverName?: string | null;
  currentPrincipal?: string | null;
  random?: () => number;
}): string {
  const { username, password, random = Math.random } = params;
  const hosts = uniqueHosts(params.dnsList);
  if (!username || hosts.length === 0) return "";
  const options = basesOf(hosts[0], isNaTvServer(params.serverName));
  return pickFresh(options, [baseOf(params.currentPrincipal)], random) + m3uPath(username, password);
}

/**
 * Nova lista SECUNDÁRIA: qualquer DNS menos a DNS 1 (NaTV nos 3 formatos),
 * sem repetir a secundária atual. Servidor com 1 DNS só: a DNS 1, num
 * formato diferente do da principal quando der.
 */
export function rotateSecondaryM3u(params: {
  dnsList: string[];
  username: string;
  password: string;
  serverName?: string | null;
  currentPrincipal?: string | null;
  currentSecondary?: string | null;
  random?: () => number;
}): string {
  const { username, password, random = Math.random } = params;
  const hosts = uniqueHosts(params.dnsList);
  if (!username || hosts.length === 0) return "";
  const natv = isNaTvServer(params.serverName);
  const others = hosts.slice(1).flatMap((h) => basesOf(h, natv));
  const options = others.length ? others : basesOf(hosts[0], natv);
  const avoid = [baseOf(params.currentPrincipal), baseOf(params.currentSecondary)];
  return pickFresh(options, avoid, random) + m3uPath(username, password);
}
