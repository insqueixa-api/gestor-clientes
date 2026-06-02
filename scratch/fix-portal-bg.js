const fs = require('fs');

const file = 'app/renew/RenewClient.tsx';
let c = fs.readFileSync(file, 'utf8');
let original = c;

// 1. Loading page - replace light gradient with bg-background
c = c.replace(
  'min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-4 py-8',
  'min-h-screen bg-background p-4 py-8'
);

// 2. Error page - replace light gradient
c = c.replace(
  /min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-\[#0a0f1a\] dark:via-\[#0d1321\] dark:to-\[#0f1629\] p-4/g,
  'min-h-screen flex items-center justify-center bg-background p-4'
);

// 3. Account selector page - replace bg-slate-50
c = c.replace(
  /min-h-screen bg-slate-50 dark:bg-background/g,
  'min-h-screen bg-background'
);

// 4. "Status da Assinatura" text - remove opacity-60 and use proper color
c = c.replace(
  'text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1',
  'text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-white/50 mb-1'
);

if (c !== original) {
  fs.writeFileSync(file, c, 'utf8');
  console.log('Fixed RenewClient.tsx portal backgrounds and status label');
} else {
  console.log('No changes needed');
}
