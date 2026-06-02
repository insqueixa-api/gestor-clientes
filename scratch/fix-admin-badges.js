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
  // Fix template literal colors (used in badges)
  [/bg-\\\$\{color\}-50 dark:bg-\\\$\{color\}-500\\/10/g, 'bg-${color}-500/10'],
  [/bg-\\\$\{color\}-50/g, 'bg-${color}-500/10'],
  [/text-\\\$\{color\}-700 dark:text-\\\$\{color\}-400/g, 'text-${color}-400'],
  [/text-\\\$\{color\}-700/g, 'text-${color}-400'],
  [/border-\\\$\{color\}-200 dark:border-\\\$\{color\}-500\\/20/g, 'border-${color}-500/20'],
  [/border-\\\$\{color\}-200/g, 'border-${color}-500/20'],

  // Fix remaining explicit colors
  [/border-emerald-200( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-emerald-500/20'],
  [/border-amber-200( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-amber-500/20'],
  [/border-rose-200( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-rose-500/20'],
  [/border-indigo-200( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-indigo-500/20'],
  
  [/hover:bg-emerald-100( dark:hover:bg-[a-zA-Z0-9-/]+)?/g, 'hover:bg-emerald-500/20'],
  [/hover:bg-amber-100( dark:hover:bg-[a-zA-Z0-9-/]+)?/g, 'hover:bg-amber-500/20'],
  [/hover:bg-rose-100( dark:hover:bg-[a-zA-Z0-9-/]+)?/g, 'hover:bg-rose-500/20'],
  [/hover:bg-indigo-100( dark:hover:bg-[a-zA-Z0-9-/]+)?/g, 'hover:bg-indigo-500/20'],
  
  [/text-amber-600( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-amber-400'],
  [/text-emerald-600( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-emerald-400'],
  [/text-rose-600( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-rose-400'],
  [/text-indigo-600( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-indigo-400']
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
    console.log('Fixed dynamic/hardcoded light colors in', file);
  }
}
console.log('Total files fixed:', changedFiles);
