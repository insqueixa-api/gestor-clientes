// docs/import_titulo_alt_busca.mjs
//
// Importa as traduções de docs/catalogo_titulos_para_traducao.csv de volta
// pro banco, coluna catalog_master.titulo_alt_busca — pra completar a busca
// bilíngue nos 31.346 títulos que já tinham TMDB confirmado antes de
// 25/07/2026 (os que forem re-processados pelo TMDB dali em diante já
// preenchem isso sozinhos, via sync-tmdb/route.ts e tmdb-aplicar/route.ts).
//
// Uso (de dentro da raiz do projeto, precisa do node_modules já instalado
// pra resolver o pacote "pg"):
//
//   DATABASE_URL="..." node docs/import_titulo_alt_busca.mjs docs/catalogo_titulos_para_traducao.csv
//
// Espera o CSV com cabeçalho: id,titulo,tipo,ano,titulo_alt
// Só atualiza linhas onde titulo_alt não está vazio — o resto fica como
// estava (null), sem problema, a busca cai pro título original sozinha.

import pg from "pg";
import fs from "fs";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Uso: node docs/import_titulo_alt_busca.mjs <caminho-do-csv>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Faltando DATABASE_URL no ambiente.");
  process.exit(1);
}

// Mesma normalização de lib/catalog/catalog-parser.ts (normalizarTituloBusca)
// — precisa ser idêntica pra bater com o que a busca usa.
function normalizarTituloBusca(titulo) {
  return titulo
    .replace(/&amp;/gi, " e ")
    .replace(/&/g, " e ")
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Parser de CSV simples, mas correto com aspas/vírgulas dentro de campo
// (o mesmo formato que o export gerou).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* ignora */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const raw = fs.readFileSync(csvPath, "utf8");
const rows = parseCsv(raw);
const header = rows[0];
const idxId = header.indexOf("id");
const idxAlt = header.indexOf("titulo_alt");
if (idxId === -1 || idxAlt === -1) {
  console.error("CSV precisa ter colunas 'id' e 'titulo_alt'. Achei:", header);
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let atualizados = 0;
let pulados = 0;

for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.length < 2) continue;
  const id = (r[idxId] || "").trim();
  const altRaw = (r[idxAlt] || "").trim();
  if (!id) continue;
  if (!altRaw) { pulados++; continue; }

  const altNorm = normalizarTituloBusca(altRaw);
  if (!altNorm) { pulados++; continue; }

  await client.query(`update catalog_master set titulo_alt_busca = $1 where id = $2`, [altNorm, id]);
  atualizados++;
  if (atualizados % 500 === 0) console.log(`... ${atualizados} atualizados`);
}

console.log(`\n✅ Importação concluída: ${atualizados} atualizados, ${pulados} sem tradução (pulados).`);
await client.end();
