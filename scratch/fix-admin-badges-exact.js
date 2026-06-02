const fs = require('fs');

const file = 'app/admin/cliente/page.tsx';
let c = fs.readFileSync(file, 'utf8');
let original = c;

// Fix the dynamic badge string
c = c.replace(
  /bg-\$\{color\}-50 dark:bg-\$\{color\}-500\/10 text-\$\{color\}-700 dark:text-\$\{color\}-400 border-\$\{color\}-200 dark:border-\$\{color\}-500\/20/g,
  'bg-${color}-500/10 text-${color}-400 border-${color}-500/20'
);

// Fix the explicit arrays
c = c.replace(/text-sky-500 dark:text-sky-400 bg-sky-500\/10 border-sky-500\/30 hover:bg-sky-500\/20 dark:hover:bg-sky-500\/20/g, 'text-sky-400 bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/20');
c = c.replace(/text-emerald-400\/70 dark:text-emerald-500\/70 bg-emerald-500\/10 border-emerald-200 dark:border-emerald-500\/20 hover:bg-emerald-100 dark:hover:bg-emerald-500\/20/g, 'text-emerald-400/90 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20');
c = c.replace(/text-amber-600 dark:text-amber-400 bg-amber-500\/10 border-amber-200 dark:border-amber-500\/20 hover:bg-amber-100 dark:hover:bg-amber-500\/20/g, 'text-amber-400 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20');
c = c.replace(/text-purple-400 bg-purple-500\/10 border-purple-500\/30 hover:bg-purple-500\/20 dark:hover:bg-purple-500\/20/g, 'text-purple-400 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20');
c = c.replace(/text-rose-400 bg-rose-500\/10 border-rose-200 dark:border-rose-500\/20 hover:bg-rose-500\/20 dark:hover:bg-rose-500\/20/g, 'text-rose-400 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20');

if (c !== original) {
  fs.writeFileSync(file, c, 'utf8');
  console.log('Fixed badges in cliente/page.tsx');
} else {
  console.log('No changes needed in cliente/page.tsx');
}
