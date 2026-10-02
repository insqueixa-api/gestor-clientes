// lib/apps/m3u-lists.ts
//
// Lista M3U principal e secundária (02/10/2026, pedido do Márcio —
// docs/sql/m3u_principal_secundaria.sql). Fonte única das regras:
//
//   * PRINCIPAL (clients.m3u_url): a que vem da integração, a montada na
//     criação ou a gerada no admin. Rotacionar = outro domínio do servidor,
//     no formato normal. No NaTV sempre https://<dns>.
//   * SECUNDÁRIA (clients.m3u_url_secondary): rotaciona entre todos os
//     domínios. NaTV: espelho http://r2.<dns> ou http://r3.<dns>. Outros
//     servidores: um domínio diferente do que a principal está usando.
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

/**
 * Nova lista PRINCIPAL: outro domínio do servidor (se houver mais de um),
 * formato normal. NaTV: sempre https://.
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
  const current = baseHostOf(params.currentPrincipal);
  const candidates = hosts.length > 1 ? hosts.filter((h) => h.host !== current) : hosts;
  const chosen = pick(candidates.length ? candidates : hosts, random);
  const scheme = isNaTvServer(params.serverName) ? "https" : chosen.scheme;
  return `${scheme}://${chosen.host}${m3uPath(username, password)}`;
}

/**
 * Nova lista SECUNDÁRIA. NaTV: http://r2.|r3.<qualquer dns>. Outros: um
 * domínio diferente do que a principal usa (se o servidor tiver mais de um).
 * Também evita repetir a secundária atual quando há alternativa.
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
  const path = m3uPath(username, password);

  if (isNaTvServer(params.serverName)) {
    const current = String(params.currentSecondary || "").trim().toLowerCase();
    const options = hosts.flatMap((h) => NATV_MIRRORS.map((mirror) => `http://${mirror}.${h.host}${path}`));
    const fresh = options.filter((u) => u.toLowerCase() !== current);
    return pick(fresh.length ? fresh : options, random);
  }

  const principalHost = baseHostOf(params.currentPrincipal);
  const secondaryHost = baseHostOf(params.currentSecondary);
  let candidates = hosts.filter((h) => h.host !== principalHost);
  if (candidates.length === 0) candidates = hosts; // servidor com 1 domínio só
  const notRepeated = candidates.filter((h) => h.host !== secondaryHost);
  const chosen = pick(notRepeated.length ? notRepeated : candidates, random);
  return `${chosen.scheme}://${chosen.host}${path}`;
}
