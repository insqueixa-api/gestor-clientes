import { sb, TENANT_ID, ENV } from "./db.mjs";
process.env.GOOGLE_CLIENT_ID = ENV.GOOGLE_CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = ENV.GOOGLE_CLIENT_SECRET;
const { getGoogleAccessToken, batchGetPeople } = await import("../lib/google/people-batch.ts");

const { data: tenantConfig } = await sb
  .from("tenants")
  .select("google_refresh_token")
  .eq("id", TENANT_ID)
  .single();
const accessToken = await getGoogleAccessToken(tenantConfig.google_refresh_token);

const { data: contacts } = await sb
  .from("google_contacts")
  .select("id, google_resource_name, display_name")
  .eq("tenant_id", TENANT_ID)
  .not("google_resource_name", "is", null);

console.log("Total contatos com resource_name:", contacts.length);

const resourceNames = contacts.map((c) => c.google_resource_name);
const people = await batchGetPeople(accessToken, resourceNames, "names,metadata");
console.log("Respondidos pelo Google:", people.size);

function fold(givenName, familyName) {
  const g = givenName.trim();
  const f = familyName.trim();
  if (!f) return g;
  if (g.toLowerCase().endsWith(f.toLowerCase())) return g;
  return `${g} ${f}`.trim();
}

const needsFix = [];
let noFamilyName = 0;
let noNames = 0;

for (const c of contacts) {
  const person = people.get(c.google_resource_name);
  if (!person) continue;
  const name = person.names?.[0];
  if (!name) { noNames++; continue; }
  const given = name.givenName || "";
  const family = name.familyName || "";
  if (!family.trim()) { noFamilyName++; continue; }
  const corrected = fold(given, family);
  needsFix.push({
    id: c.id,
    resourceName: c.google_resource_name,
    etag: person.etag,
    givenName: given,
    familyName: family,
    localDisplayName: c.display_name,
    corrected,
  });
}

console.log("Sem familyName (já ok):", noFamilyName);
console.log("Sem nome nenhum:", noNames);
console.log("PRECISAM DE CORREÇÃO:", needsFix.length);

console.log("\n--- Amostra (20 primeiros) ---");
for (const f of needsFix.slice(0, 20)) {
  console.log(`givenName="${f.givenName}" | familyName="${f.familyName}" -> corrigido="${f.corrected}"`);
}

import fs from "fs";
fs.writeFileSync(
  new URL("./needs-fix.json", import.meta.url),
  JSON.stringify(needsFix, null, 2),
);
console.log("\nSalvo em .audit-tmp/needs-fix.json");
