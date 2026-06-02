const fs = require('fs');

let c = fs.readFileSync('app/admin/settings/api-server/page.tsx', 'utf8');

// The original API server title section:
/*
      {/* Topo *\/}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
              API de Integrações
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <div className="relative">
            <button
...
*/

// I will replace it with the exact sticky header and mobile split used in Controle Financeiro

const newHeader = `{/* 1. TÍTULO MOBILE: Rola junto com a tela e desaparece */}
      <div className="min-w-0 text-left pt-1 pb-0 px-3 md:hidden -mt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight whitespace-nowrap">
              API de Integrações
            </h1>
          </div>
        </div>
      </div>

      {/* 2. HEADER STICKY: Botões no Mobile / Título + Botões no Desktop */}
      <div className="sticky top-14 md:top-0 z-[40] bg-background px-3 pb-3 pt-0 md:pt-0 sm:mx-0 sm:px-0 border-b border-border/50 dark:border-border sm:border-none flex items-center justify-end md:justify-between shadow-sm sm:shadow-none transition-colors">
        {/* Título Desktop (Só aparece em telas grandes) */}
        <div className="min-w-0 text-left hidden md:block">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
              API de Integrações
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <div className="relative">
            <button`;

const oldHeaderRegex = /\{\/\* Topo \*\/\}\s*<div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">\s*<div className="min-w-0 text-left">\s*<div className="flex items-center gap-3">\s*<h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">\s*API de Integrações\s*<\/h1>\s*<\/div>\s*<\/div>\s*<div className="flex items-center gap-2 justify-end shrink-0">\s*<div className="relative">\s*<button/;

if (oldHeaderRegex.test(c)) {
  c = c.replace(oldHeaderRegex, newHeader);
  fs.writeFileSync('app/admin/settings/api-server/page.tsx', c, 'utf8');
  console.log('Fixed API server header spacing and size to match financeiro_pessoal');
} else {
  console.log('Could not find API server header');
}
