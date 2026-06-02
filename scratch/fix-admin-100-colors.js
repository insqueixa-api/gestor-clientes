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
  [/bg-emerald-100( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-emerald-500/20'],
  [/bg-amber-100( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-amber-500/20'],
  [/bg-blue-100( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-blue-500/20'],
  [/bg-indigo-100( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-indigo-500/20'],
  [/bg-rose-100( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-rose-500/20'],
  [/bg-sky-100( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-sky-500/20'],
  [/bg-purple-100( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-purple-500/20'],
  [/bg-green-100( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-green-500/20'],
  [/bg-red-100( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-red-500/20'],
  [/bg-yellow-100( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-yellow-500/20'],
  [/bg-white( dark:bg-[a-zA-Z0-9-\/]+)?/g, 'bg-card']
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
    console.log('Fixed', file);
  }
}
console.log('Total files fixed:', changedFiles);
