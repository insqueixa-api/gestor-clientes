// lib/phone-tail.ts
//
// Comparação de números de telefone BR tolerante ao 9º dígito (achado
// 28/08/2026). Um corte cru dos últimos 9 dígitos (usado antes em 3 lugares:
// checagem de duplicata ao criar cliente em novo_cliente.tsx, sync com a
// Agenda, e o botão "Atualizar foto" em cliente/[id]/page.tsx) NÃO tolera de
// verdade a ambiguidade "com/sem 9º dígito" que os comentários originais
// diziam cobrir — inserir/remover esse dígito desloca TODOS os dígitos
// seguintes, então os últimos 9 caracteres nunca batem entre as duas versões
// do mesmo número.
//
// Exposto ao vivo em 28/08/2026: o cliente "Rodrigo" tem o WhatsApp salvo
// como +559291465121 (formato antigo, sem o 9º dígito). O contato dele na
// Agenda foi corrigido pra 092991465121 (com o 9 — resolveu um "Fixo"
// incorreto, ver lib/telein.ts) e o botão "Atualizar foto" parou de achar o
// contato, porque "991465121" (tail com 9) ≠ "291465121" (tail sem 9).
//
// brPhoneTailCandidates() devolve as DUAS variações válidas do tail de 9
// dígitos pro mesmo número — extrai DDD + assinante de verdade (em vez de só
// cortar pra 8 dígitos, que perderia a precisão do DDD e juntaria números de
// áreas diferentes por coincidência).
export function brPhoneTailCandidates(raw: string | null | undefined): string[] {
  let d = String(raw || "").replace(/\D+/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);

  if (d.length < 10) {
    const fallback = d.slice(-9);
    return fallback.length >= 8 ? [fallback] : [];
  }

  const ddd = d.slice(0, 2);
  const local = d.slice(2);
  const candidates = new Set<string>();

  if (local.length === 8) {
    candidates.add(`${ddd.slice(-1)}${local}`); // tail sem o 9º dígito
    candidates.add(`9${local}`); // tail com o 9º dígito
  } else if (local.length === 9 && local.startsWith("9")) {
    candidates.add(local); // já é o tail com o 9
    candidates.add(`${ddd.slice(-1)}${local.slice(1)}`); // tail sem o 9
  } else {
    candidates.add(d.slice(-9));
  }

  return [...candidates];
}
