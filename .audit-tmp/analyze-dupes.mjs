import fs from "fs";

const dupeGroups = JSON.parse(
  fs.readFileSync(new URL("./dupe-groups.json", import.meta.url), "utf8"),
);

console.log("Total grupos:", dupeGroups.length);

const sizeDist = {};
for (const g of dupeGroups) {
  sizeDist[g.contacts.length] = (sizeDist[g.contacts.length] || 0) + 1;
}
console.log("Distribuição de tamanho de grupo:", sizeDist);

let bothHavePhoto = 0;
let onlyOneHasPhoto = 0;
let neitherHasPhoto = 0;
let sameName = 0;
let diffName = 0;
let oneHasLabelOtherDoesnt = 0;
let bothHaveLabel = 0;
let neitherHasLabel = 0;
let hasEmailDiff = 0;
let hasSecondaryDiff = 0;
let clientIdSet = new Set();
let weirdGroups = [];

for (const g of dupeGroups) {
  const cs = g.contacts;
  const names = new Set(cs.map((c) => c.display_name));
  if (names.size === 1) sameName++; else diffName++;

  const photoCount = cs.filter((c) => c.avatar_url).length;
  if (photoCount === cs.length) bothHavePhoto++;
  else if (photoCount === 0) neitherHasPhoto++;
  else onlyOneHasPhoto++;

  const labelCounts = cs.map((c) => (Array.isArray(c.labels) ? c.labels.length : 0));
  const withLabel = labelCounts.filter((n) => n > 0).length;
  if (withLabel === cs.length) bothHaveLabel++;
  else if (withLabel === 0) neitherHasLabel++;
  else oneHasLabelOtherDoesnt++;

  const emailCounts = cs.map((c) => (Array.isArray(c.emails) ? c.emails.length : 0) + (c.email ? 1 : 0));
  if (new Set(emailCounts).size > 1) hasEmailDiff++;

  const secCounts = cs.map((c) => !!c.secondary_phone);
  if (new Set(secCounts).size > 1) hasSecondaryDiff++;

  for (const c of cs) if (c.client_id) clientIdSet.add(c.client_id);

  // grupos "estranhos": mais de 2, ou nomes diferentes, ou nenhum com foto, ou nenhum com label
  if (cs.length !== 2 || names.size > 1 || photoCount === 0 || withLabel === 0) {
    weirdGroups.push(g);
  }
}

console.log({
  bothHavePhoto,
  onlyOneHasPhoto,
  neitherHasPhoto,
  sameName,
  diffName,
  oneHasLabelOtherDoesnt,
  bothHaveLabel,
  neitherHasLabel,
  hasEmailDiff,
  hasSecondaryDiff,
  contatosComClientIdVinculado: clientIdSet.size,
});

console.log("\nGrupos fora do padrão comum (mostrando até 10):");
for (const g of weirdGroups.slice(0, 10)) {
  console.log(JSON.stringify(g, null, 2));
}
console.log("\nTotal de grupos fora do padrão:", weirdGroups.length);
