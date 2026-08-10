import { sb, TENANT_ID } from "./db.mjs";

const { data: contacts, error } = await sb
  .from("google_contacts")
  .select("*")
  .eq("tenant_id", TENANT_ID);

if (error) { console.error(error); process.exit(1); }

console.log("Total contatos:", contacts.length);
console.log("Colunas:", Object.keys(contacts[0] || {}));

function normPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  return d.slice(-9); // últimos 9 dígitos, ignora DDI/DDD zero à esquerda
}

// Agrupa por telefone normalizado (principal + secundário)
const byPhone = new Map();
for (const c of contacts) {
  const phones = new Set();
  const p1 = normPhone(c.phone_e164);
  if (p1) phones.add(p1);
  const p2 = normPhone(c.secondary_phone);
  if (p2) phones.add(p2);
  for (const arrPhone of (Array.isArray(c.phones) ? c.phones : [])) {
    const p = normPhone(arrPhone?.value);
    if (p) phones.add(p);
  }
  for (const p of phones) {
    if (!byPhone.has(p)) byPhone.set(p, []);
    byPhone.get(p).push(c);
  }
}

const dupeGroups = [];
const seenIds = new Set();
for (const [phone, list] of byPhone) {
  const uniqueById = [...new Map(list.map((c) => [c.id, c])).values()];
  if (uniqueById.length > 1) {
    dupeGroups.push({ phone, contacts: uniqueById });
  }
}

console.log("\nGrupos de telefone com mais de 1 contato:", dupeGroups.length);

let totalDupeContacts = 0;
for (const g of dupeGroups) totalDupeContacts += g.contacts.length;
console.log("Total de contatos envolvidos:", totalDupeContacts);

// Amostra dos primeiros 15 grupos
for (const g of dupeGroups.slice(0, 15)) {
  console.log("\n=== telefone (últimos 9 dígitos):", g.phone, "===");
  for (const c of g.contacts) {
    console.log(
      `  id=${c.id} | nome="${c.display_name}" | foto=${c.avatar_url ? "SIM" : "não"} | labels=${JSON.stringify(c.labels)} | emails=${JSON.stringify(c.emails)} | phone_e164=${c.phone_e164} | secondary=${c.secondary_phone} | resource=${c.google_resource_name} | synced=${c.synced_at}`,
    );
  }
}

import fs from "fs";
fs.writeFileSync(
  new URL("./dupe-groups.json", import.meta.url),
  JSON.stringify(dupeGroups, null, 2),
);
console.log("\nSalvo em .audit-tmp/dupe-groups.json");
