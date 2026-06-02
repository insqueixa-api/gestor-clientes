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
  // Fix bright borders on badges
  [/border-emerald-200( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-emerald-500/20'],
  [/border-rose-200( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-rose-500/20'],
  [/border-amber-200( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-amber-500/20'],
  [/border-sky-200( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-sky-500/20'],
  [/border-blue-200( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-blue-500/20'],
  [/border-purple-200( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-purple-500/20'],
  [/border-indigo-200( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-indigo-500/20'],
  [/border-red-200( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-red-500/20'],
  [/border-green-200( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-green-500/20'],
  [/border-yellow-200( dark:border-[a-zA-Z0-9-\/]+)?/g, 'border-yellow-500/20'],
  
  // Fix weird hover backgrounds
  [/hover:bg-emerald-100( dark:hover:bg-[a-zA-Z0-9-\/]+)?/g, 'hover:bg-emerald-500/20'],
  [/hover:bg-rose-100( dark:hover:bg-[a-zA-Z0-9-\/]+)?/g, 'hover:bg-rose-500/20'],
  [/hover:bg-amber-100( dark:hover:bg-[a-zA-Z0-9-\/]+)?/g, 'hover:bg-amber-500/20'],
  [/hover:bg-sky-100( dark:hover:bg-[a-zA-Z0-9-\/]+)?/g, 'hover:bg-sky-500/20'],
  [/hover:bg-blue-100( dark:hover:bg-[a-zA-Z0-9-\/]+)?/g, 'hover:bg-blue-500/20'],
  [/hover:bg-purple-100( dark:hover:bg-[a-zA-Z0-9-\/]+)?/g, 'hover:bg-purple-500/20'],
  [/hover:bg-indigo-100( dark:hover:bg-[a-zA-Z0-9-\/]+)?/g, 'hover:bg-indigo-500/20'],
  
  // Fix text colors inside badges that might still be dark
  [/text-emerald-700( dark:text-[a-zA-Z0-9-\/]+)?/g, 'text-emerald-400'],
  [/text-rose-700( dark:text-[a-zA-Z0-9-\/]+)?/g, 'text-rose-400'],
  [/text-amber-700( dark:text-[a-zA-Z0-9-\/]+)?/g, 'text-amber-400'],
  [/text-sky-700( dark:text-[a-zA-Z0-9-\/]+)?/g, 'text-sky-400'],
  [/text-blue-700( dark:text-[a-zA-Z0-9-\/]+)?/g, 'text-blue-400'],
  [/text-purple-700( dark:text-[a-zA-Z0-9-\/]+)?/g, 'text-purple-400'],
  [/text-indigo-700( dark:text-[a-zA-Z0-9-\/]+)?/g, 'text-indigo-400'],

  // Syntax error fix
  [/bg-black\/20\/80/g, 'bg-black/20']
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
    console.log('Fixed borders in', file);
  }
}
console.log('Total files fixed:', changedFiles);
