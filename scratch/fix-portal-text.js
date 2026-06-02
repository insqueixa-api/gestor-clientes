const fs = require('fs');

const file = 'app/renew/RenewClient.tsx';
let c = fs.readFileSync(file, 'utf8');
let original = c;
let changes = 0;

const lines = c.split('\n');
const newLines = [];

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];

  // Fix text-slate-800 without dark: variant
  if (line.includes('text-slate-800') && !line.includes('dark:text-')) {
    line = line.replace(/text-slate-800/g, 'text-slate-800 dark:text-white');
    changes++;
  }

  // Fix text-slate-600 without dark: (for descriptions/labels)  
  if (line.includes('text-slate-600') && !line.includes('dark:text-') && !line.includes('dark:hover:')) {
    line = line.replace(/text-slate-600(?!\s+dark:)/g, 'text-slate-600 dark:text-white/70');
    changes++;
  }

  // Fix bg-slate-50 inside cards (keep white bg for cards, fix inner sections)
  // These are section backgrounds inside white cards - on dark they should be slightly darker  
  
  // Fix loading text
  if (line.includes('text-slate-600') && line.includes('Carregando')) {
    line = line.replace('text-slate-600', 'text-slate-600 dark:text-white/60');
  }

  newLines.push(line);
}

c = newLines.join('\n');

if (c !== original) {
  fs.writeFileSync(file, c, 'utf8');
  console.log(`Fixed ${changes} text color issues in RenewClient.tsx`);
} else {
  console.log('No changes needed');
}
