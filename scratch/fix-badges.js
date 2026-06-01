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
  let changed = false;

  // Fix StatusBadge class
  if (content.includes('function StatusBadge')) {
    const oldBadge1 = 'className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-${color}-100 dark:bg-${color}-500/20 text-${color}-700 dark:text-${color}-200 border-${color}-200 dark:border-${color}-400/30 whitespace-nowrap`}';
    const newBadge1 = 'className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium uppercase tracking-tight shadow-sm bg-${color}-50 dark:bg-${color}-500/10 text-${color}-700 dark:text-${color}-400 border-${color}-200 dark:border-${color}-500/20 whitespace-nowrap`}';
    if (content.includes(oldBadge1)) {
      content = content.replace(oldBadge1, newBadge1);
      changed = true;
    }

    const oldBadge2 = 'className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-${color}-100 dark:bg-${color}-500/20 text-${color}-700 dark:text-${color}-200 border-${color}-200 dark:border-${color}-400/30`}';
    const newBadge2 = 'className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium uppercase tracking-tight shadow-sm bg-${color}-50 dark:bg-${color}-500/10 text-${color}-700 dark:text-${color}-400 border-${color}-200 dark:border-${color}-500/20`}';
    if (content.includes(oldBadge2)) {
      content = content.replace(oldBadge2, newBadge2);
      changed = true;
    }
  }

  // Fix Tecnologia badge in cliente/page.tsx, teste/page.tsx, etc.
  const oldTech = 'className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/[0.08] text-slate-600 dark:text-white/75 border border-slate-200 dark:border-white/15 uppercase"';
  const newTech = 'className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-500/20 bg-slate-50 dark:bg-slate-500/10 text-slate-700 dark:text-slate-400 text-[10px] font-medium tracking-tight shadow-sm uppercase"';
  if (content.includes(oldTech)) {
    content = content.split(oldTech).join(newTech);
    changed = true;
  }
  
  // Also look for `font-bold` in app badges
  const oldAppBadge = 'text-[10px] font-bold tracking-tight shadow-sm hover:bg-emerald-100 dark:hover:bg-emerald-500/20 active:scale-95 transition-all max-w-[170px] truncate"';
  const newAppBadge = 'text-[10px] font-medium tracking-tight shadow-sm hover:bg-emerald-100 dark:hover:bg-emerald-500/20 active:scale-95 transition-all max-w-[170px] truncate"';
  if (content.includes(oldAppBadge)) {
    content = content.split(oldAppBadge).join(newAppBadge);
    changed = true;
  }

  // In auditoria
  const oldAuditoria = 'className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${c.bg} ${c.text} ${c.border} uppercase`}';
  const newAuditoria = 'className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium tracking-tight shadow-sm ${c.bg} ${c.text} ${c.border} uppercase`}';
  if (content.includes(oldAuditoria)) {
    content = content.split(oldAuditoria).join(newAuditoria);
    changed = true;
  }

  // General pass to replace `px-2 py-0.5 rounded-full text-[10px] font-bold` or similar
  // Let's do some regex if needed, but we can do a targeted one.

  if (changed) {
    fs.writeFileSync(f, content, 'utf8');
    console.log('Fixed badges in:', f);
  }
});
