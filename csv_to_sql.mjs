// Converte o CSV preenchido (id,titulo,tipo,ano,titulo_alt) num arquivo .sql
// com updates em lote, pronto para colar no SQL Editor do Supabase. Uso:
//   node csv_to_sql.mjs <csv_preenchido> <arquivo_sql_saida>
//
// Linhas com titulo_alt vazio são gravadas como '' (marca "revisado, sem
// alternativa confiável" — mesma convenção usada no restante do projeto,
// não fica pendente para sempre). Se preferir manter essas linhas como
// pendentes (para tentar de novo depois), remova-as do CSV antes de rodar.
import fs from "fs";

const srcPath = process.argv[2];
const destPath = process.argv[3] || "docs/import_correcoes.sql";
const CHUNK_SIZE = 500;

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

function sqlString(s) {
  return "'" + s.replace(/'/g, "''") + "'";
}

const raw = fs.readFileSync(srcPath, "utf8");
const rows = parseCsv(raw);
const header = rows[0];
const idxId = header.indexOf("id");
const idxAlt = header.indexOf("titulo_alt");
if (idxId === -1 || idxAlt === -1) {
  throw new Error("CSV precisa ter colunas 'id' e 'titulo_alt'");
}

const items = rows.slice(1)
  .filter(r => (r[idxId] || "").trim())
  .map(r => ({
    id: r[idxId].trim(),
    alt: normalizarTituloBusca((r[idxAlt] || "").trim()),
  }));

const statements = [];
for (let i = 0; i < items.length; i += CHUNK_SIZE) {
  const chunk = items.slice(i, i + CHUNK_SIZE);
  const values = chunk.map(it => `(${sqlString(it.id)}::uuid, ${sqlString(it.alt)})`).join(",\n  ");
  statements.push(
    `UPDATE catalog_master AS cm\nSET titulo_alt_busca = data.alt\nFROM (VALUES\n  ${values}\n) AS data(id, alt)\nWHERE cm.id = data.id;`
  );
}

fs.writeFileSync(destPath, statements.join("\n\n") + "\n", "utf8");
console.log(`linhas=${items.length} statements=${statements.length} arquivo=${destPath}`);
