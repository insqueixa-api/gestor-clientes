const fs = require('fs');

const file = 'app/renew/RenewClient.tsx';
let c = fs.readFileSync(file, 'utf8');
let original = c;

// Clean up explicitly light backgrounds to use dark-friendly translucent backgrounds
const replacements = [
  // Backgrounds
  [/bg-blue-50 dark:bg-blue-500\/10/g, 'bg-blue-500/10'],
  [/bg-blue-50 dark:bg-blue-500\/100/g, 'bg-blue-500'], // Special case on line 1143
  [/bg-blue-50/g, 'bg-blue-500/10'],
  
  [/bg-emerald-50 dark:bg-emerald-500\/10/g, 'bg-emerald-500/10'],
  [/bg-emerald-50/g, 'bg-emerald-500/10'],
  
  [/bg-emerald-100/g, 'bg-emerald-500/20'],
  
  [/bg-rose-50 dark:bg-rose-500\/10/g, 'bg-rose-500/10'],
  [/bg-rose-50 dark:bg-rose-500\/100/g, 'bg-rose-500'], // Special case on line 2493
  [/bg-rose-50/g, 'bg-rose-500/10'],
  
  [/bg-slate-100 dark:bg-white\/10/g, 'bg-white/10'],
  [/bg-slate-100/g, 'bg-white/10'],

  // The PIX copy code block uses an input that might be bg-white. Let's make sure it's bg-black/20
  [/bg-white dark:bg-white\/5/g, 'bg-black/20'],
  [/bg-white dark:bg-white\/10/g, 'bg-white/10'],
  
  // Text colors
  [/text-blue-700 dark:text-blue-300/g, 'text-blue-300'],
  [/text-blue-700/g, 'text-blue-300'],
  
  [/text-blue-600 dark:text-blue-400/g, 'text-blue-400'],
  [/text-blue-600/g, 'text-blue-400'],
  
  [/text-emerald-700 dark:text-emerald-300/g, 'text-emerald-300'],
  [/text-emerald-700/g, 'text-emerald-300'],
  
  [/text-emerald-600 dark:text-emerald-400/g, 'text-emerald-400'],
  [/text-emerald-600/g, 'text-emerald-400'],
  
  [/text-rose-600 dark:text-rose-400/g, 'text-rose-400'],
  [/text-rose-600/g, 'text-rose-400'],

  // Borders
  [/border-blue-200 dark:border-blue-500\/20/g, 'border-blue-500/20'],
  [/border-blue-200/g, 'border-blue-500/20'],
  
  [/border-emerald-200 dark:border-emerald-500\/30/g, 'border-emerald-500/30'],
  [/border-emerald-200 dark:border-emerald-500\/20/g, 'border-emerald-500/20'],
  [/border-emerald-200/g, 'border-emerald-500/20'],
  
  [/border-rose-200 dark:border-rose-500\/30/g, 'border-rose-500/30'],
  [/border-rose-200 dark:border-rose-500\/20/g, 'border-rose-500/20'],
  [/border-rose-200/g, 'border-rose-500/20']
];

for (const [pattern, replacement] of replacements) {
  c = c.replace(pattern, replacement);
}

if (c !== original) {
  fs.writeFileSync(file, c, 'utf8');
  console.log('Successfully sanitized light-theme colors to dark-theme variants in RenewClient.tsx');
} else {
  console.log('No changes needed.');
}
