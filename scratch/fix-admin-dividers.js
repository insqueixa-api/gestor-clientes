const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const fp = path.join(dir, file);
      const stat = fs.statSync(fp);
      if (stat && stat.isDirectory()) {
        if (fp.replace(/\\/g, '/').includes('app/renew')) return;
        results = results.concat(walk(fp));
      } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        results.push(fp);
      }
    });
  } catch (e) {}
  return results;
}

const files = walk('app/admin');

const replacements = [
  [/divide-slate-200( dark:divide-[a-zA-Z0-9-\/]+)?/g, 'divide-border'],
  [/divide-slate-100( dark:divide-[a-zA-Z0-9-\/]+)?/g, 'divide-border'],
  [/divide-zinc-200( dark:divide-[a-zA-Z0-9-\/]+)?/g, 'divide-border'],
  [/divide-zinc-100( dark:divide-[a-zA-Z0-9-\/]+)?/g, 'divide-border'],
  [/divide-gray-200( dark:divide-[a-zA-Z0-9-\/]+)?/g, 'divide-border'],
  [/divide-gray-100( dark:divide-[a-zA-Z0-9-\/]+)?/g, 'divide-border']
];

let changedFiles = 0;
for (const file of files) {
  let c = fs.readFileSync(file, 'utf8');
  let original = c;

  for (const [pattern, replacement] of replacements) {
    c = c.replace(pattern, replacement);
  }

  if (c !== original) {
    fs.writeFileSync(file, c, 'utf8');
    changedFiles++;
    console.log('Fixed dividers in', file);
  }
}
console.log('Total files fixed:', changedFiles);
