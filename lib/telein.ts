// lib/telein.ts
//
// Consulta de operadora via Telein, com CACHE em banco — cada número só é
// consultado na Telein uma vez na vida. Achado em 11/08/2026: a Telein não
// documenta a tabela de códigos publicamente, então o mapa abaixo é
// construído aos poucos, cruzando com consultanumero.abrtelecom.com.br. Sem
// cache, todo número com código ainda não mapeado (ex: "78") virava consulta
// repetida gastando crédito à toa toda vez que alguém rodava "Sincronizar
// Operadora" de novo — o código cru fica salvo em telein_lookups mesmo
// quando ainda não sabemos o nome, e passa a resolver sozinho assim que o
// código for adicionado ao mapa aqui embaixo, sem nova chamada à Telein.
import { createClient as createAdmin } from "@supabase/supabase-js";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Códigos confirmados cruzando com consultanumero.abrtelecom.com.br.
export const MAP_OPERADORAS: Record<string, string> = {
  "20": "Vivo",
  "21": "Claro",
  "31": "Oi",
  "41": "TIM",
  "12": "Algar",
  "14": "Oi", // Antiga Brasil Telecom
  "77": "Claro", // Antiga Nextel
  "34": "Vivo", // Telefônica Fixo
  "35": "Claro", // Embratel Fixo
  "36": "Oi", // Telemar Fixo
  "38": "Vivo", // GVT Fixo
  "40": "TIM", // TIM Fixo
  "78": "Claro", // confirmado em 10/08/2026 (Sandra Santana, Hygor)
};

/**
 * Consulta a operadora de um número (formato "55DDDNNNNNNNNN"). Por padrão
 * (`forceRefresh: false`, usado nas sincronizações em massa) primeiro checa
 * o cache local (telein_lookups) e só bate na Telein se o número nunca foi
 * consultado. Com `forceRefresh: true` (usado no "consultar operadora" de
 * dentro da edição de um contato específico — pode ter havido portabilidade
 * desde a última checagem) pula o cache, bate na Telein sempre e
 * SOBRESCREVE o código salvo com a resposta nova. Retorna null se o código
 * não tiver mapeamento conhecido ainda (o código cru fica salvo mesmo
 * assim, pra resolver sozinho quando o mapa acima for atualizado).
 */
export async function consultarOperadoraExterna(
  phoneDigits: string,
  forceRefresh = false,
): Promise<string | null> {
  try {
    if (!forceRefresh) {
      const { data: cached } = await supabaseAdmin
        .from("telein_lookups")
        .select("raw_code")
        .eq("phone_digits", phoneDigits)
        .maybeSingle();

      if (cached?.raw_code) {
        if (cached.raw_code.startsWith("99")) return null;
        return MAP_OPERADORAS[cached.raw_code] || "Celular/Fixo";
      }
    }

    const chave = (process.env.TELEIN_API_KEY || "").replace(/['"]/g, "").trim();
    if (!chave) return null;

    const numeroTratado = phoneDigits.startsWith("55")
      ? phoneDigits.substring(2)
      : phoneDigits;

    const res = await fetch(
      `http://consultanumero1.telein.com.br/sistema/consulta_numero.php?chave=${chave}&numero=${numeroTratado}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;

    const textoRetorno = await res.text();
    const partes = textoRetorno.split("#");
    if (partes.length === 0) return null;

    const codigoDaOperadora = partes[0].trim();

    // Salva o código cru sempre — mesmo erro (99x) ou desconhecido — pra
    // nunca mais gastar consulta nesse número de novo.
    await supabaseAdmin.from("telein_lookups").upsert(
      { phone_digits: phoneDigits, raw_code: codigoDaOperadora, queried_at: new Date().toISOString() },
      { onConflict: "phone_digits" },
    );

    if (codigoDaOperadora.startsWith("99")) return null;
    return MAP_OPERADORAS[codigoDaOperadora] || "Celular/Fixo";
  } catch {
    return null;
  }
}
