const fs = require('fs');

const file = 'app/renew/RenewClient.tsx';
let c = fs.readFileSync(file, 'utf8');
let original = c;

// Fix bg-slate-50 without dark: variant (add dark:bg-white/5)
c = c.replace(/bg-slate-50(?!\s+dark:bg-)/g, 'bg-slate-50 dark:bg-white/5');

// Fix bg-white without dark: variant in portal (not the ones that already have dark:bg-card)
// Only target ones that don't already have a dark: variant
const lines = c.split('\n');
const newLines = [];
let changes = 0;

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  
  // Fix border-slate-200 without dark: variant  
  if (line.includes('border-slate-200') && !line.includes('dark:border-')) {
    line = line.replace(/border-slate-200/g, 'border-slate-200 dark:border-border');
    changes++;
  }
  
  // Fix border-slate-300 without dark: variant
  if (line.includes('border-slate-300') && !line.includes('dark:border-')) {
    line = line.replace(/border-slate-300/g, 'border-slate-300 dark:border-white/20');
    changes++;
  }
  
  // Fix bg-white without dark: (for inputs and cards that need dark variant)
  if (line.includes('bg-white') && !line.includes('dark:bg-') && !line.includes('bg-white/')) {
    line = line.replace(/bg-white(?!\/)/g, 'bg-white dark:bg-card');
    changes++;
  }

  // Fix text-slate-500 without dark:
  if (line.includes('text-slate-500') && !line.includes('dark:text-')) {
    line = line.replace(/text-slate-500/g, 'text-slate-500 dark:text-white/50');
    changes++;
  }

  // Fix text-slate-400 without dark:
  if (line.includes('text-slate-400') && !line.includes('dark:text-') && !line.includes('dark:hover:')) {
    line = line.replace(/text-slate-400/g, 'text-slate-400 dark:text-white/40');
    changes++;
  }

  // Fix bg-blue-50 without dark:
  if (line.includes('bg-blue-50') && !line.includes('dark:bg-')) {
    line = line.replace(/bg-blue-50/g, 'bg-blue-50 dark:bg-blue-500/10');
    changes++;
  }

  // Fix border-blue-200 without dark:
  if (line.includes('border-blue-200') && !line.includes('dark:border-')) {
    line = line.replace(/border-blue-200/g, 'border-blue-200 dark:border-blue-500/20');
    changes++;
  }

  // Fix text-blue-700 without dark:
  if (line.includes('text-blue-700') && !line.includes('dark:text-')) {
    line = line.replace(/text-blue-700/g, 'text-blue-700 dark:text-blue-300');
    changes++;
  }

  // Fix bg-rose-50 without dark:
  if (line.includes('bg-rose-50') && !line.includes('dark:bg-')) {
    line = line.replace(/bg-rose-50/g, 'bg-rose-50 dark:bg-rose-500/10');
    changes++;
  }

  // Fix border-rose-200 without dark:
  if (line.includes('border-rose-200') && !line.includes('dark:border-')) {
    line = line.replace(/border-rose-200/g, 'border-rose-200 dark:border-rose-500/20');
    changes++;
  }

  newLines.push(line);
}

c = newLines.join('\n');

if (c !== original) {
  fs.writeFileSync(file, c, 'utf8');
  console.log(`Fixed ${changes} dark mode issues in RenewClient.tsx`);
} else {
  console.log('No changes needed');
}
