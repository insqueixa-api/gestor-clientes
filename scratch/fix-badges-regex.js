const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('app/admin');

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let original = content;

  // Pattern 1: StatusBadge classes (rounded-full -> rounded-lg, font-bold -> font-medium)
  // inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase
  content = content.replace(
    /inline-flex\s+items-center\s+px-2\.5\s+py-0\.5\s+rounded-full\s+text-\[10px\]\s+font-bold\s+uppercase\s+border\s+bg-\$\{color\}-100/g,
    'inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium uppercase tracking-tight shadow-sm bg-${color}-50'
  );
  
  content = content.replace(
    /inline-flex\s+items-center\s+px-2\s+py-0\.5\s+rounded-full\s+text-\[10px\]\s+font-bold/g,
    'inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium uppercase tracking-tight shadow-sm'
  );

  // Pattern 2: Tecnologia or generic small pill badges
  // px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/[0.08] text-slate-600 dark:text-white/75 border border-slate-200 dark:border-white/15 uppercase
  content = content.replace(
    /px-2\s+py-0\.5\s+rounded\s+text-\[10px\]\s+font-bold\s+bg-slate-100/g,
    'gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-500/20 bg-slate-50 text-[10px] font-medium tracking-tight shadow-sm'
  );

  content = content.replace(
    /px-2\s+py-0\.5\s+rounded-full\s+text-\[10px\]\s+font-bold/g,
    'gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm'
  );

  // Pattern 3: The "Aplicativos" badge - already changed in cliente/page.tsx, but let's be sure for others
  // text-[10px] font-bold tracking-tight shadow-sm hover:bg-emerald-100 
  content = content.replace(
    /text-\[10px\]\s+font-bold\s+tracking-tight\s+shadow-sm\s+hover:bg-emerald-100/g,
    'text-[10px] font-medium tracking-tight shadow-sm hover:bg-emerald-100'
  );

  if (content !== original) {
    fs.writeFileSync(f, content, 'utf8');
    console.log('Fixed badges in:', f);
  }
});
