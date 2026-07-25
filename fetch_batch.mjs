// Busca o próximo lote de N títulos (da lista do CSV de tradução) que ainda
// não têm titulo_alt_busca preenchido (NULL — string vazia conta como "já
// revisado, sem alternativa confiável" e não entra mais nesta lista). Uso:
//   DATABASE_URL="..." node fetch_batch.mjs <csv> <N>
import pg from "pg";
import fs from "fs";

const csvPath = process.argv[2];
const n = parseInt(process.argv[3] || "50", 10);

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
const ids = rows.slice(1).map(r => (r[idxId] || "").trim()).filter(Boolean);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const totalPendentes = await client.query(
  `select count(*)::int as c from catalog_master where id = any($1::uuid[]) and titulo_alt_busca is null`,
  [ids]
);

const { rows: batch } = await client.query(
  `select id, titulo_normalizado as titulo, tipo, ano from catalog_master
   where id = any($1::uuid[]) and titulo_alt_busca is null
   order by titulo_normalizado asc
   limit $2`,
  [ids, n]
);

console.log(JSON.stringify({ pendentes_total: totalPendentes.rows[0].c, batch }, null, 2));
await client.end();
