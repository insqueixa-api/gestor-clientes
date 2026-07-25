// Aplica um lote de traduções direto no banco. Uso:
//   DATABASE_URL="..." node apply_batch.mjs <lote.json>
// lote.json: [{ "id": "...", "alt": "titulo original/alternativo" }, ...]
// TODO item do lote fetch_batch precisa aparecer aqui — alt "" marca "revisado,
// sem alternativa confiável/necessária" (grava string vazia, não null, pra não
// voltar a aparecer no próximo fetch_batch).
import pg from "pg";
import fs from "fs";

const jsonPath = process.argv[2];
const items = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

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

const ids = [];
const alts = [];
let semAlternativa = 0;
for (const it of items) {
  const alt = (it.alt || "").trim();
  const norm = alt ? normalizarTituloBusca(alt) : "";
  if (!norm) semAlternativa++;
  ids.push(it.id);
  alts.push(norm);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let atualizados = 0;
if (ids.length) {
  const res = await client.query(
    `update catalog_master as cm
     set titulo_alt_busca = data.alt
     from unnest($1::uuid[], $2::text[]) as data(id, alt)
     where cm.id = data.id`,
    [ids, alts]
  );
  atualizados = res.rowCount;
}

console.log(`atualizados=${atualizados} sem_alternativa=${semAlternativa}`);
await client.end();
