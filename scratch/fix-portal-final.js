const fs = require('fs');

const file = 'app/renew/RenewClient.tsx';
let c = fs.readFileSync(file, 'utf8');

const replacements = [
  // Fix the broken classes from the previous overlapping replace
  [/bg-blue-500\/100\/100/g, 'bg-blue-500'],
  [/bg-blue-500\/100\/10/g, 'bg-blue-500/10'],
  [/bg-emerald-500\/100\/10/g, 'bg-emerald-500/10'],
  [/bg-emerald-500\/100\/20/g, 'bg-emerald-500/20'],
  [/bg-emerald-500\/100/g, 'bg-emerald-500'],
  [/bg-rose-500\/100\/100/g, 'bg-rose-500'],
  [/bg-rose-500\/100\/10/g, 'bg-rose-500/10'],

  // The PIX "Aguardando pagamento" block is around line 2093. It's bg-blue-500/10 border-blue-500/20.
  // The user says "copiar nao aparece", because the input field for PIX or the Copiar button has a light background.
  // The button for "Copiar" has `bg-slate-200 dark:bg-card/10 text-muted-foreground hover:bg-slate-300`
  // We need to change that to a dark-friendly button.
  [/bg-slate-200 dark:bg-card\/10 text-muted-foreground hover:bg-slate-300/g, 'bg-white/10 text-foreground hover:bg-white/20'],
  [/bg-slate-200/g, 'bg-white/10'],
  
  // Clean up any other "dark:" redundancies that the previous script created
  [/dark:bg-rose-500\/10 /g, ' '],
  [/dark:border-rose-500\/20 /g, ' '],
  [/dark:text-rose-400/g, ' '],
  
  [/dark:bg-emerald-500\/10 /g, ' '],
  [/dark:border-emerald-500\/20 /g, ' '],
  [/dark:text-emerald-400/g, ' '],
  
  [/dark:border-white\/30/g, 'border-white/30']
];

for (const [pattern, replacement] of replacements) {
  c = c.replace(pattern, replacement);
}

fs.writeFileSync(file, c, 'utf8');
console.log('Fixed broken tailwind classes and PIX copy button in RenewClient.tsx');
