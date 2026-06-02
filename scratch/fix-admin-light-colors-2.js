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
  // Backgrounds
  [/bg-sky-50(?!0)( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-sky-500/10'],
  [/bg-sky-100( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-sky-500/20'],
  [/hover:bg-sky-200( dark:hover:bg-[a-zA-Z0-9-/]+)?/g, 'hover:bg-sky-500/30'],
  [/hover:bg-sky-100( dark:hover:bg-[a-zA-Z0-9-/]+)?/g, 'hover:bg-sky-500/20'],
  
  [/bg-purple-50(?!0)( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-purple-500/10'],
  [/bg-purple-100( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-purple-500/20'],
  [/hover:bg-purple-200( dark:hover:bg-[a-zA-Z0-9-/]+)?/g, 'hover:bg-purple-500/30'],
  [/hover:bg-purple-100( dark:hover:bg-[a-zA-Z0-9-/]+)?/g, 'hover:bg-purple-500/20'],
  
  [/bg-slate-50(?!0)( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-black/10'],
  [/bg-slate-100( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-black/20'],
  [/bg-slate-200( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-black/30'],
  [/hover:bg-slate-200( dark:hover:bg-[a-zA-Z0-9-/]+)?/g, 'hover:bg-black/20'],
  
  [/bg-rose-100( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-rose-500/20'],
  
  // Borders
  [/border-sky-100( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-sky-500/20'],
  [/border-sky-200( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-sky-500/30'],
  
  [/border-purple-100( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-purple-500/20'],
  [/border-purple-200( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-purple-500/30'],
  
  [/border-slate-100( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-border'],
  [/border-slate-200( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-border'],
  
  // Text colors
  [/text-sky-600( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-sky-400'],
  [/text-sky-700( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-sky-400'],
  
  [/text-purple-600( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-purple-400'],
  [/text-purple-700( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-purple-300'],
  
  [/text-emerald-700( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-emerald-400']
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
    console.log('Fixed additional light colors in', file);
  }
}
console.log('Total files fixed:', changedFiles);
