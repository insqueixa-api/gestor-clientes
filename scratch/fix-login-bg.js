const fs = require('fs');

const files = [
  'app/login/page.tsx',
  'app/LoginClient.tsx',
  'app/reset-password/page.tsx'
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let c = fs.readFileSync(file, 'utf8');
  let original = c;

  // Main card backgrounds
  c = c.replace(/bg-white\/85 backdrop-blur-xl shadow-2xl dark:bg-card\/[0-9]+/g, 'bg-card/80 backdrop-blur-xl shadow-2xl');
  c = c.replace(/bg-white\/85/g, 'bg-card/80');

  // Input or sub-card backgrounds
  c = c.replace(/bg-slate-100 p-1 dark:bg-black\/20/g, 'bg-black/20 p-1');
  c = c.replace(/bg-slate-100/g, 'bg-black/20');
  
  // Disabled buttons
  c = c.replace(/bg-slate-300 text-white cursor-not-allowed dark:bg-white\/15/g, 'bg-white/10 text-foreground/50 cursor-not-allowed');
  c = c.replace(/bg-slate-300/g, 'bg-white/10');

  // Active buttons - wait, the active button usually has bg-slate-800 dark:bg-white/10 or something. Let's see:
  // "bg-slate-800 text-white hover:bg-slate-900" is fine, it's dark text.
  
  if (c !== original) {
    fs.writeFileSync(file, c, 'utf8');
    console.log('Fixed', file);
  }
}
