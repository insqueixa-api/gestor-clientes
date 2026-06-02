const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  try {
    fs.readdirSync(dir).forEach(file => {
      const fp = path.join(dir, file);
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) results = results.concat(walk(fp));
      else if (fp.endsWith('.tsx') || fp.endsWith('.ts')) results.push(fp);
    });
  } catch (e) {}
  return results;
}

const files = walk('app');
let totalChanges = 0;

files.forEach(file => {
  let c = fs.readFileSync(file, 'utf8');
  let original = c;

  // Make sure text colors are using the CSS variables so they adapt properly
  // Remove hardcoded dark texts that become invisible on dark cards
  c = c.replace(/text-slate-800 dark:text-white/g, 'text-foreground');
  c = c.replace(/text-slate-800/g, 'text-foreground');

  c = c.replace(/text-slate-700 dark:text-white/g, 'text-foreground/90');
  c = c.replace(/text-slate-700/g, 'text-foreground/90');

  c = c.replace(/text-slate-600 dark:text-white\/70/g, 'text-muted-foreground');
  c = c.replace(/text-slate-600 dark:text-white\/60/g, 'text-muted-foreground');
  c = c.replace(/text-slate-600/g, 'text-muted-foreground');

  c = c.replace(/text-slate-500 dark:text-white\/50/g, 'text-muted-foreground');
  c = c.replace(/text-slate-500/g, 'text-muted-foreground');
  
  c = c.replace(/text-slate-400 dark:text-white\/40/g, 'text-muted-foreground/80');
  c = c.replace(/text-slate-400/g, 'text-muted-foreground/80');

  // Fix backgrounds
  c = c.replace(/bg-slate-50 dark:bg-white\/5/g, 'bg-muted/50');
  c = c.replace(/bg-slate-50 dark:bg-black\/20/g, 'bg-muted/50');
  c = c.replace(/bg-slate-50 dark:bg-background/g, 'bg-background');
  c = c.replace(/bg-slate-50/g, 'bg-muted/50');
  
  c = c.replace(/bg-white dark:bg-card/g, 'bg-card');
  c = c.replace(/bg-white\/[0-9]+/g, (match) => match); // Don't replace transparent whites like bg-white/10
  c = c.replace(/bg-white(?![a-zA-Z0-9_\-\/])/g, 'bg-card');

  // Fix borders
  c = c.replace(/border-slate-200 dark:border-border/g, 'border-border');
  c = c.replace(/border-slate-200/g, 'border-border');

  c = c.replace(/border-slate-300 dark:border-white\/20/g, 'border-border');
  c = c.replace(/border-slate-300/g, 'border-border');
  
  // Specific fix for "text-slate-900" (very dark text)
  c = c.replace(/text-slate-900/g, 'text-foreground');

  if (c !== original) {
    fs.writeFileSync(file, c, 'utf8');
    totalChanges++;
  }
});

console.log(`\nTotal files fixed for soft dark theme: ${totalChanges}`);
