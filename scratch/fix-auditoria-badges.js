const fs = require('fs');

const file = 'app/admin/auditoria/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// The class we want to replace looks like this:
// px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase border border-emerald-200 dark:border-emerald-500/30
// Let's replace 'px-2 py-0.5 rounded ' with 'gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight '
// and 'font-bold' with 'font-medium'

content = content.replace(/px-2 py-0\.5 rounded /g, 'gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight ');
content = content.replace(/px-2\.5 py-0\.5 rounded-full /g, 'gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight ');

// For badges that use text-[10px] font-bold, we change to font-medium
// Be careful not to change ALL font-bold in the file (like table headers or titles)
// The badges have text-[10px] font-bold
content = content.replace(/text-\[10px\] font-bold/g, 'text-[10px] font-medium');

// Also for action buttons if there are any
// px-3 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 dark:bg-purple-500/20 dark:hover:bg-purple-500/30 dark:text-purple-300 text-[10px] font-bold uppercase rounded-lg
content = content.replace(/px-3 py-1\.5 bg-purple-100/g, 'gap-1 px-3 py-1.5 bg-purple-100');
content = content.replace(/px-3 py-1\.5 bg-rose-50/g, 'gap-1 px-3 py-1.5 bg-rose-50');
content = content.replace(/px-3 py-1\.5 bg-sky-100/g, 'gap-1 px-3 py-1.5 bg-sky-100');

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed auditoria badges!');
