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
        // Exclude the renew (client portal) folder
        if (fp.replace(/\\/g, '/').includes('app/renew')) return;
        results = results.concat(walk(fp));
      } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        results.push(fp);
      }
    });
  } catch (e) {}
  return results;
}

const files = walk('app');

const replacements = [
  // Backgrounds
  [/bg-zinc-50(?!0)( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-black/10'],
  [/bg-zinc-100( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-black/20'],
  [/bg-white( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-card'], // Re-run bg-white just in case

  // Text colors
  [/text-zinc-900( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-foreground'],
  [/text-zinc-800( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-foreground'],
  [/text-zinc-700( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-foreground/90'],
  [/text-zinc-600( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-muted-foreground'],
  [/text-zinc-500( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-muted-foreground'],
  
  // Neutral dark text issues
  [/text-gray-900( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-foreground'],
  [/text-gray-800( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-foreground'],
  [/text-gray-700( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-foreground/90'],
  [/text-gray-600( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-muted-foreground'],
  [/text-gray-500( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-muted-foreground'],

  // Borders
  [/border-zinc-200( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-border'],
  [/border-zinc-300( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-border'],
  [/border-gray-200( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-border'],
  [/border-gray-300( dark:border-[a-zA-Z0-9-/]+)?/g, 'border-border'],

  // Hardcoded emerald/red backgrounds on cards (like the "Recebidos Hoje" etc)
  // Let's ensure they are also dark friendly.
  [/bg-emerald-50(?!0)( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-emerald-500/10'],
  [/bg-rose-50(?!0)( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-rose-500/10'],
  [/bg-red-50(?!0)( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-red-500/10'],
  [/bg-blue-50(?!0)( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-blue-500/10'],
  [/bg-amber-50(?!0)( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-amber-500/10'],
  [/bg-yellow-50(?!0)( dark:bg-[a-zA-Z0-9-/]+)?/g, 'bg-yellow-500/10'],

  // Same for texts on those
  [/text-emerald-800( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-emerald-400'],
  [/text-emerald-700( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-emerald-400'],
  [/text-emerald-600( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-emerald-400'],
  [/text-rose-800( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-rose-400'],
  [/text-rose-700( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-rose-400'],
  [/text-rose-600( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-rose-400'],
  [/text-blue-800( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-blue-400'],
  [/text-blue-700( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-blue-400'],
  [/text-blue-600( dark:text-[a-zA-Z0-9-/]+)?/g, 'text-blue-400']
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
