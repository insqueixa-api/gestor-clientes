const fs = require('fs');

const file = 'app/renew/RenewClient.tsx';
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

// Fix PIX copy input background and text
// It currently has bg-slate-50 or something similar
c = c.replace(/bg-slate-50 dark:bg-white\/5/g, 'bg-muted/50');
c = c.replace(/bg-slate-50/g, 'bg-muted/50');
c = c.replace(/bg-white dark:bg-card/g, 'bg-card');
c = c.replace(/bg-white/g, 'bg-card');

// Fix borders
c = c.replace(/border-slate-200 dark:border-border/g, 'border-border');
c = c.replace(/border-slate-200/g, 'border-border');

c = c.replace(/border-slate-300 dark:border-white\/20/g, 'border-border');
c = c.replace(/border-slate-300/g, 'border-border');

// Text specific for PIX input which was probably text-slate-800
c = c.replace(/text-slate-900/g, 'text-foreground');

if (c !== original) {
  fs.writeFileSync(file, c, 'utf8');
  console.log('Fixed text colors and backgrounds in RenewClient.tsx for the soft dark theme.');
} else {
  console.log('No changes needed.');
}
