// Exporta todos os títulos ainda pendentes (titulo_alt_busca IS NULL, dentro da
// lista do CSV original) para um novo CSV com uma coluna titulo_alt vazia,
// pronto para outra IA preencher. Uso:
//   DATABASE_URL="..." node export_pending.mjs <csv_origem> <csv_destino>
import pg from "pg";
import fs from "fs";

const srcPath = process.argv[2];
const destPath = process.argv[3] || "docs/pendentes_para_traduzir.csv";

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

function csvField(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const raw = fs.readFileSync(srcPath, "utf8");
const rows = parseCsv(raw);
const header = rows[0];
const idxId = header.indexOf("id");
const ids = rows.slice(1).map(r => (r[idxId] || "").trim()).filter(Boolean);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: pending } = await client.query(
  `select id, titulo_normalizado as titulo, tipo, ano from catalog_master
   where id = any($1::uuid[]) and titulo_alt_busca is null
   order by titulo_normalizado asc`,
  [ids]
);

const lines = ["id,titulo,tipo,ano,titulo_alt"];
for (const r of pending) {
  lines.push([csvField(r.id), csvField(r.titulo), csvField(r.tipo), csvField(r.ano ?? ""), ""].join(","));
}
fs.writeFileSync(destPath, lines.join("\n") + "\n", "utf8");

console.log(`exportados=${pending.length} arquivo=${destPath}`);
await client.end();
