const fs = require('fs');

const file = 'app/admin/gerenciador/aplicativo/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// CAMPOS EXIGIDOS label (line 584)
content = content.replace(/className="text-\[10px\] font-bold text-slate-400 uppercase tracking-wider"/g, 'className="text-[10px] font-normal text-slate-400 uppercase tracking-wider"');

// url badge or options (line 531)
content = content.replace(/className="inline-flex items-center text-\[10px\] font-bold/g, 'className="inline-flex items-center text-[10px] font-normal');

// options checked in modal (line 915)
content = content.replace(/className=\{`text-xs px-2 py-1 border rounded font-bold transition-colors flex items-center gap-1/g, 'className={`text-xs px-2 py-1 border rounded font-normal transition-colors flex items-center gap-1');

// Integration URL success text (line 792)
content = content.replace(/className="text-\[10px\] text-emerald-600 dark:text-emerald-400 mt-1 font-bold"/g, 'className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 font-normal"');

// Form label (line 74)
content = content.replace(/className="block text-\[10px\] font-bold text-slate-400 dark:text-muted-foreground mb-1 uppercase tracking-wider"/g, 'className="block text-[10px] font-normal text-slate-400 dark:text-muted-foreground mb-1 uppercase tracking-wider"');

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed aplicativo styles!');
