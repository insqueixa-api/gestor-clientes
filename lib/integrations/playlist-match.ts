// lib/integrations/playlist-match.ts
//
// Qual playlist apagar no aparelho (03/10/2026, regra do Márcio: "se não tem
// o nome exato, apaga o mais próximo"):
//   1. Nome EXATO → todas as cópias com esse nome.
//   2. Senão, a MAIS PARECIDA entre as que têm relação com o nome procurado:
//      uma contém a outra ("Insqueixa" × "Insqueixa_NaTV" — nome antigo, só o
//      usuário) ou o mesmo usuário ("Insqueixa_Fast" × "Insqueixa_NaTV").
//   3. Nenhuma com relação → TODAS as playlists do aparelho ("se não achar
//      nada, apaga pelo MAC" — decisão do Márcio, 03/10/2026). Efeito: o
//      Configurar (apaga antes de criar) limpa a TV inteira nesse caso.
//   Nome vazio → nada (nunca apaga às cegas por falta de nome).
// Comparação sem maiúsculas/acentos/espaços/símbolos.

const norm = (s: string) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

// "Insqueixa_NaTV" → "insqueixa" (parte antes do "_" = usuário do servidor)
const userPart = (s: string) => norm(String(s || "").split("_")[0]);

function longestCommonSubstring(a: string, b: string): number {
  let best = 0;
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : 0;
      if (dp[j] > best) best = dp[j];
      prev = tmp;
    }
  }
  return best;
}

export function pickPlaylistsToDelete<T>(
  playlists: T[],
  wanted: string,
  getName: (p: T) => string,
): { matches: T[]; mode: "exact" | "closest" | "all" | "none" } {
  const target = norm(wanted);
  if (!target || !playlists.length) return { matches: [], mode: "none" };

  const exact = playlists.filter((p) => norm(getName(p)) === target);
  if (exact.length) return { matches: exact, mode: "exact" };

  const targetUser = userPart(wanted);
  let best: { p: T; score: number } | null = null;
  for (const p of playlists) {
    const n = norm(getName(p));
    if (!n) continue;
    const related =
      n.includes(target) ||
      target.includes(n) ||
      (targetUser.length >= 3 && userPart(getName(p)) === targetUser); // usuário inteiro ("Insqueixa" ≠ "InsqueixaElite")
    if (!related) continue;
    const score = longestCommonSubstring(n, target) / Math.max(n.length, target.length);
    if (!best || score > best.score) best = { p, score };
  }
  // a mais parecida + as cópias dela com o mesmo nome (configurada 2x antes)
  if (best) {
    const bestName = norm(getName(best.p));
    return { matches: playlists.filter((p) => norm(getName(p)) === bestName), mode: "closest" };
  }
  return { matches: [...playlists], mode: "all" };
}
