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
  [/border-zinc-100( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-border'],
  [/border-zinc-200( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-border'],
  [/border-slate-100( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-border'],
  [/border-slate-200( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-border'],
  [/bg-zinc-100( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-border'],
  [/bg-zinc-200( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-border'],
  [/bg-slate-100( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-border'],
  [/bg-slate-200( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-border'],
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
    console.log('Fixed final light borders/bgs in', file);
  }
}
console.log('Total files fixed:', changedFiles);
